"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { formatCopilotContextSize, getCopilotContextSizeOptions, getCopilotContextTokens } from "@/shared/utils/copilotModelLimits";

const ENDPOINT = "/api/cli-tools/hermes-settings";

export default function HermesToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [hermesStatus, setHermesStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelDisplayNames, setModelDisplayNames] = useState({});
  const [modelContextLengths, setModelContextLengths] = useState({});
  const [newModelBadges, setNewModelBadges] = useState({});
  const [subagentModel, setSubagentModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [combos, setCombos] = useState([]);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [sortKey, setSortKey] = useState("model");
  const [sortDir, setSortDir] = useState("asc");
  const [hasHydratedSort, setHasHydratedSort] = useState(false);
  const hasInitializedModel = useRef(false);

  const sortStorageKey = "cliTools:sort:hermes";
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(sortStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sortKey === "model" || parsed?.sortKey === "displayName") setSortKey(parsed.sortKey);
        if (parsed?.sortDir === "asc" || parsed?.sortDir === "desc") setSortDir(parsed.sortDir);
      }
    } catch {
      // Ignore corrupt storage.
    } finally {
      setHasHydratedSort(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedSort) return;
    try {
      window.localStorage.setItem(sortStorageKey, JSON.stringify({ sortKey, sortDir }));
    } catch {
      // Ignore unavailable storage.
    }
  }, [hasHydratedSort, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedModels = useMemo(() => {
    const result = [...selectedModels].sort((leftModel, rightModel) => {
      const left = sortKey === "displayName"
        ? (modelDisplayNames[leftModel]?.trim() || leftModel)
        : leftModel;
      const right = sortKey === "displayName"
        ? (modelDisplayNames[rightModel]?.trim() || rightModel)
        : rightModel;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    });
    return sortDir === "desc" ? result.reverse() : result;
  }, [selectedModels, modelDisplayNames, sortKey, sortDir]);

  const getConfigStatus = () => {
    if (!hermesStatus?.installed) return null;
    const cfg = hermesStatus.settings?.model;
    if (!cfg?.base_url) return "not_configured";
    if (matchKnownEndpoint(cfg.base_url, { tunnelPublicUrl, tailscaleUrl })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setHermesStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !hermesStatus) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) {
      fetchModelAliases();
      fetchCombos();
    }
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      const data = await res.json();
      if (res.ok) setCombos(data.combos || []);
    } catch (error) {
      console.log("Error fetching combos:", error);
    }
  };

  useEffect(() => {
    if (hermesStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const cfg = hermesStatus.settings?.model;
      const configuredModels = Array.isArray(hermesStatus.settings?.models)
        ? hermesStatus.settings.models.filter((model) => typeof model === "string" && model.trim())
        : [];
      const defaultModel = cfg?.default || configuredModels[0] || "";
      setSelectedModel(defaultModel);
      setSelectedModels([...new Set([defaultModel, ...configuredModels].filter(Boolean))]);
      setModelDisplayNames(hermesStatus.settings?.modelNames || {});
      const configuredContextLengths = { ...(hermesStatus.settings?.modelContextLengths || {}) };
      if (cfg?.context_length && defaultModel && !configuredContextLengths[defaultModel]) {
        configuredContextLengths[defaultModel] = Number(cfg.context_length);
      }
      setModelContextLengths(configuredContextLengths);
      // Restore saved subagent model (delegation.model) — empty means inherit parent.
      const savedDelegation = hermesStatus.settings?.delegation;
      if (savedDelegation && typeof savedDelegation.model === "string") {
        setSubagentModel(savedDelegation.model);
      }
    }
  }, [hermesStatus]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setHermesStatus(data);
    } catch (error) {
      setHermesStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const normalizeLocalhost = (url) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") {
      return normalizeLocalhost(window.location.origin);
    }
    return "http://127.0.0.1:20128";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          models: sortedModels,
          modelNames: Object.fromEntries(sortedModels.map((model) => [model, modelDisplayNames[model] || model])),
          modelContextLengths: Object.fromEntries(sortedModels.flatMap((model) => (
            Number(modelContextLengths[model]) > 0 ? [[model, Number(modelContextLengths[model])]] : []
          ))),
          subagentModel: subagentModel || "",
          subagentProvider: subagentModel ? "9router" : "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: data.profilesUpdated
            ? `Settings applied to ${data.profilesUpdated} Hermes profiles!`
            : "Settings applied successfully!",
        });
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
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedModels([]);
        setModelDisplayNames({});
        setModelContextLengths({});
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

  const handleModelSelect = (model) => {
    const value = model?.value || model?.name || model;
    if (!value || selectedModels.includes(value)) return;
    setSelectedModels((prev) => [...prev, value]);
    setModelDisplayNames((prev) => ({ ...prev, [value]: model?.name || prev[value] || value }));
    setNewModelBadges((prev) => ({ ...prev, [value]: true }));
    if (!selectedModel) setSelectedModel(value);
  };

  const removeModel = (model) => {
    const nextModels = selectedModels.filter((value) => value !== model);
    setSelectedModels(nextModels);
    setModelDisplayNames((prev) => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
    setModelContextLengths((prev) => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
    setNewModelBadges((prev) => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
    if (selectedModel === model) setSelectedModel(nextModels[0] || "");
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = sortedModels.length > 0 ? sortedModels : ["provider/model-id"];
    const defaultModel = selectedModel || modelsToShow[0];
    const modelEntries = modelsToShow.map((model) => {
      const displayName = modelDisplayNames[model]?.trim() || model;
      const contextLength = Number(modelContextLengths[model]);
      const contextLine = contextLength > 0 ? `\n        context_length: ${contextLength}` : "";
      if (displayName === model) return contextLine ? `      ${JSON.stringify(model)}:${contextLine}` : `      ${JSON.stringify(model)}: {}`;
      return `      ${JSON.stringify(displayName)}:\n        target_model: ${JSON.stringify(model)}\n        display_name: ${JSON.stringify(displayName)}${contextLine}`;
    }).join("\n");
    const defaultPickerId = modelDisplayNames[defaultModel]?.trim() || defaultModel;
    const yamlContent = `model:\n  default: ${JSON.stringify(defaultPickerId)}\n  provider: "9router"\n  base_url: ${JSON.stringify(getEffectiveBaseUrl())}\n\nproviders:\n  9router:\n    name: "9Router"\n    base_url: ${JSON.stringify(getEffectiveBaseUrl())}\n    key_env: "OPENAI_API_KEY"\n    transport: "openai_chat"\n    discover_models: false\n    default_model: ${JSON.stringify(defaultPickerId)}\n    models:\n${modelEntries}\n`;
    const envContent = `OPENAI_API_KEY=${keyToUse}\n`;

    return [
      { filename: "~/.hermes/config.yaml", content: yamlContent },
      { filename: "~/.hermes/.env", content: envContent },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/hermes.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
              <span>Checking Hermes Agent...</span>
            </div>
          )}

          {!checking && hermesStatus && !hermesStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Hermes Agent not detected locally</p>
                    <p className="text-sm text-text-muted">Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pl-0 sm:pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto !bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!checking && hermesStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getEffectiveBaseUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {hermesStatus?.settings?.model?.base_url && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {hermesStatus.settings.model.base_url}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:pt-1 sm:text-right sm:text-sm">Models</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:mt-1.5 sm:inline">arrow_forward</span>
                  <div className="flex min-w-0 flex-col gap-2">
                    {selectedModels.length === 0 ? (
                      <div className="rounded border border-border bg-surface/40 px-3 py-4 text-center text-xs text-text-muted">No models selected</div>
                    ) : (
                      <div className="overflow-hidden rounded border border-border bg-surface/40">
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_6rem_auto_2rem] items-center gap-2 border-b border-border bg-surface/60 px-3 py-2 text-[11px] font-medium text-text-muted">
                          <button type="button" onClick={() => toggleSort("model")} className="flex cursor-pointer items-center gap-1 text-left transition-colors hover:text-text-main" title={`Sort by Model ${sortKey === "model" && sortDir === "asc" ? "Z-A" : "A-Z"}`}>
                            <span>Model</span>
                            <span className="material-symbols-outlined text-[14px] leading-none">{sortKey === "model" ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}</span>
                          </button>
                          <button type="button" onClick={() => toggleSort("displayName")} className="flex cursor-pointer items-center gap-1 text-left transition-colors hover:text-text-main" title={`Sort by Display Name ${sortKey === "displayName" && sortDir === "asc" ? "Z-A" : "A-Z"}`}>
                            <span>Display Name</span>
                            <span className="material-symbols-outlined text-[14px] leading-none">{sortKey === "displayName" ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}</span>
                          </button>
                          <span className="text-center">Context</span>
                          <span className="text-center">Default</span>
                          <span></span>
                        </div>
                        {sortedModels.map((model) => (
                          <div key={model} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_6rem_auto_2rem] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface/80">
                            <span className="flex min-w-0 items-center gap-1.5" title={model}>
                              <span className="min-w-0 truncate text-xs text-text-main">{model}</span>
                              {newModelBadges[model] && (
                                <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                                  New
                                </span>
                              )}
                            </span>
                            <input type="text" value={modelDisplayNames[model] ?? model} onChange={(event) => setModelDisplayNames((prev) => ({ ...prev, [model]: event.target.value }))} className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
                            <select
                              value={modelContextLengths[model] || "auto"}
                              onChange={(event) => setModelContextLengths((prev) => {
                                const next = { ...prev };
                                if (event.target.value === "auto") delete next[model];
                                else next[model] = Number(event.target.value);
                                return next;
                              })}
                              className="w-full rounded border border-border bg-surface px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                              title="Context window advertised to Hermes"
                            >
                              <option value="auto">Auto ({formatCopilotContextSize(getCopilotContextTokens(model, null, combos))})</option>
                              {getCopilotContextSizeOptions(model, modelContextLengths[model], combos)
                                .filter((option) => option.value !== getCopilotContextTokens(model, null, combos))
                                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <span className="min-w-12 text-center">{model === selectedModel ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Yes</span> : <span className="text-[10px] text-text-muted">No</span>}</span>
                            <button onClick={() => removeModel(model)} className="flex size-5 items-center justify-center rounded text-text-muted/50 transition-colors hover:bg-red-500/10 hover:text-red-500" title="Remove model">
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <button onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className={`rounded border px-2 py-1 text-xs transition-colors ${hasActiveProviders ? "cursor-pointer border-border bg-surface text-text-main hover:border-primary" : "cursor-not-allowed border-border opacity-50"}`}>Add Model</button>
                      <span className="text-xs text-text-muted">{selectedModels.length > 0 ? `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"} selected` : "Select models to add"}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Default Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={selectedModels.length === 0} className="w-full min-w-0 rounded border border-border bg-surface px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5">
                    {selectedModels.length === 0 && <option value="">Add a model first</option>}
                    {sortedModels.map((model) => {
                      const displayName = modelDisplayNames[model]?.trim();
                      return <option key={model} value={model}>{displayName && displayName !== model ? `${displayName} (${model})` : model}</option>;
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <select value={subagentModel} onChange={(event) => setSubagentModel(event.target.value)} disabled={selectedModels.length === 0} className="w-full min-w-0 rounded border border-border bg-surface px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5">
                      <option value="">Inherit parent model (default)</option>
                      {sortedModels.map((model) => {
                        const displayName = modelDisplayNames[model]?.trim();
                        return <option key={model} value={model}>{displayName && displayName !== model ? `${displayName} (${model})` : model}</option>;
                      })}
                    </select>
                    <span className="text-[11px] text-text-muted">Model for delegate_task subagents. Inherit = same as main agent.</span>
                  </div>
                </div>

              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={!selectedModel || selectedModels.length === 0} loading={applying} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!hermesStatus?.has9Router} loading={restoring} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        onDeselect={(model) => removeModel(model.value)}
        selectedModel={selectedModel}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Hermes Agent"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Hermes Agent - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
