// Ammail temp-mail automation route.
//
// GET  → fetch current Ammail settings, connection status, inboxes, OTPs
// POST → actions: "settings", "test-connection", "create-inbox", "delete-inbox"
//
// Note: 9router does not run CF workers — for "auto deploy" we expose settings +
// test-connection + create/delete inbox. The companion `tempmail` repo is a
// separate Cloudflare Worker users deploy themselves.
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

function getAmmailClientFromSettings(settings) {
  const baseUrl = settings.ammail_base_url || "";
  const apiKey = settings.ammail_api_key || "";
  const configured = Boolean(baseUrl && apiKey);
  return {
    configured,
    baseUrl,
    apiKey,
    defaultDomain: settings.ammail_default_domain || "",
    async info() {
      const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/info`, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      return data;
    },
    async listInboxes() {
      try {
        const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/inboxes`, {
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return [];
        return data?.inboxes || data || [];
      } catch {
        return [];
      }
    },
    async createInbox(alias, domain) {
      const r = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/api/inboxes`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            alias,
            domain: domain || settings.ammail_default_domain || "",
          }),
        }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      return data;
    },
    async deleteInbox(alias) {
      const r = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/api/inboxes/${encodeURIComponent(alias)}`,
        {
          method: "DELETE",
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
        }
      );
      return r.ok;
    },
  };
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get("x-9r-password");
    if (authHeader) {
      const ok = await verifyDashboardPassword(authHeader);
      if (!ok) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }

    const settings = await getSettings();
    const client = getAmmailClientFromSettings(settings);

    let configured = client.configured;
    let connectionOk = false;
    let connectionError = "";
    let domains = [];
    let inboxes = [];

    if (configured) {
      try {
        const info = await client.info();
        domains = info.domains || [];
        connectionOk = true;
        try {
          inboxes = await client.listInboxes();
        } catch {
          inboxes = [];
        }
      } catch (err) {
        connectionError = err?.message || String(err);
      }
    }

    return NextResponse.json({
      configured,
      connection_ok: connectionOk,
      connection_error: connectionError,
      domains,
      inboxes: (inboxes || []).map((i) => ({
        alias: i.alias,
        address: i.address,
        domain: i.domain,
        createdAt: i.createdAt,
      })),
      settings: {
        base_url: settings.ammail_base_url || "",
        api_key: settings.ammail_api_key || "",
        default_domain: settings.ammail_default_domain || "",
        cf_account_id: settings.ammail_cf_account_id || "",
        cf_api_token: settings.ammail_cf_api_token || "",
        cf_domain: settings.ammail_cf_domain || "",
        cf_workers_dev_url: settings.ammail_cf_workers_dev_url || "",
      },
    });
  } catch (error) {
    console.error("Error in GET /api/automation/ammail:", error);
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    const authHeader = request.headers.get("x-9r-password");
    if (authHeader) {
      const ok = await verifyDashboardPassword(authHeader);
      if (!ok) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }

    if (action === "settings") {
      const {
        base_url,
        api_key,
        default_domain,
        cf_account_id,
        cf_api_token,
        cf_domain,
        cf_workers_dev_url,
      } = body;
      const updates = {};
      if (base_url !== undefined) updates.ammail_base_url = base_url;
      if (api_key !== undefined) updates.ammail_api_key = api_key;
      if (default_domain !== undefined)
        updates.ammail_default_domain = default_domain;
      if (cf_account_id !== undefined)
        updates.ammail_cf_account_id = cf_account_id;
      if (cf_api_token !== undefined)
        updates.ammail_cf_api_token = cf_api_token;
      if (cf_domain !== undefined) updates.ammail_cf_domain = cf_domain;
      if (cf_workers_dev_url !== undefined)
        updates.ammail_cf_workers_dev_url = cf_workers_dev_url;

      await updateSettings(updates);
      return NextResponse.json({ ok: true });
    }

    if (action === "test-connection") {
      const { base_url, api_key } = body;
      const settings = await getSettings();
      const client =
        base_url && api_key
          ? getAmmailClientFromSettings({
              ...settings,
              ammail_base_url: base_url,
              ammail_api_key: api_key,
            })
          : getAmmailClientFromSettings(settings);

      if (!client.configured) {
        return NextResponse.json(
          { error: "Ammail belum dikonfigurasi." },
          { status: 400 }
        );
      }
      try {
        const info = await client.info();
        return NextResponse.json({ ok: true, info });
      } catch (e) {
        return NextResponse.json(
          { error: e?.message || String(e) },
          { status: 502 }
        );
      }
    }

    const settings = await getSettings();
    const client = getAmmailClientFromSettings(settings);
    if (!client.configured) {
      return NextResponse.json(
        { error: "Ammail belum dikonfigurasi." },
        { status: 400 }
      );
    }

    if (action === "create-inbox") {
      const { alias, domain } = body;
      try {
        const res = await client.createInbox(alias, domain);
        return NextResponse.json({ ok: true, inbox: res?.inbox || res });
      } catch (e) {
        return NextResponse.json(
          { error: e?.message || String(e) },
          { status: 502 }
        );
      }
    }

    if (action === "delete-inbox") {
      const { alias } = body;
      try {
        const ok = await client.deleteInbox(alias);
        return NextResponse.json({ ok });
      } catch (e) {
        return NextResponse.json(
          { error: e?.message || String(e) },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in POST /api/automation/ammail:", error);
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
