export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      text: "Dual auth: use OAuth for browser sign-in, or paste a Cline API key from app.cline.bot Settings > API Keys. API-key mode is useful for ClinePass and avoids OAuth re-login prompts.",
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  authHint: "Paste a Cline API key from app.cline.bot > Settings > API Keys. API keys are sent as raw `Authorization: Bearer <key>`; OAuth/session tokens still use the `workos:` prefix automatically.",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      hooks: [
        "clineHeaders",
      ],
      apiKey: {
        header: "Authorization",
        scheme: "bearer",
      },
      oauth: {
        header: "Authorization",
        scheme: "clineBearer",
      },
    },
  },
  models: [
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "openai/gpt-5.5", name: "GPT-5.5" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "kwaipilot/kat-coder-pro", name: "KAT Coder Pro" },
    // ClinePass (open-weight subscription) — IDs from
    // GET https://api.cline.bot/api/v1/ai/cline/recommended-models → clinePass[]
    { id: "cline-pass/glm-5.2", name: "GLM-5.2 (ClinePass)" },
    { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code (ClinePass)" },
    { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6 (ClinePass)" },
    { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)" },
    { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash (ClinePass)" },
    { id: "cline-pass/minimax-m3", name: "MiniMax M3 (ClinePass)" },
    { id: "cline-pass/mimo-v2.5-pro", name: "MiMo V2.5 Pro (ClinePass)" },
    { id: "cline-pass/mimo-v2.5", name: "MiMo V2.5 (ClinePass)" },
    { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max (ClinePass)" },
    { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
