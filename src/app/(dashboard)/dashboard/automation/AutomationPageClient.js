"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Button, Card, Input, Badge, Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const TABS = [
  { id: "cloudflare", label: "Cloudflare Workers AI" },
  { id: "ammail", label: "Ammail Temp Mail" },
];

function passwordHeader() {
  if (typeof window === "undefined") return "";
  return window.__9R_DASHBOARD_PASSWORD__ || "";
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-9r-password": passwordHeader(),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── Cloudflare Tab ──────────────────────────────────────────────
function CloudflareTab() {
  const [globalApiKey, setGlobalApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const notify = useNotificationStore();

  const validate = async () => {
    if (!globalApiKey || !email) {
      setError("Email + Global API Key wajib diisi.");
      return;
    }
    setError("");
    setValidating(true);
    setValidation(null);
    try {
      const data = await apiFetch("/api/automation/cloudflare-ai/validate", {
        method: "POST",
        body: JSON.stringify({ globalApiKey, email }),
      });
      setValidation(data);
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setValidating(false);
    }
  };

  const submit = async () => {
    if (!globalApiKey || !email) {
      setError("Email + Global API Key wajib diisi.");
      return;
    }
    setError("");
    setSubmitting(true);
    setResult(null);
    try {
      const data = await apiFetch("/api/automation/cloudflare-ai", {
        method: "POST",
        body: JSON.stringify({ globalApiKey, email, tokenName }),
      });
      setResult(data);
      notify.success(data.message || "Token created");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary">
              Cloudflare Workers AI — Auto Setup Token
            </h3>
            <p className="text-xs text-text-muted mt-1">
              Masukkan <b>Global API Key</b> + email akun Cloudflare. Sistem akan
              otomatis membuat API Token scoped ke Workers AI:Read + Workers AI:Edit
              (+ Account Analytics:Read untuk quota tracking) dan menyimpannya ke
              daftar Provider Connections.
            </p>
          </div>

          <div>
            <label className="text-xs text-text-muted">Email Cloudflare</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kamu@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">Global API Key</label>
            <Input
              type="password"
              value={globalApiKey}
              onChange={(e) => setGlobalApiKey(e.target.value)}
              placeholder="37 hex chars — from dash.cloudflare.com → My Profile → API Tokens → Global API Key → View"
            />
            <a
              href="https://dash.cloudflare.com/profile/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline"
            >
              Temukan di sini ↗
            </a>
          </div>
          <div>
            <label className="text-xs text-text-muted">
              Token Name (opsional)
            </label>
            <Input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="9router Workers AI"
            />
          </div>

          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={validate}
              disabled={validating || submitting}
            >
              {validating ? "Memvalidasi..." : "1. Validasi Kredensial"}
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={submitting || validating}
            >
              {submitting ? "Membuat Token..." : "2. Buat Token & Simpan"}
            </Button>
          </div>

          {validation && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs">
              <div className="font-semibold text-emerald-600 mb-1">
                ✓ Kredensial valid — {accounts.length} akun ditemukan
              </div>
              <ul className="space-y-0.5">
                {accounts.map((a) => (
                  <li key={a.id} className="font-mono text-text-secondary">
                    {a.name} <span className="text-text-muted">({a.id})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs space-y-1">
              <div className="font-semibold text-emerald-600">
                ✓ Token berhasil dibuat & disimpan!
              </div>
              <div className="font-mono text-text-secondary">
                Account: {result.accountName} ({result.accountId})
              </div>
              <div className="font-mono text-text-muted">
                Connection ID: {result.connectionId || "-"}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Ammail Tab ─────────────────────────────────────────────────
function AmmailTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    base_url: "",
    api_key: "",
    default_domain: "",
  });
  const [testResult, setTestResult] = useState(null);
  const [createAlias, setCreateAlias] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/automation/ammail");
      setData(res);
      setForm({
        base_url: res.settings?.base_url || "",
        api_key: res.settings?.api_key || "",
        default_domain: res.settings?.default_domain || "",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/automation/ammail", {
        method: "POST",
        body: JSON.stringify({ action: "settings", ...form }),
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const res = await apiFetch("/api/automation/ammail", {
        method: "POST",
        body: JSON.stringify({ action: "test-connection", ...form }),
      });
      setTestResult({ ok: true, info: res.info });
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const createInbox = async () => {
    if (!createAlias.trim()) return;
    setCreating(true);
    setError("");
    try {
      await apiFetch("/api/automation/ammail", {
        method: "POST",
        body: JSON.stringify({
          action: "create-inbox",
          alias: createAlias.trim(),
          domain: form.default_domain,
        }),
      });
      setCreateAlias("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteInbox = async (alias) => {
    if (!confirm(`Hapus inbox ${alias}?`)) return;
    try {
      await apiFetch("/api/automation/ammail", {
        method: "POST",
        body: JSON.stringify({ action: "delete-inbox", alias }),
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-text-muted">Memuat...</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">
              Ammail Temp Mail
            </h3>
            <p className="text-xs text-text-muted mt-1">
              Ammail adalah temp-mail service untuk menerima email verifikasi saat
              register akun Cloudflare otomatis. Deploy worker Ammail dari repo{" "}
              <a
                href="https://github.com/decolua/9router/tree/master/tempmail"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                9router/tempmail
              </a>{" "}
              ke Cloudflare Workers, lalu hubungkan di sini.
            </p>
          </div>

          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-2">
              {error}
            </div>
          )}

          {data && (
            <div className="flex items-center gap-2 text-xs">
              {data.connection_ok ? (
                <Badge variant="success" dot>
                  Connected
                </Badge>
              ) : data.configured ? (
                <Badge variant="error" dot>
                  {data.connection_error || "Connection Failed"}
                </Badge>
              ) : (
                <Badge variant="default" dot>
                  Not Configured
                </Badge>
              )}
              {data.domains?.length > 0 && (
                <span className="text-text-muted">
                  Domain: {data.domains.join(", ")}
                </span>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-text-muted">Base URL</label>
            <Input
              value={form.base_url}
              onChange={(e) =>
                setForm((p) => ({ ...p, base_url: e.target.value }))
              }
              placeholder="https://tempmail.example.com"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">API Key</label>
            <Input
              type="password"
              value={form.api_key}
              onChange={(e) =>
                setForm((p) => ({ ...p, api_key: e.target.value }))
              }
              placeholder="tm_xxxxx..."
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">Default Domain</label>
            <Input
              value={form.default_domain}
              onChange={(e) =>
                setForm((p) => ({ ...p, default_domain: e.target.value }))
              }
              placeholder="example.com"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={test}
              disabled={testing || saving}
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={saving || testing}
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>

          {testResult && (
            <div
              className={`rounded-md p-2 text-xs border ${
                testResult.ok
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                  : "border-red-500/20 bg-red-500/10 text-red-500"
              }`}
            >
              {testResult.ok
                ? "✓ Koneksi berhasil!"
                : `✗ ${testResult.error}`}
            </div>
          )}
        </div>
      </Card>

      {data?.configured && data?.inboxes?.length > 0 && (
        <Card>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text-primary">
              Inbox ({data.inboxes.length})
            </h3>
            <div className="space-y-1">
              {data.inboxes.map((i) => (
                <div
                  key={i.alias}
                  className="flex items-center justify-between text-xs p-2 rounded border border-border"
                >
                  <span className="font-mono text-text-secondary">
                    {i.address}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteInbox(i.alias)}
                  >
                    Hapus
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Input
                value={createAlias}
                onChange={(e) => setCreateAlias(e.target.value)}
                placeholder="alias baru (contoh: andi123)"
              />
              <Button onClick={createInbox} disabled={creating}>
                {creating ? "Membuat..." : "Buat Inbox"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────
export default function AutomationPageClient() {
  const [tab, setTab] = useState("cloudflare");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Automation</h1>
        <p className="text-xs text-text-muted mt-1">
          Setup otomatis untuk akun Cloudflare Workers AI (auto-generate API
          token) dan Ammail temp-mail service (untuk menerima email verifikasi).
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cloudflare" && <CloudflareTab />}
      {tab === "ammail" && <AmmailTab />}
    </div>
  );
}

AutomationPageClient.propTypes = {};
