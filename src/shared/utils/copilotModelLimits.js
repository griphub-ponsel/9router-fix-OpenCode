import { getModelLimits } from "../../../open-sse/config/providerModels.js";

const DEFAULT_LIMITS = { contextTokens: 256000, maxOutputTokens: 16000 };
const CONTEXT_TOKEN_OPTIONS = [64000, 128000, 200000, 204800, 262144, 400000, 1000000, 1048576];

const EXACT_LIMITS = {
  "gemini-3.1-pro": { contextTokens: 1048576, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "gemini-3.5-flash": { contextTokens: 1048576, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "claude-haiku-4.5": { contextTokens: 200000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high"] },
  "claude-opus-4.6": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  "claude-opus-4.7": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  "claude-opus-4.8": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  "claude-sonnet-4.6": { contextTokens: 1000000, maxOutputTokens: 32000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  "deepseek-v4-flash": { contextTokens: 262144, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "deepseek-v4-pro": { contextTokens: 1000000, maxOutputTokens: 65536, reasoningEfforts: ["low", "medium", "high"] },
  "glm-5.2": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "glm-5.1": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "glm-5": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "grok-4": { contextTokens: 256000, maxOutputTokens: 32768, reasoningEfforts: ["low", "medium", "high"] },
  "grok-composer-2.5-fast": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "grok-4.20-0309-non-reasoning": { contextTokens: 256000, maxOutputTokens: 32768 },
  "grok-4.20-0309-reasoning": { contextTokens: 256000, maxOutputTokens: 32768, reasoningEfforts: ["low", "medium", "high"] },
  "gpt-5.5": { contextTokens: 1000000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.6-luna": { contextTokens: 1000000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.6-sol": { contextTokens: 1000000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.6-terra": { contextTokens: 1000000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.4": { contextTokens: 1000000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "gpt-5.3-codex": { contextTokens: 400000, maxOutputTokens: 128000, reasoningEfforts: ["low", "medium", "high", "xhigh"] },
  "kimi-k2.5": { contextTokens: 262144, maxOutputTokens: 65536 },
  "kimi-k2.6": { contextTokens: 262144, maxOutputTokens: 65536 },
  "kimi-k2.7": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "kimi-k2.7-code": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "mimo-v2.5": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "mimo-v2.5-pro": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "mimo-v2-omni": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "mimo-v2-pro": { contextTokens: 1048576, maxOutputTokens: 65536 },
  "minimax-m3": { contextTokens: 1000000, maxOutputTokens: 131072 },
  "minimax-m2.5": { contextTokens: 204800, maxOutputTokens: 131072 },
  "minimax-m2.7": { contextTokens: 1000000, maxOutputTokens: 131072 },
  "qwen3.5-plus": { contextTokens: 1000000, maxOutputTokens: 32768 },
  "qwen3.6-plus": { contextTokens: 1000000, maxOutputTokens: 32768 },
  "qwen3.7-max": { contextTokens: 1000000, maxOutputTokens: 65536 },
  "qwen3.7-plus": { contextTokens: 1000000, maxOutputTokens: 65536 },
};

function normalizeModelId(id) {
  const raw = String(id || "").toLowerCase();
  const model = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
  const normalizedVersionModel = model.replace(
    /^(claude-(?:opus|sonnet|haiku)-\d)-(?=\d+$)(\d+)$/,
    "$1.$2"
  );
  return normalizedVersionModel
    .replace(/^qwen-(?=\d)/, "qwen")
    .replace(/-high-combo$/, "")
    .replace(/-combo$/, "")
    .replace(/-high$/, "")
    .replace(/-medium$/, "")
    .replace(/-low$/, "")
    .replace(/-review$/, "");
}

function getModelParts(id) {
  const raw = String(id || "");
  const slash = raw.indexOf("/");
  if (slash <= 0) return { alias: "", modelId: raw };
  return { alias: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
}

function resolveBaseLimits(id) {
  const { alias, modelId } = getModelParts(id);
  const metadataLimits = alias && modelId ? getModelLimits(alias, modelId) : null;
  if (metadataLimits?.contextTokens) return metadataLimits;

  const model = normalizeModelId(id);
  return EXACT_LIMITS[model] || (() => {
    if (/^claude-(opus|sonnet)-/.test(model)) return { contextTokens: 1000000, maxOutputTokens: 32000 };
    if (/^claude-haiku-/.test(model)) return { contextTokens: 200000, maxOutputTokens: 32000 };
    if (/^gpt-5\.6(?:-|$)/.test(model)) return { contextTokens: 1000000, maxOutputTokens: 128000 };
    if (/^grok-4/.test(model)) return { contextTokens: 256000, maxOutputTokens: 32768 };
    return DEFAULT_LIMITS;
  })();
}

function normalizeLimits(limits, contextTokensOverride = null) {
  if (!limits?.contextTokens) return null;
  const maxOutputTokens = limits.maxOutputTokens || DEFAULT_LIMITS.maxOutputTokens;
  const requestedContextTokens = Number(contextTokensOverride) || 0;
  const contextTokens = requestedContextTokens > 0
    ? Math.min(requestedContextTokens, limits.contextTokens)
    : limits.contextTokens;
  return {
    maxInputTokens: Math.max(1024, contextTokens - maxOutputTokens),
    maxOutputTokens,
  };
}

/** GitHub Copilot–allowed reasoning_effort values per model id (when restricted). */
export function getCopilotReasoningEfforts(modelId) {
  const { alias } = getModelParts(modelId);
  // Every Kiro catalog model accepts 9router's synthetic thinking control.
  // `reasoning_effort: max` is clamped to Kiro's upstream limit (32K), so
  // advertise the full picker even for new live-catalog IDs not in EXACT_LIMITS.
  if (alias === "kr" || alias === "kiro") {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  const model = normalizeModelId(modelId);
  const exact = EXACT_LIMITS[model];
  return exact?.reasoningEfforts ?? null;
}

export function isLegacyCopilotContextDefault(id, contextTokens) {
  return /^gpt-5\.6(?:-|$)/.test(normalizeModelId(id)) && Number(contextTokens) === 256000;
}

export function getCopilotModelLimits(id, contextTokensOverride = null) {
  const effectiveOverride = isLegacyCopilotContextDefault(id, contextTokensOverride)
    ? null
    : contextTokensOverride;
  return normalizeLimits(resolveBaseLimits(id), effectiveOverride);
}

export function getCopilotContextTokens(id, contextTokensOverride = null) {
  const limits = getCopilotModelLimits(id, contextTokensOverride);
  return limits ? limits.maxInputTokens + limits.maxOutputTokens : null;
}

export function formatCopilotContextSize(tokens) {
  if (!tokens) return "Auto";
  if (tokens >= 1000000) return "1M";
  return `${Math.round(tokens / 1000)}K`;
}

export function getCopilotContextSizeOptions(id, currentContextTokens = null) {
  const baseLimits = resolveBaseLimits(id);
  const maxContextTokens = Number(baseLimits?.contextTokens) || DEFAULT_LIMITS.contextTokens;
  const maxOutputTokens = Number(baseLimits?.maxOutputTokens) || DEFAULT_LIMITS.maxOutputTokens;
  const minUsefulContextTokens = maxOutputTokens + 1024;
  const current = Number(currentContextTokens) || 0;
  const values = new Set(
    CONTEXT_TOKEN_OPTIONS.filter((value) => value <= maxContextTokens && value >= minUsefulContextTokens)
  );
  values.add(maxContextTokens);
  if (current > 0) values.add(Math.min(current, maxContextTokens));

  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: formatCopilotContextSize(value) }));
}
