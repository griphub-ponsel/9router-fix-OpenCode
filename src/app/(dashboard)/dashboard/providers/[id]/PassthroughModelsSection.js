"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }) {
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

      {/* Delete button */}
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

PassthroughModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
};

export default function PassthroughModelsSection({ providerAlias, modelAliases, copied, onCopy, onSetAlias, onDeleteAlias }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  // When the auto-derived alias clashes with an existing one we open an
  // inline manual-alias panel instead of throwing an alert. Mirrors the UX
  // in CompatibleModelsSection so users always have an escape hatch.
  const [aliasConflict, setAliasConflict] = useState(null);
  const [manualAlias, setManualAlias] = useState("");
  const [manualError, setManualError] = useState("");

  // Filter aliases for this provider - models are persisted via alias
  const providerAliases = Object.entries(modelAliases).filter(
    ([, model]) => model.startsWith(`${providerAlias}/`)
  );

  const allModels = providerAliases.map(([alias, fullModel]) => ({
    modelId: fullModel.replace(`${providerAlias}/`, ""),
    fullModel,
    alias,
  }));

  // Generate default alias from modelId (last part after /)
  const generateDefaultAlias = (modelId) => {
    const parts = modelId.split("/");
    return parts[parts.length - 1];
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    const fullModel = `${providerAlias}/${modelId}`;
    if (Object.values(modelAliases).includes(fullModel)) {
      alert(`Model "${modelId}" is already added to this provider.`);
      return;
    }
    const defaultAlias = generateDefaultAlias(modelId);

    // Check if alias already exists
    if (modelAliases[defaultAlias]) {
      setAliasConflict({
        modelId,
        conflicts: [{ alias: defaultAlias, takenBy: modelAliases[defaultAlias] }],
      });
      setManualAlias(`${providerAlias}-${defaultAlias}`);
      setManualError("");
      return;
    }

    setAdding(true);
    try {
      const saved = await onSetAlias(modelId, defaultAlias);
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
      const saved = await onSetAlias(aliasConflict.modelId, alias);
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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {aliasConflict && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
          <p className="text-sm font-medium">
            Auto-suggested alias for &quot;{aliasConflict.modelId}&quot; is already taken
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
            Pick a custom alias instead, or remove the conflicting alias and try again.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="passthrough-manual-alias-input" className="text-xs text-text-muted mb-1 block">Custom alias</label>
              <input
                id="passthrough-manual-alias-input"
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

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ modelId, fullModel, alias }) => (
            <PassthroughModelRow
              key={fullModel}
              modelId={modelId}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onSetAlias: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
};
