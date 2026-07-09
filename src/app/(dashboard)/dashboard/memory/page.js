"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Modal, ModelSelectModal } from "@/shared/components";

const scopeStyles = {
  global: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  workspace: "bg-blue/10 text-blue border-blue/20",
  project: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  user: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  session: "bg-orange/10 text-orange border-orange/20",
  agent: "bg-primary/10 text-primary border-primary/20",
};

const scopeLabels = {
  global: "Global",
  workspace: "Workspace",
  project: "Project",
  user: "User",
  session: "Session",
  agent: "Agent",
};

const scopeOrder = ["user", "session", "workspace", "project", "global", "agent"];

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ icon, label, value, tone = "primary" }) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    green: "bg-emerald-500/10 text-emerald-500",
    blue: "bg-blue/10 text-blue",
    orange: "bg-orange/10 text-orange",
  }[tone];

  return (
    <Card
      padding="sm"
      className="min-h-[96px] border-border-subtle/80 bg-gradient-to-br from-surface to-surface/70 shadow-[var(--shadow-elevated)]"
    >
      <div className="flex h-full items-center gap-4">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-[12px] ${toneClass}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-text-main">{value}</p>
        </div>
      </div>
    </Card>
  );
}

export default function MemoryDashboard() {
  const [memories, setMemories] = useState([]);
  const [pinnedMemories, setPinnedMemories] = useState([]);
  const [facts, setFacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState("hybrid"); // 'keyword' | 'hybrid' | 'semantic'
  const [lastSearchMode, setLastSearchMode] = useState("hybrid");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [loading, setLoading] = useState(true);
  const [consolidating, setConsolidating] = useState(false);
  const [actionMessage, setActionMessage] = useState(null); // { type: 'success'|'info', text: string }
  const [lastUpdated, setLastUpdated] = useState(null);
  // Auto-memory extraction model (settings.memoryExtractModel)
  const [extractModel, setExtractModel] = useState("");
  const [extractModelModalOpen, setExtractModelModalOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  const fetchExtractionConfig = async () => {
    try {
      const [settingsRes, providersRes, aliasRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/providers"),
        fetch("/api/models/alias"),
      ]);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setExtractModel(typeof s.memoryExtractModel === "string" ? s.memoryExtractModel : "");
      }
      if (providersRes.ok) {
        const p = await providersRes.json();
        setActiveProviders(p.connections || []);
      }
      if (aliasRes.ok) {
        const a = await aliasRes.json();
        setModelAliases(a.aliases || {});
      }
    } catch (error) {
      console.error("Failed to fetch extraction config:", error);
    }
  };

  const saveExtractModel = async (model) => {
    setExtractModel(model);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryExtractModel: model }),
      });
      if (res.ok) {
        setActionMessage({ type: "success", text: model ? `Extraction model set: ${model}` : "Extraction model reset to default (auto alias)" });
      } else {
        setActionMessage({ type: "info", text: "Failed to save extraction model" });
      }
    } catch (error) {
      console.error("Failed to save extraction model:", error);
      setActionMessage({ type: "info", text: "Failed to save extraction model" });
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const fetchPinned = async () => {
    try {
      const res = await fetch("/api/memory/pinned?limit=20");
      const data = await res.json();
      setPinnedMemories(data.pinned || []);
    } catch (error) {
      console.error("Failed to fetch pinned:", error);
    }
  };

  const fetchFacts = async () => {
    try {
      const res = await fetch("/api/memory/facts?limit=50");
      const data = await res.json();
      setFacts(data.facts || []);
    } catch (error) {
      console.error("Failed to fetch facts:", error);
    }
  };

  const fetchStats = async () => {
    const res = await fetch("/api/memory/stats");
    const data = await res.json();
    setStats(data);
  };

  const fetchMemories = async (query = "", modeOverride = null) => {
    setLoading(true);
    try {
      const effectiveMode = modeOverride || searchMode;
      const params = new URLSearchParams({
        limit: 50,
        mode: effectiveMode,
        ...(query && { q: query }),
      });

      const res = await fetch(`/api/memory/search?${params}`);
      const data = await res.json();
      setMemories(data.memories || []);
      if (data.mode) {
        setLastSearchMode(data.mode);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats().catch((error) => console.error("Failed to fetch stats:", error));
    fetchPinned().catch((error) => console.error("Failed to fetch pinned:", error));
    fetchFacts().catch((error) => console.error("Failed to fetch facts:", error));
    fetchExtractionConfig();
    fetchMemories();
  }, []);

  const availableScopes = useMemo(() => {
    const scopes = Array.from(new Set(memories.map((memory) => memory.scope).filter(Boolean)));
    return scopes.sort((a, b) => {
      const ia = scopeOrder.indexOf(a);
      const ib = scopeOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [memories]);

  const filteredMemories = useMemo(() => {
    if (scopeFilter === "all") return memories;
    return memories.filter((memory) => memory.scope === scopeFilter);
  }, [memories, scopeFilter]);

  const handleSearch = (event) => {
    event.preventDefault();
    fetchMemories(searchQuery.trim());
  };

  const handleModeChange = (newMode) => {
    setSearchMode(newMode);
    // Re-fetch with the new mode immediately
    fetchMemories(searchQuery.trim(), newMode);
  };

  const handleDelete = async (memoryId) => {
    if (!confirm("Delete this memory?")) return;

    try {
      const res = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      if (res.ok) {
        setMemories((items) => items.filter((memory) => memory.id !== memoryId));
        setPinnedMemories((items) => items.filter((m) => m.id !== memoryId));
        await fetchStats();
        await fetchPinned();
        await fetchFacts();
      }
    } catch (error) {
      console.error("Failed to delete memory:", error);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch(`/api/memory/export?format=${exportFormat}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `9router-memory-export.${exportFormat}`;
      link.click();
      window.URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (error) {
      console.error("Failed to export:", error);
    }
  };

  const handleTogglePin = async (memoryId, currentlyPinned) => {
    try {
      const res = await fetch("/api/memory/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memoryId,
          action: currentlyPinned ? "unpin" : "pin"
        })
      });
      if (res.ok) {
        // Refresh list + stats + pinned slots
        await fetchStats();
        await fetchPinned();
        await fetchMemories(searchQuery.trim());
      }
    } catch (error) {
      console.error("Failed to toggle pin:", error);
    }
  };

  const handleSummarize = async (memory) => {
    if (!confirm("Summarize this memory content with LLM?")) return;
    try {
      const res = await fetch("/api/memory/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: memory.content,
          title: `Summary: ${memory.title || "Memory"}`,
          scope: memory.scope
        })
      });
      const data = await res.json();
      if (data.success) {
        await fetchStats();
        await fetchPinned();
        await fetchMemories(searchQuery.trim());
        alert("Summary created as new memory!");
      }
    } catch (error) {
      console.error("Summarize failed:", error);
    }
  };

  const handleConsolidate = async () => {
    if (!confirm("Run consolidation now? (merge duplicates + decay + episodic summaries)")) return;
    try {
      const res = await fetch("/api/memory/consolidate", { method: "POST" });
      const data = await res.json();
      const msg = `Consolidation done!\n• Merged: ${data.merged || 0}\n• Decayed: ${data.decayed || 0}\n• Episodic summaries: ${data.episodic || 0}\n• Facts extracted: ${data.facts || 0}`;
      alert(msg);
      await fetchStats();
      await fetchPinned();
      await fetchFacts();
      await fetchMemories(searchQuery.trim());
    } catch (error) {
      console.error("Consolidate failed:", error);
    }
  };

  return (
    <div className="space-y-6 pb-2">
      <div className="relative overflow-hidden rounded-[18px] border border-border-subtle bg-gradient-to-br from-surface via-surface to-bg p-5 shadow-[var(--shadow-elevated)]">
        <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-brand-500/10 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-blue/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[var(--shadow-warm)]">
              <span className="material-symbols-outlined text-[22px]">memory</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-text-main">Memory System</h1>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                Persistent context captured from prompts and sessions, searchable across providers.
              </p>
              {/* Phase 2 embedding status */}
              {stats?.embedding && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${stats.embedding.hasService && stats.embedding.provider !== 'none'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-500'}`}>
                    <span className="material-symbols-outlined text-[12px]">psychology</span>
                    Vector: {stats.embedding.provider || 'none'}
                    {stats.embedding.dimension ? ` (${stats.embedding.dimension}d)` : ''}
                  </span>
                  <span className="text-text-muted">Mode aktif: <strong className="text-text-main">{lastSearchMode}</strong></span>
                </div>
              )}
            </div>
          </div>
          <Button onClick={() => setShowExportModal(true)} variant="secondary" icon="download">
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard icon="database" label="Total Memories" value={stats?.totalMemories || 0} />
        <StatCard icon="push_pin" label="Pinned Slots" value={stats?.pinnedMemories || 0} tone="orange" />
        <StatCard icon="fact_check" label="Facts" value={stats?.totalFacts || 0} tone="green" />
        <StatCard icon="history" label="Observations" value={stats?.totalObservations || 0} tone="green" />
        <StatCard icon="category" label="Memory Types" value={Object.keys(stats?.memoriesByType || {}).length} tone="blue" />
        <StatCard icon="schedule" label="Last Updated" value={lastUpdated ? lastUpdated.toLocaleTimeString("id-ID") : "-"} tone="orange" />
      </div>

      {/* Auto-Memory Extraction Model */}
      <Card padding="sm" className="border-border-subtle/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">psychology_alt</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-main">Auto-Memory Extraction Model</h2>
              <p className="mt-0.5 max-w-2xl text-xs text-text-muted">
                9Router self-calls this model after each chat to decide what&apos;s worth remembering (ChatGPT-style).
                Pick a cheap/free model — it runs in the background on every conversation. Empty = use the <code className="rounded bg-black/5 px-1 dark:bg-white/10">auto</code> alias.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extractModel ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary" title={extractModel}>
                <span className="material-symbols-outlined text-[13px]">psychology_alt</span>
                <span className="max-w-[18rem] truncate">{extractModel}</span>
                <button
                  onClick={() => saveExtractModel("")}
                  className="flex items-center justify-center rounded-full text-primary/60 transition-colors hover:text-red-500"
                  title="Reset to default (auto alias)"
                >
                  <span className="material-symbols-outlined text-[13px]">close</span>
                </button>
              </span>
            ) : (
              <span className="text-xs text-text-muted">Default (auto alias)</span>
            )}
            <Button onClick={() => setExtractModelModalOpen(true)} variant="secondary" size="sm" icon="tune" disabled={!activeProviders.length}>
              Select Model
            </Button>
          </div>
        </div>
        {actionMessage && (
          <div className={`mt-3 flex items-center gap-2 rounded-[8px] px-3 py-1.5 text-xs ${actionMessage.type === "success" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
            <span className="material-symbols-outlined text-[14px]">{actionMessage.type === "success" ? "check_circle" : "info"}</span>
            <span>{actionMessage.text}</span>
          </div>
        )}
      </Card>

      {/* Pinned Memory Slots (Phase 3) */}
      {pinnedMemories.length > 0 && (
        <Card padding="none" className="overflow-hidden border-orange/30">
          <div className="flex items-center justify-between border-b border-border-subtle bg-orange/5 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-orange">push_pin</span>
              <h2 className="font-semibold text-text-main">Pinned Memory Slots</h2>
              <span className="rounded-full bg-orange/10 px-2 py-0.5 text-xs font-medium text-orange">
                {pinnedMemories.length}
              </span>
            </div>
            <span className="text-[11px] text-text-muted">Tetap di atas • prioritas tinggi</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {pinnedMemories.map((memory) => (
              <div
                key={memory.id}
                className="group flex cursor-pointer items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60"
                onClick={() => setSelectedMemory(memory)}
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-orange/10 text-orange ring-1 ring-orange/20">
                  <span className="material-symbols-outlined text-[16px]">push_pin</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scopeStyles[memory.scope] || scopeStyles.agent}`}>
                      {scopeLabels[memory.scope] || memory.scope || "memory"}
                    </span>
                    <span className="text-text-muted">{formatDate(memory.created_at)}</span>
                    {memory.type ? <span className="text-text-muted">{memory.type.replace(/_/g, " ")}</span> : null}
                  </div>
                  <h3 className="truncate text-sm font-semibold text-text-main">{memory.title || "Untitled memory"}</h3>
                  <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{memory.content}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleTogglePin(memory.id, true);
                  }}
                  className="rounded-[8px] p-2 text-orange opacity-70 transition-all hover:bg-orange/10 hover:opacity-100 group-hover:opacity-100"
                  title="Unpin (remove from Memory Slots)"
                >
                  <span className="material-symbols-outlined text-[18px]">push_pin</span>
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Extracted Facts (Phase 3) */}
      {facts.length > 0 && (
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-emerald-500/5 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-500">fact_check</span>
              <h2 className="font-semibold text-text-main">Extracted Facts</h2>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                {facts.length}
              </span>
            </div>
            <span className="text-[11px] text-text-muted">Dari sesi / ringkasan</span>
          </div>
          <div className="max-h-60 divide-y divide-border-subtle overflow-auto">
            {facts.slice(0, 15).map((fact, idx) => (
              <div key={idx} className="px-5 py-2.5 text-sm">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                    {fact.category || 'fact'}
                  </span>
                  {fact.confidence != null && (
                    <span className="text-[10px] text-text-muted">
                      {Math.round((fact.confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-text-main">
                  {fact.fact_text || fact.factText || fact.text || (typeof fact === 'string' ? fact : JSON.stringify(fact))}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padding="sm" className="border-border-subtle/80 bg-surface/95">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search memories by title or content"
              className="h-10 w-full rounded-[10px] border border-border-subtle bg-bg pl-10 pr-4 text-sm text-text-main outline-none transition-colors placeholder:text-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button type="submit" icon="search" className="sm:w-auto">
            Search
          </Button>
        </form>

        {/* Search Mode Selector (Phase 2) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted pr-1">Search:</span>
          {[
            { key: "keyword", label: "Keyword", icon: "search" },
            { key: "hybrid", label: "Hybrid", icon: "tune" },
            { key: "semantic", label: "Semantic", icon: "psychology" }
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => handleModeChange(m.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors flex items-center gap-1 ${
                searchMode === m.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border-subtle bg-bg text-text-muted hover:border-primary/20 hover:text-text-main"
              }`}
              title={m.key === "hybrid" ? "Keyword + Vector (recommended)" : m.key}
            >
              <span className="material-symbols-outlined text-[14px]">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted pr-1">Scope:</span>
          <button
            type="button"
            onClick={() => setScopeFilter("all")}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              scopeFilter === "all"
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border-subtle bg-bg text-text-muted hover:border-primary/20 hover:text-text-main"
            }`}
          >
            All scopes
          </button>
          {availableScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setScopeFilter(scope)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                scopeFilter === scope
                  ? scopeStyles[scope] || scopeStyles.agent
                  : "border-border-subtle bg-bg text-text-muted hover:border-primary/20 hover:text-text-main"
              }`}
            >
              {scopeLabels[scope] || scope}
            </button>
          ))}
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="font-semibold text-text-main">Recent Memories</h2>
            <p className="text-xs text-text-muted">Showing {filteredMemories.length} of {memories.length} loaded</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon="autorenew" onClick={handleConsolidate} title="Run consolidation (merge + decay + episodic)">
              Consolidate
            </Button>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => { fetchStats(); fetchPinned(); fetchFacts(); fetchMemories(searchQuery.trim()); }}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 px-5 py-5">
            {[1, 2, 3].map((row) => (
              <div key={row} className="animate-pulse rounded-[12px] border border-border-subtle bg-surface px-4 py-3">
                <div className="mb-2 h-2.5 w-32 rounded bg-surface-3" />
                <div className="mb-1.5 h-3.5 w-2/3 rounded bg-surface-3" />
                <div className="h-3.5 w-full rounded bg-surface-3" />
              </div>
            ))}
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted">
            <span className="material-symbols-outlined mb-3 text-[36px]">folder_off</span>
            <p className="font-medium text-text-main">No memories found</p>
            <p className="mt-1 text-sm">
              {scopeFilter === "all"
                ? "Prompt capture will add memories here when it detects useful facts."
                : `No memories found in ${scopeLabels[scopeFilter] || scopeFilter} scope.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredMemories.map((memory) => (
              <div
                key={memory.id}
                className="group flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60"
                onClick={() => setSelectedMemory(memory)}
              >
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary ring-1 ring-primary/20">
                  <span className="material-symbols-outlined text-[18px]">bookmark</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${scopeStyles[memory.scope] || scopeStyles.agent}`}>
                      {scopeLabels[memory.scope] || memory.scope || "memory"}
                    </span>
                    <span className="text-text-muted">{formatDate(memory.created_at)}</span>
                    {memory.type ? <span className="text-text-muted">{memory.type.replace(/_/g, " ")}</span> : null}
                  </div>
                  <h3 className="truncate text-sm font-semibold text-text-main">{memory.title || "Untitled memory"}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-text-muted">{memory.content}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleTogglePin(memory.id, !!memory.is_pinned);
                    }}
                    className={`rounded-[8px] p-2 transition-colors ${memory.is_pinned ? 'text-orange' : 'text-text-muted hover:text-orange'}`}
                    title={memory.is_pinned ? "Unpin memory" : "Pin memory (Memory Slot)"}
                  >
                    <span className="material-symbols-outlined text-[18px]">{memory.is_pinned ? "push_pin" : "push_pin"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSummarize(memory);
                    }}
                    className="rounded-[8px] p-2 text-text-muted hover:text-primary"
                    title="Summarize this memory with LLM"
                  >
                    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDelete(memory.id);
                    }}
                    className="rounded-[8px] p-2 text-text-muted hover:bg-red-500/10 hover:text-red-500"
                    title="Delete memory"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="rounded-[14px] border border-border-subtle bg-surface px-5 py-4 text-sm text-text-muted shadow-[var(--shadow-soft)]">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined mt-0.5 text-primary">tips_and_updates</span>
          <div>
            <h3 className="font-semibold text-text-main">Capture rules</h3>
            <p className="mt-1">
              Explicit prompts like “ingat nama gw Aldrey” or “inget gw sekarang umur 27” are saved as user preferences and appear in this list.
            </p>
          </div>
        </div>
      </div>

      {selectedMemory && (
        <Modal isOpen={!!selectedMemory} onClose={() => setSelectedMemory(null)} title={selectedMemory.title}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[10px] border border-border-subtle bg-bg p-3">
                <p className="text-xs font-semibold uppercase text-text-muted">Type</p>
                <p className="mt-1 text-sm capitalize text-text-main">{selectedMemory.type?.replace(/_/g, " ")}</p>
              </div>
              <div className="rounded-[10px] border border-border-subtle bg-bg p-3">
                <p className="text-xs font-semibold uppercase text-text-muted">Scope</p>
                <p className="mt-1 text-sm capitalize text-text-main">{scopeLabels[selectedMemory.scope] || selectedMemory.scope}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-text-muted">Content</p>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-[10px] border border-border-subtle bg-bg p-3 text-sm text-text-main custom-scrollbar whitespace-pre-wrap">
                {selectedMemory.content}
              </div>
            </div>
            <pre className="max-h-56 overflow-auto rounded-[10px] border border-border-subtle bg-bg p-3 text-xs text-text-muted custom-scrollbar">
              {JSON.stringify(selectedMemory, null, 2)}
            </pre>
          </div>
        </Modal>
      )}

      {showExportModal && (
        <Modal isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="Export Memory Data">
          <div className="space-y-4">
            <div className="grid gap-2">
              {["json", "csv", "markdown"].map((format) => (
                <label key={format} className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border-subtle p-3 transition-colors hover:border-primary/40">
                  <input
                    type="radio"
                    name="format"
                    value={format}
                    checked={exportFormat === format}
                    onChange={(event) => setExportFormat(event.target.value)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium capitalize text-text-main">{format}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={handleExport} icon="download" className="flex-1">
                Export
              </Button>
              <Button variant="secondary" onClick={() => setShowExportModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ModelSelectModal
        isOpen={extractModelModalOpen}
        onClose={() => setExtractModelModalOpen(false)}
        onSelect={(model) => saveExtractModel(model.value)}
        onDeselect={() => saveExtractModel("")}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={extractModel ? [extractModel] : []}
        closeOnSelect={true}
        title="Select Auto-Memory Extraction Model"
      />
    </div>
  );
}