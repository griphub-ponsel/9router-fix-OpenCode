import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

function normalizeBearerToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^Bearer\s+/i, "").trim();
}

export function getClineAccessToken(token) {
  const trimmed = normalizeBearerToken(token);
  if (!trimmed) return "";
  return trimmed.startsWith("workos:") ? trimmed : `workos:${trimmed}`;
}

export function getClineApiKeyToken(token) {
  return normalizeBearerToken(token);
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

export function getClineApiKeyAuthorizationHeader(token) {
  const apiKey = getClineApiKeyToken(token);
  return apiKey ? `Bearer ${apiKey}` : "";
}

export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `9Router/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "9router",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

export function buildClineChatHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `9Router/${APP_VERSION}`,
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

export function buildClineApiKeyHeaders(token, extraHeaders = {}) {
  const authorization = getClineApiKeyAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `9Router/${APP_VERSION}`,
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
