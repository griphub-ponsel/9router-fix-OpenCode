"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  // When auto-resolution can't pick a non-conflicting alias we surface a
  // manual alias input + per-conflict explanation instead of a dead-end alert.
  // `aliasConflict` holds { modelId, conflicts: [{ alias, takenBy }] } so the
  // UI can tell the user *which* aliases are taken and by whom.
  const [aliasConflict, setAliasConflict] = useState(null);
  const [manualAlias, setManualAlias] = useState("");
  const [manualError, setManualError] = useState("");

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerStorageAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerStorageAlias}/`, ""),
    fullModel,
    alias,
  }));

  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  // Build the alias candidate list once so resolveAlias and the conflict UI
  // stay in sync (any change here automatically appears in the error message).
  const buildAliasCandidates = (modelId) => {
    const baseAlias = generateDefaultAlias(modelId);
    // Order matters:
    // 1. keep the old short alias when it is free (e.g. "gpt-5.5")
    // 2. keep the legacy provider-prefixed short alias when it is free
    //    (e.g. "fm-gpt-5.5")
    // 3. fall back to the actual provider/model id (e.g. "fm/gpt-5.5").
    //    This is the correct identity for same-name models across providers
    //    and avoids forcing a fake "-2" alias.
    return [baseAlias, `${providerDisplayAlias}-${baseAlias}`, `${providerDisplayAlias}/${modelId}`];
  };

  const resolveAlias = (modelId) => {
    const fullModel = `${providerStorageAlias}/${modelId}`;
    // Skip if this exact model already has an alias
    if (Object.values(modelAliases).includes(fullModel)) return null;
    for (const candidate of buildAliasCandidates(modelId)) {
      if (!modelAliases[candidate]) return candidate;
    }
    return null;
  };

  // Returns [{ alias, takenBy }] for every candidate that is already used.
  // Used to populate the manual-alias prompt with actionable info instead of
  // a generic "all aliases exist" alert.
  const describeConflicts = (modelId) => {
    return buildAliasCandidates(modelId)
      .map((alias) => ({ alias, takenBy: modelAliases[alias] }))
      .filter((c) => c.takenBy);
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const fullModel = `${providerStorageAlias}/${modelId}`;
    if (Object.values(modelAliases).includes(fullModel)) {
      alert(`Model "${modelId}" is already added to this provider.`);
      return;
    }
    const resolvedAlias = resolveAlias(modelId);
    if (!resolvedAlias) {
      // All auto-suggested aliases are taken. Open the manual alias input
      // panel with a default suggestion the user can edit, plus the list of
      // conflicting aliases so they know what to avoid.
      const conflicts = describeConflicts(modelId);
      setAliasConflict({ modelId, conflicts });
      setManualAlias(`${providerDisplayAlias}-${generateDefaultAlias(modelId)}-2`);
      setManualError("");
      return;
    }

    setAdding(true);
    try {
      const saved = await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
      if (saved) setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleManualAliasSubmit = async () => {
    if (!aliasConflict || adding) return;
    const alias = manualAlias.trim();
    if (!alias) {
      setManualError("Alias cannot be empty");
      return;
    }
    if (modelAliases[alias]) {
      setManualError(`"${alias}" is already taken by ${modelAliases[alias]}`);
      return;
    }
    setAdding(true);
    setManualError("");
    try {
      const saved = await onSetAlias(aliasConflict.modelId, alias, providerStorageAlias);
      if (saved) {
        setNewModel("");
        setAliasConflict(null);
        setManualAlias("");
      } else {
        setManualError("Failed to add model. Check the alert for details.");
      }
    } catch (error) {
      console.log("Error adding model with manual alias:", error);
      setManualError(error?.message || "Failed to add model");
    } finally {
      setAdding(false);
    }
  };

  const cancelManualAlias = () => {
    setAliasConflict(null);
    setManualAlias("");
    setManualError("");
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        const resolvedAlias = resolveAlias(modelId);
        if (!resolvedAlias) continue;
        const saved = await onSetAlias(modelId, resolvedAlias, providerStorageAlias);
        if (saved) importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {aliasConflict && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
          <p className="text-sm font-medium">
            Auto-suggested aliases for &quot;{aliasConflict.modelId}&quot; are already taken
          </p>
          {aliasConflict.conflicts.length > 0 && (
            <ul className="text-xs text-text-muted space-y-0.5">
              {aliasConflict.conflicts.map((c) => (
                <li key={c.alias}>
                  <code className="font-mono">{c.alias}</code>
                  {" -> "}
                  <code className="font-mono">{c.takenBy}</code>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-muted">
            Pick a custom alias instead, or remove a conflicting alias and try again.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="manual-alias-input" className="text-xs text-text-muted mb-1 block">Custom alias</label>
              <input
                id="manual-alias-input"
                type="text"
                value={manualAlias}
                onChange={(e) => { setManualAlias(e.target.value); setManualError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleManualAliasSubmit()}
                placeholder="my-alias"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <Button size="sm" onClick={handleManualAliasSubmit} disabled={adding}>
              {adding ? "Adding..." : "Add with this alias"}
            </Button>
            <Button size="sm" variant="secondary" onClick={cancelManualAlias} disabled={adding}>
              Cancel
            </Button>
          </div>
          {manualError && (
            <p className="text-xs text-red-500">{manualError}</p>
          )}
        </div>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <CompatibleModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={`${providerDisplayAlias}/${modelId}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(modelId) : undefined}
              testStatus={modelTestResults[modelId]}
              isTesting={testingModelId === modelId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
