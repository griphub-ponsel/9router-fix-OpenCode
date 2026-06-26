/**
 * OAuth Configuration Constants — static data lives in registry, re-exported here for consumers.
 */
import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js";
import { PROVIDER_OAUTH, PROVIDERS as REGISTRY_PROVIDERS } from "open-sse/providers/index.js";

/**
 * Get the platform enum value based on the current OS.
 * Matches Antigravity binary's ClientMetadata.Platform enum.
 */
function getOAuthPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

// Claude OAuth Configuration (Authorization Code Flow with PKCE)
export const CLAUDE_CONFIG = { ...PROVIDER_OAUTH["claude"] };

// xAI Grok OAuth Configuration (Authorization Code Flow with PKCE)
// Reverse-engineered from Hermes Agent (NousResearch/hermes-agent) which uses
// the public Grok-CLI client_id and the SuperGrok subscription bearer token
// against api.x.ai/v1.  Uses the discovered endpoints from
// https://auth.x.ai/.well-known/openid-configuration.
export const XAI_OAUTH_CONFIG = {
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  authorizeUrl: "https://auth.x.ai/oauth2/authorize",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  apiBaseUrl: "https://api.x.ai/v1",
  scope: "openid profile email offline_access grok-cli:access api:access",
  codeChallengeMethod: "S256",
  // accounts.x.ai requires `plan=generic` to allow loopback OAuth from
  // non-allowlisted clients; `referrer` lets xAI attribute the request
  extraParams: {
    plan: "generic",
    referrer: "hermes-agent",
  },
};

// Codex (OpenAI) OAuth Configuration (Authorization Code Flow with PKCE)
export const CODEX_CONFIG = { ...PROVIDER_OAUTH["codex"] };

// Gemini (Google) OAuth Configuration (Standard OAuth2)
// clientId/clientSecret from GOOGLE_OAUTH_CLIENT (shared.js) — not stored in registry
export const GEMINI_CONFIG = { ...GOOGLE_OAUTH_CLIENT, ...PROVIDER_OAUTH["gemini-cli"] };

// Qwen OAuth Configuration (Device Code Flow with PKCE)
export const QWEN_CONFIG = { ...PROVIDER_OAUTH["qwen"] };

// Qoder OAuth Configuration (Device Token Flow with PKCE).
// Device tokens are long-lived (~30 days for access, ~360 for refresh).
// The upstream refresh endpoint at center.qoder.sh returns 403 for our
// flow — we accept that and surface it to the user as "re-login" instead
// of attempting to silently rotate.
export const QODER_CONFIG = { ...PROVIDER_OAUTH["qoder"] };

// Notion MCP OAuth Configuration (Dynamic Client Registration + PKCE)
export const NOTION_CONFIG = {
  issuer: "https://mcp.notion.com",
  resource: "https://mcp.notion.com/mcp",
  authorizeUrl: "https://mcp.notion.com/authorize",
  tokenUrl: "https://mcp.notion.com/token",
  registrationUrl: "https://mcp.notion.com/register",
  codeChallengeMethod: "S256",
};

// iFlow OAuth Configuration (Authorization Code)
export const IFLOW_CONFIG = { ...PROVIDER_OAUTH["iflow"] };

