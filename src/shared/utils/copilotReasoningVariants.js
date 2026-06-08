import { getCopilotReasoningEfforts } from "./copilotModelLimits.js";

const DEFAULT_EFFORTS = ["low", "medium", "high"];

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

/**
 * Adds native thinking capability fields to models that support reasoning.
 * VS Code Copilot shows a Thinking Effort picker when `supportsReasoningEffort` is set.
 * This replaces the old approach of expanding models into separate -high/-low/-medium entries.
 */
export function expandCopilotReasoningVariants(models) {
  return models.map((model) => {
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
