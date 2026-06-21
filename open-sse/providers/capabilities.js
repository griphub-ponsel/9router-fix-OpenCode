// Model capabilities used by dashboard UI badges.

export const DEFAULT_CAPABILITIES = {
  vision: false,
  search: false,
  reasoning: false,
};

export const MODEL_CAPABILITIES = {
  "vision-model": { vision: true, reasoning: true },
  "coder-model": { reasoning: true },
  "gpt-image-1": { vision: false },
  "glm-4.6v": { vision: true, reasoning: true },
};

export const PROVIDER_CAPABILITIES = {};

export const PATTERN_CAPABILITIES = [
  { pattern: "*claude*", caps: { vision: true, reasoning: true, search: true } },
  { pattern: "*gemini*", caps: { vision: true, reasoning: true, search: true } },
  { pattern: "*gemma*", caps: { vision: true } },
  { pattern: "*gpt-5*image*", caps: { vision: false } },
  { pattern: "*gpt-5*codex*", caps: { reasoning: true, search: true } },
  { pattern: "*gpt-5*", caps: { vision: true, reasoning: true, search: true } },
  { pattern: "*gpt-4o*", caps: { vision: true, search: true } },
  { pattern: "*gpt-4.1*", caps: { vision: true } },
  { pattern: "*o1*", caps: { vision: true, reasoning: true } },
  { pattern: "*o3*", caps: { vision: true, reasoning: true } },
  { pattern: "*o4*", caps: { vision: true, reasoning: true } },
  { pattern: "*grok*image*", caps: { vision: false } },
  { pattern: "*grok-code*", caps: { reasoning: true } },
  { pattern: "*grok*", caps: { vision: true, reasoning: true, search: true } },
  { pattern: "*qwen*vl*", caps: { vision: true, reasoning: true } },
  { pattern: "*qwen*max*", caps: { vision: true, reasoning: true } },
  { pattern: "*qwen*plus*", caps: { vision: true, reasoning: true } },
  { pattern: "*qwen*coder*", caps: { reasoning: true } },
  { pattern: "*qwen*", caps: { reasoning: true } },
  { pattern: "*kimi*k2*", caps: { vision: true, reasoning: true } },
  { pattern: "*kimi*", caps: { reasoning: true } },
  { pattern: "*glm*", caps: { reasoning: true } },
  { pattern: "*deepseek*r*", caps: { reasoning: true } },
  { pattern: "*reasoner*", caps: { reasoning: true } },
  { pattern: "*minimax*image*", caps: { vision: false } },
  { pattern: "*minimax-m3*", caps: { vision: true, reasoning: true } },
  { pattern: "*minimax*", caps: { reasoning: true } },
  { pattern: "*mimo*omni*", caps: { vision: true } },
  { pattern: "*mimo*v2.5*", caps: { vision: true } },
  { pattern: "*llama-4*", caps: { vision: true } },
  { pattern: "*mistral-large*", caps: { vision: true } },
  { pattern: "*sonar*", caps: { search: true } },
  { pattern: "*pplx*", caps: { search: true } },
  { pattern: "*perplexity*", caps: { search: true } },
];

function matchPattern(pattern, value) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(String(value || ""));
}

export function getCapabilitiesForModel(provider, model) {
  if (!model) return { ...DEFAULT_CAPABILITIES };

  if (provider && PROVIDER_CAPABILITIES[provider]?.[model]) {
    return { ...DEFAULT_CAPABILITIES, ...PROVIDER_CAPABILITIES[provider][model] };
  }

  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (MODEL_CAPABILITIES[baseModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] };
  if (MODEL_CAPABILITIES[model]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[model] };

  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return { ...DEFAULT_CAPABILITIES, ...caps };
    }
  }

  return { ...DEFAULT_CAPABILITIES };
}
