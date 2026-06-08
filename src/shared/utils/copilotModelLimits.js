import { getModelLimits } from "../../../open-sse/config/providerModels.js";

const DEFAULT_LIMITS = { contextTokens: 256000, maxOutputTokens: 16000 };

const EXACT_LIMITS = {
  "gemini-3.1-pro": { contextTokens: 1048576, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "gemini-3.5-flash": { contextTokens: 1048576, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "claude-haiku-4.5": { contextTokens: 200000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "claude-opus-4.6": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "claude-opus-4.7": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "claude-opus-4.8": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "claude-sonnet-4.6": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "deepseek-v4-flash": { contextTokens: 262144, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "deepseek-v4-pro": { contextTokens: 262144, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "glm-5.1": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "grok-4": { contextTokens: 256000, maxOutputTokens: 32768, reasoningEfforts: ["low", "medium", "high"] },
  "grok-4.20-0309-non-reasoning": { contextTokens: 256000, maxOutputTokens: 32768 },
  "grok-4.20-0309-reasoning": { contextTokens: 256000, maxOutputTokens: 32768, reasoningEfforts: ["low", "medium", "high"] },
  "gpt-5.5": { contextTokens: 400000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.4": { contextTokens: 400000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.3-codex": { contextTokens: 400000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "kimi-k2.5": { contextTokens: 262144, maxOutputTokens: 65536 },
  "kimi-k2.6": { contextTokens: 262144, maxOutputTokens: 65536 },
  "mimo-v2-omni": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "mimo-v2-pro": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "minimax-m2.5": { contextTokens: 204800, maxOutputTokens: 131072 },
  "minimax-m2.7": { contextTokens: 204800, maxOutputTokens: 131072 },
  "qwen3.5-plus": { contextTokens: 1000000, maxOutputTokens: 32768 },
  "qwen3.6-plus": { contextTokens: 1000000, maxOutputTokens: 32768 },
  "qwen3.7-max": { contextTokens: 1000000, maxOutputTokens: 65536 },
};

function normalizeModelId(id) {
  const raw = String(id || "").toLowerCase();
  const model = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
  return model
    .replace(/-high-combo$/, "")
    .replace(/-combo$/, "")
    .replace(/-high$/, "")
    .replace(/-medium$/, "")
    .replace(/-low$/, "");
}

function getModelParts(id) {
  const raw = String(id || "");
  const slash = raw.indexOf("/");
  if (slash <= 0) return { alias: "", modelId: raw };
  return { alias: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
}

function normalizeLimits(limits) {
  if (!limits?.contextTokens) return null;
  const maxOutputTokens = limits.maxOutputTokens || DEFAULT_LIMITS.maxOutputTokens;
  return {
    maxInputTokens: Math.max(1024, limits.contextTokens - maxOutputTokens),
    maxOutputTokens,
  };
}

/** GitHub Copilot–allowed reasoning_effort values per model id (when restricted). */
export function getCopilotReasoningEfforts(modelId) {
  const model = normalizeModelId(modelId);
  const exact = EXACT_LIMITS[model];
  return exact?.reasoningEfforts ?? null;
}

export function getCopilotModelLimits(id) {
  const { alias, modelId } = getModelParts(id);
  const metadataLimits = alias && modelId ? normalizeLimits(getModelLimits(alias, modelId)) : null;
  if (metadataLimits) return metadataLimits;

  const model = normalizeModelId(id);
  const exact = EXACT_LIMITS[model];
  const limits = exact || (() => {
    if (/^claude-(opus|sonnet)-/.test(model)) return { contextTokens: 1000000, maxOutputTokens: 32000 };
    if (/^claude-haiku-/.test(model)) return { contextTokens: 200000, maxOutputTokens: 32000 };
    if (/^grok-4/.test(model)) return { contextTokens: 256000, maxOutputTokens: 32768 };
    return DEFAULT_LIMITS;
  })();

  return normalizeLimits(limits);
}
