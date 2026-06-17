export function getCopilotModelParts(id) {
  if (typeof id !== "string") return { alias: "", modelId: "" };
  const slash = id.indexOf("/");
  if (slash <= 0) return { alias: "", modelId: id };
  return { alias: id.slice(0, slash), modelId: id.slice(slash + 1) };
}

export function supportsCopilotVision(id) {
  const { alias, modelId } = getCopilotModelParts(id);

  const normalized = `${alias}/${modelId}`.toLowerCase();
  if (/embedding|coder|deepseek|kimi-k2|mimo-v2(?:\.5)?-pro|minimax|tts|stt/.test(normalized)) return false;

  return /claude|gemini|gpt-4o|gpt-5(?:\.\d+)?(?:-|$)|(?:^|[^a-z0-9])vl(?:[^a-z0-9]|$)|vision|omni|grok-4|grok-composer|glm-\d+(?:\.\d+)?v(?:[^a-z0-9]|$)/.test(normalized);
}
