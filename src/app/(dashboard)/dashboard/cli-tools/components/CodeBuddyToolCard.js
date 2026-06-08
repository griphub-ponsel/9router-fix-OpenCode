"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { findModelName } from "@/shared/constants/models";

export default function CodeBuddyToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelDisplayNames, setModelDisplayNames] = useState({});
  const [newModelBadges, setNewModelBadges] = useState({});
  const [sortKey, setSortKey] = useState("model"); // "model" | "displayName"
  const [sortDir, setSortDir] = useState("asc"); // "asc" | "desc"
  const selectedModelsRef = useRef([]);

  const sortModels = (models) => ([...new Set(models)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

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
    if (status?.codebuddy?.models) {
      const sortedModels = sortModels(status.codebuddy.models);
      setSelectedModels(sortedModels);
      setModelDisplayNames((prev) => {
        const next = { ...prev };
        sortedModels.forEach((model) => {
          const configuredName = status.codebuddy.modelNames?.[model];
          next[model] = configuredName || next[model] || modelAliases?.[model] || model;
        });
        return next;
      });
    }
  }, [status, modelAliases]);

  const getDefaultModelName = (model) => {
    const aliasName = modelAliases?.[model];
    if (typeof aliasName === "string" && aliasName.trim()) return aliasName;
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

  const sortedModels = useMemo(() => {
    const arr = [...selectedModels];
    const resolveDisplay = (m) => {
      const dn = modelDisplayNames?.[m];
      if (typeof dn === "string" && dn.trim()) return dn.trim();
      const aliasName = modelAliases?.[m];
      if (typeof aliasName === "string" && aliasName.trim()) return aliasName;
      if (typeof m === "string" && m.includes("/")) {
        const slash = m.indexOf("/");
        const name = findModelName(m.slice(0, slash), m.slice(slash + 1));
        if (name) return name;
      }
      return m;
    };
    const cmp = (a, b) => {
      const av = sortKey === "displayName" ? resolveDisplay(a) : a;
      const bv = sortKey === "displayName" ? resolveDisplay(b) : b;
      return av.localeCompare(bv, undefined, { sensitivity: "base" });
    };
    arr.sort(cmp);
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [selectedModels, sortKey, sortDir, modelDisplayNames, modelAliases]);

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
      await fetch("/api/cli-tools/codebuddy-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models,
          modelNames: getSelectedModelNames(models),
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
    const url = status.codebuddy?.baseURL || "";
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
      const res = await fetch("/api/cli-tools/codebuddy-settings");
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

      const res = await fetch("/api/cli-tools/codebuddy-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModels,
          modelNames: getSelectedModelNames(),
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
      const res = await fetch("/api/cli-tools/codebuddy-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModels([]);
        setModelDisplayNames({});
        setNewModelBadges({});
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
    const modelsArr = modelsToShow.map((m) => {
      const friendly = getModelDisplayName(m);
      const supportsReasoning = !m.toLowerCase().includes("non-reasoning");
      return {
        id: m,
        name: friendly,
        vendor: "9router",
        url: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        supportsToolCall: true,
        supportsImages: true,
        supportsReasoning,
      };
    });

    return [{
      filename: "~/.codebuddy/models.json",
      content: JSON.stringify({
        models: modelsArr,
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            {tool.image ? (
              <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
            ) : tool.icon ? (
              <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }}>{tool.icon}</span>
            ) : null}
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
              <span>Checking CodeBuddy...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">CodeBuddy not detected locally</p>
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
                    <p className="text-text-muted">Please install the CodeBuddy IDE extension/app on your machine.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Select Endpoint */}
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

                {/* Current configured baseURL */}
                {status?.codebuddy?.baseURL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.codebuddy.baseURL}
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
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2rem] gap-2 px-3 py-2 border-b border-border bg-surface/60">
                          <button
                            type="button"
                            onClick={() => toggleSort("model")}
                            className="flex items-center gap-1 text-left text-[11px] font-medium text-text-muted hover:text-text-main transition-colors cursor-pointer"
                            title={`Sort by Model ${sortKey === "model" && sortDir === "asc" ? "Z-A" : "A-Z"}`}
                          >
                            <span>Model</span>
                            <span className="material-symbols-outlined text-[14px] leading-none">
                              {sortKey === "model" ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSort("displayName")}
                            className="flex items-center gap-1 text-left text-[11px] font-medium text-text-muted hover:text-text-main transition-colors cursor-pointer"
                            title={`Sort by Display Name ${sortKey === "displayName" && sortDir === "asc" ? "Z-A" : "A-Z"}`}
                          >
                            <span>Display Name</span>
                            <span className="material-symbols-outlined text-[14px] leading-none">
                              {sortKey === "displayName" ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
                            </span>
                          </button>
                          <span className="text-[11px] font-medium text-text-muted text-center"></span>
                        </div>
                        {sortedModels.map((model) => (
                          <div
                            key={model}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2rem] gap-2 px-3 py-1.5 items-center border-b border-border last:border-b-0 hover:bg-surface/80 transition-colors"
                          >
                            <span className="flex min-w-0 items-center gap-1.5" title={model}>
                              <span className="truncate text-xs text-text-main">{model}</span>
                              {newModelBadges[model] && (
                                <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                                  New
                                </span>
                              )}
                            </span>
                            <input
                              type="text"
                              value={modelDisplayNames[model] ?? getDefaultModelName(model)}
                              onChange={(e) => setModelDisplayName(model, e.target.value)}
                              placeholder={getDefaultModelName(model)}
                              className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/cli-tools/codebuddy-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
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
                        {selectedModels.length > 0 ? `${selectedModels.length} model selected` : "Select models to add"}
                      </span>
                    </div> 
                  </div>
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
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for CodeBuddy"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="CodeBuddy - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
