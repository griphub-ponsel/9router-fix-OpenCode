export function getCopilotModelParts(id) {
  if (typeof id !== "string") return { alias: "", modelId: "" };
  const slash = id.indexOf("/");
  if (slash <= 0) return { alias: "", modelId: id };
  return { alias: id.slice(0, slash), modelId: id.slice(slash + 1) };
}

export function supportsCopilotVision(id) {
  const { alias, modelId } = getCopilotModelParts(id);

  const normalized = `${alias}/${modelId}`.toLowerCase();

  // Explicit vision-capable models that would otherwise be caught by the generic blocklist
  if (/kimi-k2\.7(?:-code)?|minimax-m2\.7|minimax-m3(?:[^a-z0-9]|$)|qwen-?3\.\d+-(?:max|plus)|qwen.*vl/.test(normalized)) return true;

  if (/embedding|coder|deepseek|kimi-k2|mimo-v2(?:\.5)?-pro|minimax|tts|stt/.test(normalized)) return false;

  return /claude|gemini|gpt-4o|gpt-5(?:\.\d+)?(?:-|$)|(?:^|[^a-z0-9])vl(?:[^a-z0-9]|$)|vision|omni|grok-4|grok-composer|glm-\d+(?:\.\d+)?v(?:[^a-z0-9]|$)/.test(normalized);
}

/**
 * Combo-aware vision check. A combo id is its bare name (no "/"), so it never
 * matches the string heuristics above even when every member is a vision model
 * (e.g. a combo "opus-4.8" fanning out to "kr/claude-opus-4.8"). Resolve the
 * combo to its members and report vision when ANY member supports it, so the
 * Copilot config advertises `vision:true` and VS Code forwards attachments.
 *
 * Falls back to the plain id heuristic for non-combo ids.
 *
 * @param {string} id                model id or combo name
 * @param {Array<{name:string, models?:string[]}>} combos
 */
export function supportsCopilotVisionWithCombos(id, combos = []) {
  if (supportsCopilotVision(id)) return true;
  const members = comboMembers(id, combos);
  return members.length > 0 && members.some((m) => supportsCopilotVision(m));
}

/** Resolve a combo name to its member model ids ([] when not a combo). */
export function comboMembers(id, combos = []) {
  if (typeof id !== "string" || id.includes("/")) return [];
  const list = Array.isArray(combos) ? combos : [];
  const combo = list.find((c) => c && c.name === id);
  return combo && Array.isArray(combo.models) ? combo.models : [];
}
