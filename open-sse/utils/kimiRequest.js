function isKimiK27CodeModel(model) {
  if (typeof model !== "string") return false;
  const baseModel = model.toLowerCase().split("/").pop();
  return baseModel === "kimi-k2.7-code" || baseModel === "kimi-k2.7-code-highspeed";
}

export function normalizeKimiK27CodeRequest(model, body) {
  if (!body || typeof body !== "object" || !isKimiK27CodeModel(model)) return body;

  const nextBody = {
    ...body,
    temperature: 1,
    top_p: 0.95,
    n: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  };

  if (nextBody.tool_choice && nextBody.tool_choice !== "auto" && nextBody.tool_choice !== "none") {
    nextBody.tool_choice = "auto";
  }

  return nextBody;
}