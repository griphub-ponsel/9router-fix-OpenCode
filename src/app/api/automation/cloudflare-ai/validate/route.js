// Quick endpoint to validate a Cloudflare Global API Key + email and return the
// account name/ID without creating a token. Used by the UI to confirm credentials
// before submitting.
//
// Body: { globalApiKey, email }
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

const CF_API = "https://api.cloudflare.com/client/v4";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { globalApiKey, email } = body || {};

    const authHeader = request.headers.get("x-9r-password");
    if (authHeader) {
      const ok = await verifyDashboardPassword(authHeader);
      if (!ok) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }

    if (!globalApiKey || !email) {
      return NextResponse.json(
        { error: "globalApiKey and email are required" },
        { status: 400 }
      );
    }

    const res = await fetch(`${CF_API}/accounts?per_page=5`, {
      headers: {
        "X-Auth-Key": String(globalApiKey).trim(),
        "X-Auth-Email": String(email).trim(),
        Accept: "application/json",
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data?.errors?.[0]?.message || `HTTP ${res.status}`;
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
    const accounts = data.result || [];
    if (accounts.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No Cloudflare accounts found" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Validation failed" },
      { status: 500 }
    );
  }
}