// Antigravity OAuth Configuration (Standard OAuth2 with Google)
// clientId/clientSecret from ANTIGRAVITY_OAUTH_CLIENT (shared.js) — not stored in registry
// loadCodeAssistClientMetadata is dynamic (runtime platform detection)
export const ANTIGRAVITY_CONFIG = {
  ...ANTIGRAVITY_OAUTH_CLIENT,
  ...PROVIDER_OAUTH["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
};

/**
 * Get client metadata using numeric enum values for API calls.
 * Values match the Antigravity binary:
 *   ideType=9 (ANTIGRAVITY), pluginType=2 (GEMINI), platform=OS-specific.
 * @returns {{ ideType: number, platform: number, pluginType: number }}
 */
export function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

// OpenAI OAuth Configuration (Authorization Code Flow with PKCE)
export const OPENAI_CONFIG = { ...PROVIDER_OAUTH["openai"] };

// GitHub Copilot OAuth Configuration (Device Code Flow)
export const GITHUB_CONFIG = { ...PROVIDER_OAUTH["github"] };

// Kiro OAuth Configuration (multi-method: AWS Builder ID / IDC / Social / Import Token)
export const KIRO_CONFIG = { ...PROVIDER_OAUTH["kiro"] };

// AWS region allowlist pattern — prevents SSRF via region injection into upstream URLs (GHSA-6mwv-4mrm-5p3m)
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

// Reject any region that is not a valid AWS region before interpolating it into a URL
export function assertValidAwsRegion(region) {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}

// AWS region allowlist pattern — prevents SSRF via region injection into upstream URLs (GHSA-6mwv-4mrm-5p3m)
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

// Reject any region that is not a valid AWS region before interpolating it into a URL
export function assertValidAwsRegion(region) {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}

// Cursor OAuth Configuration (Import Token from Cursor IDE)
// tokenStoragePaths: user-reference only, not stored in registry
export const CURSOR_CONFIG = {
  ...PROVIDER_OAUTH["cursor"],
  tokenStoragePaths: {
    linux: "~/.config/Cursor/User/globalStorage/state.vscdb",
    macos: "/Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    windows: "%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
  },
};

// Kimi Coding OAuth Configuration (Device Code Flow)
// clientId uses env override — dynamic, not stored in registry
export const KIMI_CODING_CONFIG = {
  ...PROVIDER_OAUTH["kimi-coding"],
  clientId: process.env.KIMI_CODING_OAUTH_CLIENT_ID || REGISTRY_PROVIDERS["kimi-coding"]?.clientId,
};

// KiloCode OAuth Configuration (Custom Device Auth Flow)
export const KILOCODE_CONFIG = { ...PROVIDER_OAUTH["kilocode"] };

// Cline OAuth Configuration (Local Callback Flow via app.cline.bot)
export const CLINE_CONFIG = { ...PROVIDER_OAUTH["cline"] };

// GitLab Duo OAuth Configuration (Authorization Code Flow with PKCE)
export const GITLAB_CONFIG = { ...PROVIDER_OAUTH["gitlab"] };

// Pioneer AI Authentication Configuration
// Pioneer uses Supabase Auth (gotrue-js) at https://db.pioneer.ai for the
// web app session, and a separate REST API at https://api.pioneer.ai keyed
// by `X-API-Key: pio_sk_...` for inference. We support three login paths:
//   1. Direct API key paste            (pio_sk_...)
//   2. Supabase refresh_token import   (sb-db-auth-token.refresh_token)
//   3. Email + password (Supabase)     (gotrue grant_type=password)
// All three paths funnel into a long-lived pio_sk_ key persisted as `apiKey`.
// The Supabase anon key is the publishable key embedded in the Pioneer FE
// bundle (agent.pioneer.ai) and is safe to ship client-side.
export const PIONEER_CONFIG = {
  supabaseUrl: "https://db.pioneer.ai",
  supabaseAnonKey: "sb_publishable_AtlDtPFv9cqxkWcH1b7A1g_J3OZbosp",
  apiBaseUrl: "https://api.pioneer.ai",
  apiVersionBase: "https://api.pioneer.ai/v1",
  apiKeyPrefix: "pio_sk_",
  webAppUrl: "https://agent.pioneer.ai",
  apiKeysUrl: "https://agent.pioneer.ai/settings/api-keys",
  signupUrl: "https://agent.pioneer.ai/auth",
  authMethods: ["apikey", "import", "password"],
  // Pioneer enforces hCaptcha on Supabase password sign-in. Sitekey is
  // safe to ship client-side (extracted from the official FE bundle).
  hcaptchaSiteKey: "c646a2ec-0a3e-415c-affe-c502978ede9c",
};

// CodeBuddy (Tencent) OAuth Configuration (Browser OAuth Polling Flow)
export const CODEBUDDY_CONFIG = { ...PROVIDER_OAUTH["codebuddy-cn"] };

// OAuth timeout (5 minutes)
export const OAUTH_TIMEOUT = 300000;

// Provider list
export const PROVIDERS = {
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini-cli",
  QWEN: "qwen",
  QODER: "qoder",
  NOTION: "notion",
  IFLOW: "iflow",
  ANTIGRAVITY: "antigravity",
  OPENAI: "openai",
  GITHUB: "github",
  KIRO: "kiro",
  CURSOR: "cursor",
  KIMI_CODING: "kimi-coding",
  KILOCODE: "kilocode",
  CLINE: "cline",
  GITLAB: "gitlab",
  CODEBUDDY: "codebuddy-cn",
  XAI_OAUTH: "xai-oauth",
  PIONEER: "pioneer",
};
