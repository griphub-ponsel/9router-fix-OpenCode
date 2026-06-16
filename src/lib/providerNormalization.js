import { AI_PROVIDERS } from "../shared/constants/providers.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function extractNotionToken(rawValue, fallbackCookie = "") {
  const values = [rawValue, fallbackCookie];
  for (const value of values) {
    const raw = String(value || "").trim().replace(/^Cookie:\s*/i, "");
    if (!raw) continue;

    const tokenMatch = raw.match(/(?:^|;\s*)token_v2=([^;]+)/i);
    if (tokenMatch?.[1]) return tokenMatch[1].trim().replace(/^[']|[']$/g, "").replace(/^["]|["]$/g, "");

    if (!raw.includes(";") && !raw.includes("=")) {
      return raw.replace(/^[']|[']$/g, "").replace(/^["]|["]$/g, "");
    }
  }
  return "";
}

export function extractNotionUserId(rawCookie = "") {
  const raw = String(rawCookie || "").trim().replace(/^Cookie:\s*/i, "");
  const match = raw.match(/(?:^|;\s*)notion_user_id=([^;]+)/i);
  return match?.[1]?.trim().replace(/^[']|[']$/g, "").replace(/^["]|["]$/g, "") || "";
}

export function normalizeProviderSpecificData(provider, body = {}, providerSpecificData = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  if (provider === "notion") {
    const spaceId = (next.spaceId || next.space_id || body.spaceId || body.space_id || "").trim();
    const spaceViewId = (next.spaceViewId || next.space_view_id || body.spaceViewId || body.space_view_id || "").trim();
    const fullCookie = (next.fullCookie || next.cookie || body.fullCookie || body.cookie || "").trim();
    const userId = (next.userId || next.user_id || body.userId || body.user_id || extractNotionUserId(fullCookie) || "").trim();
    const clientVersion = (next.clientVersion || next.notionClientVersion || body.clientVersion || body.notionClientVersion || "").trim();

    delete next.space_id;
    delete next.user_id;
    delete next.space_view_id;
    delete next.cookie;
    delete next.notionClientVersion;

    if (spaceId) next.spaceId = spaceId;
    if (userId) next.userId = userId;
    if (spaceViewId) next.spaceViewId = spaceViewId;
    if (fullCookie) next.fullCookie = fullCookie;
    if (clientVersion) next.clientVersion = clientVersion;
  }

  return Object.keys(next).length > 0 ? next : null;
}
