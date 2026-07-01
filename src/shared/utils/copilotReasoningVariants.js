import { getCopilotReasoningEfforts } from "./copilotModelLimits.js";

const DEFAULT_EFFORTS = ["low", "medium", "high"];
// Canonical low→max ordering so a combo's merged efforts stay sorted.
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

function supportsReasoningVariants(id) {
  const model = String(id || "").toLowerCase();
  if (/embedding|image|tts|stt/.test(model)) return false;
  // Only models with configurable reasoning_effort support
  // Qwen, GLM, Minimax, Kimi have always-on thinking (not configurable)
  return /claude|deepseek|gpt-|grok|gemini/.test(model);
}

function reasoningEffortsForModel(id) {
  const allowed = getCopilotReasoningEfforts(id);
  return allowed || DEFAULT_EFFORTS;
}

// Union of reasoning efforts across a combo's member models, ordered low→max.
// A combo id is its name (no "/"), so it never resolves to a known model on its
// own — without this it would fall back to low/medium/high and drop xhigh/max
// even when a member (e.g. claude-opus-4.7) supports them.
function comboReasoningEfforts(members) {
  const union = new Set();
  for (const member of members) {
    if (typeof member !== "string" || !supportsReasoningVariants(member)) continue;
    for (const effort of reasoningEffortsForModel(member)) union.add(effort);
  }
  return EFFORT_ORDER.filter((effort) => union.has(effort));
}

/**
 * Adds native thinking capability fields to models that support reasoning.
 * VS Code Copilot shows a Thinking Effort picker when `supportsReasoningEffort` is set.
 * This replaces the old approach of expanding models into separate -high/-low/-medium entries.
 *
 * `combos` maps combo entries (whose id is the combo name) to their member
 * models so a combo exposes the widest thinking range any member supports.
 */
export function expandCopilotReasoningVariants(models, combos = []) {
  const comboMembersByName = new Map(
    (Array.isArray(combos) ? combos : [])
      .filter((combo) => combo && typeof combo.name === "string")
      .map((combo) => [combo.name, Array.isArray(combo.models) ? combo.models : []])
  );

  return models.map((model) => {
    // Combo entry: id is the combo name. Expose the union of its members'
    // reasoning efforts instead of falling back to low/medium/high.
    const comboMembers = comboMembersByName.get(model.id);
    if (comboMembers) {
      const efforts = comboReasoningEfforts(comboMembers);
      if (efforts.length === 0) return model;
      return {
        ...model,
        thinking: true,
        supportsReasoningEffort: efforts,
        reasoningEffortFormat: "chat-completions",
      };
    }

    if (!supportsReasoningVariants(model.id)) return model;
    const efforts = reasoningEffortsForModel(model.id);
    if (efforts.length === 0) return model;
    return {
      ...model,
      thinking: true,
      supportsReasoningEffort: efforts,
      reasoningEffortFormat: "chat-completions",
    };
  });
}
