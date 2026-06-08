import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

function normalizeAccounts(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body.accounts)) return body.accounts;
  if (body && typeof body === "object" && Array.isArray(body.sessions)) return body.sessions;
  if (body && typeof body === "object") return [body];
  return null;
}

function expiresAtFrom(item) {
  if (item.expiresAt) return item.expiresAt;
  if (item.expires) return new Date(item.expires).toISOString();
  if (typeof item.expiresIn === "number" && item.expiresIn > 0) {
    return new Date(Date.now() + item.expiresIn * 1000).toISOString();
  }
  return null;
}

function normalizeCodexAccount(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Item is not an object");
  }

  const {
    id: _id,
    provider: _provider,
    authType: _authType,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...item
  } = raw;

  const accessToken = item.accessToken || item.access_token;
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing accessToken");
  }

  const idToken = item.idToken || item.id_token;
  const refreshToken = item.refreshToken || item.refresh_token || null;
  const providerSpecificData = { ...(item.providerSpecificData || {}) };
  const info = extractCodexAccountInfo(idToken || accessToken) || {};

  if (!providerSpecificData.chatgptAccountId && info.chatgptAccountId) {
    providerSpecificData.chatgptAccountId = info.chatgptAccountId;
  }
  if (!providerSpecificData.chatgptPlanType && info.chatgptPlanType) {
    providerSpecificData.chatgptPlanType = info.chatgptPlanType;
  }
  if (!providerSpecificData.importMethod) {
    providerSpecificData.importMethod = refreshToken ? "token_json" : "session";
  }

  return {
    provider: "codex",
    authType: "oauth",
    accessToken,
    refreshToken,
    idToken,
    expiresAt: expiresAtFrom(item),
    email: item.email || info.email || item.user?.email || null,
    displayName: item.displayName || item.user?.name || null,
    providerSpecificData,
    testStatus: item.testStatus || "active",
    isActive: item.isActive !== false,
    lastRefreshAt: item.lastRefreshAt || new Date().toISOString(),
  };
}

/**
 * POST /api/oauth/codex/bulk-import
 * Import Codex OAuth token JSON objects without echoing secrets back.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: `Invalid JSON body: ${err.message}` }, { status: 400 });
  }

  const accounts = normalizeAccounts(body);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
  }

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < accounts.length; i++) {
    try {
      const connection = await createProviderConnection(normalizeCodexAccount(accounts[i]));
      results.push({ index: i, ok: true, id: connection.id, email: connection.email || null });
      success++;
    } catch (err) {
      results.push({ index: i, ok: false, error: err.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
