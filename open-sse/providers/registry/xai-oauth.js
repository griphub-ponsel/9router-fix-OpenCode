export default {
  id: "xai-oauth",
  priority: 281,
  alias: "xog",
  // Accept upstream-style "xai/..." model ids (Grok Imagine video docs / skill).
  aliases: ["xai"],
  display: {
    name: "xAI Grok",
    icon: "auto_awesome",
    color: "#000000",
    textIcon: "XG",
    website: "https://x.ai/grok",
    notice: {
      text: "Browser OAuth login at accounts.x.ai. Works with free tier or paid SuperGrok subscription. Uses official xAI API (api.x.ai/v1).",
      signupUrl: "https://x.ai/grok",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
  ],
  hasOAuth: true,
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.x.ai/v1/responses",
    format: "openai-responses",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  },
  models: [
    { id: "grok-composer-2.5-fast", name: "Grok Composer 2.5 Fast" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 (Non-reasoning)" },
    { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi-Agent" },
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-3", name: "Grok 3" },
    // Grok Imagine video (async job API). Docs:
    // https://docs.x.ai/developers/rest-api-reference/inference/videos
    { id: "grok-imagine-video", name: "Grok Imagine Video", params: ["duration", "aspect_ratio", "resolution"], kind: "video" },
  ],
  serviceKinds: ["llm", "video"],
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  videoConfig: { baseUrl: "https://api.x.ai/v1/videos" },
};
