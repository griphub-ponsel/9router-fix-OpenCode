import { getCopilotReasoningEfforts } from "./copilotModelLimits.js";

const REASONING_VARIANTS = [
  { suffix: "none", label: "None" },
  { suffix: "low", label: "Low" },
  { suffix: "medium", label: "Medium" },
  { suffix: "high", label: "High" },
  { suffix: "xhigh", label: "xHigh" },
];

function supportsReasoningVariants(id) {
  const model = String(id || "").toLowerCase();
  if (/embedding|image|tts|stt/.test(model)) return false;
  return /claude|deepseek|gpt-|grok|kimi|mimo|qwen|glm|minimax|gemini/.test(model);
}

function reasoningVariantsForModel(id) {
  const allowed = getCopilotReasoningEfforts(id);
  if (!allowed) return REASONING_VARIANTS;
  const allowedSet = new Set(allowed);
  return REASONING_VARIANTS.filter((v) => allowedSet.has(v.suffix));
}

export function expandCopilotReasoningVariants(models) {
  return models.flatMap((model) => {
    if (!supportsReasoningVariants(model.id)) return [model];
    const variants = reasoningVariantsForModel(model.id);
    if (variants.length === 0) return [model];
    return [
      model,
      ...variants.map((variant) => ({
        ...model,
        id: `${model.id}-${variant.suffix}`,
        name: `${model.name} (${variant.label})`,
      })),
    ];
  });
}
