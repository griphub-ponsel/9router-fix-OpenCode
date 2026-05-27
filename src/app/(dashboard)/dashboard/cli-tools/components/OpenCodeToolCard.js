"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { findModelName } from "@/shared/constants/models";

export default function OpenCodeToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [subagentModel, setSubagentModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelDisplayNames, setModelDisplayNames] = useState({});
  const [newModelBadges, setNewModelBadges] = useState({});
  const [activeModel, setActiveModel] = useState("");
  const selectedModelsRef = useRef([]);

  const sortModels = (models) => ([...new Set(models)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  // Sync models from existing config
  useEffect(() => {
    if (status?.opencode?.models) {
      const sortedModels = sortModels(status.opencode.models);
      setSelectedModels(sortedModels);
      setModelDisplayNames((prev) => {
        const next = { ...prev };
        sortedModels.forEach((model) => {
          const configuredName = status.opencode.modelNames?.[model];
          next[model] = configuredName || next[model] || modelAliases?.[model] || model;
        });
        return next;
      });
    }
    if (status?.opencode?.activeModel) {
      setActiveModel(status.opencode.activeModel);
    }

    // Parse subagent settings from agent.explorer if exists
    if (status?.config?.agent?.explorer?.model?.startsWith("9router/")) {
      setSubagentModel(status.config.agent.explorer.model.replace("9router/", ""));
    }
  }, [status, modelAliases]);

  const getDefaultModelName = (model) => {
    const aliasName = modelAliases?.[model];
    if (typeof aliasName === "string" && aliasName.trim()) return aliasName;
    // Resolve from PROVIDER_MODELS registry (e.g. "kr/claude-opus-4.7" → "Claude Opus 4.7")
    if (typeof model === "string" && model.includes("/")) {
      const slash = model.indexOf("/");
      const alias = model.slice(0, slash);
      const modelId = model.slice(slash + 1);
      const name = findModelName(alias, modelId);
      if (name && name !== modelId) return name;
    }
    return model;
  };

  const getModelDisplayName = (model) => {
    const displayName = modelDisplayNames?.[model];
    return typeof displayName === "string" && displayName.trim() ? displayName.trim() : getDefaultModelName(model);
  };

  const getSelectedModelNames = (models = selectedModels) => (
    Object.fromEntries(models.map((model) => [model, getModelDisplayName(model)]))
  );

  const setModelDisplayName = (model, value) => {
    setModelDisplayNames((prev) => ({ ...prev, [model]: value }));
  };

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const saveModels = async (models) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);
      const validActiveModel = models.includes(activeModel) ? activeModel : (models[0] || "");
      await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models,
          modelNames: getSelectedModelNames(models),
          activeModel: validActiveModel,
          subagentModel,
        }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.has9Router) return "not_configured";
    const url = status.config?.provider?.["9router"]?.options?.baseURL || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModels,
          modelNames: getSelectedModelNames(),
          activeModel: activeModel === "" ? "" : (activeModel || selectedModels[0]),
          subagentModel: subagentModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        setSelectedModels([]);
        setModelDisplayNames({});
        setNewModelBadges({});
        setActiveModel("");
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;

    const modelsObj = {};
    modelsToShow.forEach(m => {
      // Match the capability flags we set in opencode-settings/route.js so the
      // OpenCode UI lets users attach images, tools, and see reasoning UI.
      // The `modalities` field is what actually gates the "this model does
      // not support image input" UI error.
      // Use friendly display name from the model alias map (e.g. "Claude Opus
      // 4.7" instead of "kr/claude-opus-4.7") so OpenCode's model picker is
      // readable. Falls back to the raw id when no alias is registered.
      const friendly = getModelDisplayName(m);
      modelsObj[m] = {
        name: friendly,
        attachment: true,
        tool_call: true,
        reasoning: true,
        temperature: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      };
    });

    return [{
      filename: "~/.config/opencode/opencode.json",
      content: JSON.stringify({
        provider: {
          "9router": {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: getEffectiveBaseUrl(), apiKey: keyToUse },
            models: modelsObj,
          },
        },
        model: `9router/${activeModelToShow}`,
        agent: {
          explorer: {
            description: "Fast explorer subagent for codebase exploration",
            mode: "subagent",
            model: `9router/${effectiveSubagentModel}`
          }
        }
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/opencode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking OpenCode CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">OpenCode CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g opencode-ai</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">opencode</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current base URL */}
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {/* Current configured */}
                {status?.config?.provider?.["9router"]?.options?.baseURL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.config.provider["9router"].options.baseURL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    {selectedModels.length === 0 ? (
                      <div className="px-3 py-4 rounded border border-border bg-surface/40 text-center">
                        <span className="text-xs text-text-muted">No models selected</span>
                      </div>
                    ) : (
                      <div className="rounded border border-border bg-surface/40 overflow-hidden">
                        {/* Table header */}
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)_2rem] gap-2 px-3 py-2 border-b border-border bg-surface/60">
                          <span className="text-[11px] font-medium text-text-muted w-5"></span>
                          <span className="text-[11px] font-medium text-text-muted">Model</span>
                          <span className="text-[11px] font-medium text-text-muted">Display Name</span>
                          <span className="text-[11px] font-medium text-text-muted text-center"></span>
                        </div>
                        {/* Table rows */}
                        {selectedModels.map((model) => (
                          <div
                            key={model}
                            className={`grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)_2rem] gap-2 px-3 py-1.5 items-center border-b border-border last:border-b-0 transition-colors ${
                              model === activeModel ? "bg-primary/5" : "hover:bg-surface/80"
                            }`}
                          >
                            {/* Star / set active */}
                            <button
                              onClick={async () => {
                                if (model === activeModel) {
                                  try {
                                    const res = await fetch("/api/cli-tools/opencode-settings", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ clearActiveModel: true }),
                                    });
                                    if (res.ok) {
                                      setActiveModel("");
                                      checkStatus();
                                    }
                                  } catch (error) {
                                    console.log("Error clearing active model:", error);
                                  }
                                } else {
                                  setActiveModel(model);
                                }
                              }}
                              className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                                model === activeModel
                                  ? "text-primary"
                                  : "text-text-muted/40 hover:text-primary/60"
                              }`}
                              title={model === activeModel ? "Click to clear active" : "Click to set as active"}
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {model === activeModel ? "star" : "star_outline"}
                              </span>
                            </button>
                            {/* Model ID */}
                            <span className="flex min-w-0 items-center gap-1.5" title={model}>
                              <span className="truncate text-xs text-text-main">{model}</span>
                              {newModelBadges[model] && (
                                <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                                  New
                                </span>
                              )}
                            </span>
                            {/* Display name input */}
                            <input
                              type="text"
                              value={modelDisplayNames[model] ?? getDefaultModelName(model)}
                              onChange={(e) => setModelDisplayName(model, e.target.value)}
                              placeholder={getDefaultModelName(model)}
                              className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                            {/* Remove button */}
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/cli-tools/opencode-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    const newModels = sortModels(selectedModels.filter((m) => m !== model));
                                    setSelectedModels(newModels);
                                    setModelDisplayNames((prev) => {
                                      const next = { ...prev };
                                      delete next[model];
                                      return next;
                                    });
                                    setNewModelBadges((prev) => {
                                      const next = { ...prev };
                                      delete next[model];
                                      return next;
                                    });
                                    if (activeModel === model) {
                                      setActiveModel("");
                                    }
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error removing model:", error);
                                }
                              }}
                              className="w-5 h-5 flex items-center justify-center rounded text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              title="Remove model"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1 rounded border text-xs transition-colors ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Add Model</button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0 && activeModel ? (
                          <>Active: <span className="text-primary">{activeModel}</span></>
                        ) : selectedModels.length > 0 ? (
                          <span className="text-yellow-500">Click star to set active model</span>
                        ) : (
                          "Select models to add"
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subagent Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <input
                    type="text"
                    value={subagentModel}
                    onChange={(e) => setSubagentModel(e.target.value)}
                    placeholder={selectedModel || "provider/model-id (defaults to main model)"}
                    className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  <button
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
                    Select Model
                  </button>
                  {subagentModel && (
                    <button
                      onClick={() => setSubagentModel("")}
                      className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
                      title="Clear (will use main model)"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status.has9Router} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          saveModels(selectedModelsRef.current);
        }}
        onSelect={(model) => {
          if (!selectedModels.includes(model.value)) {
            setSelectedModels((prev) => sortModels([...prev, model.value]));
            setModelDisplayNames((prev) => ({
              ...prev,
              [model.value]: prev[model.value] || model.name || getDefaultModelName(model.value),
            }));
            setNewModelBadges((prev) => ({ ...prev, [model.value]: true }));
            if (!activeModel) setActiveModel(model.value);
          }
        }}
        onDeselect={(model) => {
          const remaining = sortModels(selectedModels.filter((m) => m !== model.value));
          setSelectedModels(remaining);
          setModelDisplayNames((prev) => {
            const next = { ...prev };
            delete next[model.value];
            return next;
          });
          setNewModelBadges((prev) => {
            const next = { ...prev };
            delete next[model.value];
            return next;
          });
          if (activeModel === model.value) {
            setActiveModel(remaining[0] || "");
          }
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for OpenCode"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={subagentModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Subagent Model for OpenCode"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="OpenCode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
