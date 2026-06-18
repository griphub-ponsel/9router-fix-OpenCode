"use client";

import { useEffect, useState } from "react";
import { Button, Card, Modal } from "@/shared/components";

const scopeStyles = {
  global: "bg-text-muted/10 text-text-muted border-text-muted/20",
  workspace: "bg-blue/10 text-blue border-blue/20",
  project: "bg-purple/10 text-purple border-purple/20",
  user: "bg-green/10 text-green border-green/20",
  session: "bg-orange/10 text-orange border-orange/20",
  agent: "bg-primary/10 text-primary border-primary/20",
};

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
    green: "bg-green/10 text-green",
    blue: "bg-blue/10 text-blue",
    orange: "bg-orange/10 text-orange",
  }[tone];

  return (
    <Card padding="sm" className="min-h-[92px]">
      <div className="flex h-full items-center gap-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${toneClass}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-text-main">{value}</p>
        </div>
      </div>
    </Card>
  );
}

export default function MemoryDashboard() {
  const [memories, setMemories] = useState([]);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStats = async () => {
    const res = await fetch("/api/memory/stats");
    const data = await res.json();
    setStats(data);
  };

  const fetchMemories = async (query = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: 50,
        ...(query && { q: query }),
      });

      const res = await fetch(`/api/memory/search?${params}`);
      const data = await res.json();
      setMemories(data.memories || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats().catch((error) => console.error("Failed to fetch stats:", error));
    fetchMemories();
  }, []);

  const handleSearch = (event) => {
    event.preventDefault();
    fetchMemories(searchQuery.trim());
  };

  const handleDelete = async (memoryId) => {
    if (!confirm("Delete this memory?")) return;

    try {
      const res = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      if (res.ok) {
        setMemories((items) => items.filter((memory) => memory.id !== memoryId));
        await fetchStats();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[var(--shadow-warm)]">
            <span className="material-symbols-outlined text-[24px]">smart_token</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-text-main">Memory System</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Persistent context captured from prompts and sessions, searchable across providers.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowExportModal(true)} variant="secondary" icon="download">
          Export
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="database" label="Total Memories" value={stats?.totalMemories || 0} />
        <StatCard icon="history" label="Observations" value={stats?.totalObservations || 0} tone="green" />
        <StatCard icon="category" label="Memory Types" value={Object.keys(stats?.memoriesByType || {}).length} tone="blue" />
        <StatCard icon="schedule" label="Last Updated" value={lastUpdated ? lastUpdated.toLocaleTimeString("id-ID") : "-"} tone="orange" />
      </div>

      <Card padding="sm">
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
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="font-semibold text-text-main">Recent Memories</h2>
            <p className="text-xs text-text-muted">Showing {memories.length} of {stats?.totalMemories || 0}</p>
          </div>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => { fetchStats(); fetchMemories(searchQuery.trim()); }}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-muted">
            <span className="material-symbols-outlined animate-spin text-[22px]">progress_activity</span>
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted">
            <span className="material-symbols-outlined mb-3 text-[36px]">folder_off</span>
            <p className="font-medium text-text-main">No memories found</p>
            <p className="mt-1 text-sm">Prompt capture will add memories here when it detects useful facts.</p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {memories.map((memory) => (
              <div
                key={memory.id}
                className="group flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2/50"
                onClick={() => setSelectedMemory(memory)}
              >
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[18px]">bookmark</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${scopeStyles[memory.scope] || scopeStyles.agent}`}>
                      {memory.scope || "memory"}
                    </span>
                    <span className="text-xs text-text-muted">{formatDate(memory.created_at)}</span>
                    {memory.type ? <span className="text-xs text-text-muted">{memory.type.replace(/_/g, " ")}</span> : null}
                  </div>
                  <h3 className="truncate text-sm font-semibold text-text-main">{memory.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-text-muted">{memory.content}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(memory.id);
                  }}
                  className="rounded-[8px] p-2 text-text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                  title="Delete memory"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
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
                <p className="mt-1 text-sm capitalize text-text-main">{selectedMemory.scope}</p>
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
    </div>
  );
}