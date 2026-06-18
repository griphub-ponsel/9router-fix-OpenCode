"use client";

import { useState, useEffect } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Modal from "@/shared/components/Modal";

export default function MemoryDashboard() {
  const [memories, setMemories] = useState([]);
  const [observations, setObservations] = useState([]);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [loading, setLoading] = useState(true);

  // Fetch memory statistics
  const fetchStats = async () => {
    try {
      const res = await fetch("/api/memory/stats");
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  // Fetch memories
  const fetchMemories = async (query = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: 50,
        ...(query && { q: query })
      });
      
      const res = await fetch(`/api/memory/search?${params}`);
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load initial data
  useEffect(() => {
    console.log("🧠 Memory Dashboard loaded for user: aldrey");
    fetchStats();
    fetchMemories();
  }, []);

  // Handle search
  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      fetchMemories(searchQuery);
    } else {
      fetchMemories();
    }
  };

  // Handle delete
  const handleDelete = async (memoryId) => {
    if (!confirm("Are you sure you want to delete this memory?")) return;
    
    try {
      const res = await fetch(`/api/memory/${memoryId}`, {
        method: "DELETE"
      });
      
      if (res.ok) {
        setMemories(memories.filter(m => m.id !== memoryId));
        fetchStats();
      }
    } catch (error) {
      console.error("Failed to delete memory:", error);
    }
  };

  // Handle export
  const handleExport = async () => {
    try {
      const res = await fetch(`/api/memory/export?format=${exportFormat}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `9router-memory-export.${exportFormat}`;
      a.click();
      window.URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (error) {
      console.error("Failed to export:", error);
    }
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("id-ID", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Memory System</h1>
          <p className="text-sm text-text-muted mt-1">
            Manage your persistent AI memory across models and sessions
          </p>
        </div>
        <Button onClick={() => setShowExportModal(true)} variant="secondary">
          Export Memory
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined">notes</span>
            </div>
            <div>
              <p className="text-xs text-text-muted">Total Memories</p>
              <p className="text-2xl font-bold">{stats?.totalMemories || 0}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green/10 text-green">
              <span className="material-symbols-outlined">record_voice_over</span>
            </div>
            <div>
              <p className="text-xs text-text-muted">Observations</p>
              <p className="text-2xl font-bold">{stats?.totalObservations || 0}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple/10 text-purple">
              <span className="material-symbols-outlined">collections_bookmark</span>
            </div>
            <div>
              <p className="text-xs text-text-muted">By Type</p>
              <p className="text-xl font-semibold">
                {Object.keys(stats?.memoriesByType || {}).length}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange/10 text-orange">
              <span className="material-symbols-outlined">analytics</span>
            </div>
            <div>
              <p className="text-xs text-text-muted">Last Updated</p>
              <p className="text-xs font-medium truncate">
                {new Date().toLocaleTimeString("id-ID")}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Search Bar */}
      <Card>
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories by title or content..."
            className="flex-1 px-4 py-2 rounded-lg border border-border-subtle bg-bg focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
          />
          <Button type="submit" icon="search">
            Search
          </Button>
        </form>
      </Card>

      {/* Memories List */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text-main">Recent Memories</h3>
          <span className="text-sm text-text-muted">
            Showing {memories.length} of {stats?.totalMemories || 0}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <span className="material-symbols-outlined text-4xl mb-2 block">folder_off</span>
            <p>No memories found. Start capturing observations!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {memories.map((memory) => (
              <div
                key={memory.id}
                className="rounded-lg border border-border-subtle p-4 hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => setSelectedMemory(memory)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        memory.scope === 'global' ? 'bg-gray/10 text-gray' :
                        memory.scope === 'workspace' ? 'bg-blue/10 text-blue' :
                        memory.scope === 'project' ? 'bg-purple/10 text-purple' :
                        memory.scope === 'user' ? 'bg-green/10 text-green' :
                        'bg-orange/10 text-orange'
                      }`}>
                        {memory.scope}
                      </span>
                      <span className="text-xs text-text-muted">
                        {formatDate(memory.created_at)}
                      </span>
                    </div>
                    
                    <h4 className="font-medium text-text-main truncate mb-1">
                      {memory.title}
                    </h4>
                    <p className="text-sm text-text-muted line-clamp-2">
                      {memory.content}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(memory.id);
                      }}
                      className="p-2 rounded-lg hover:bg-red/10 text-text-muted/70 hover:text-red-600 transition-colors"
                      title="Delete memory"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Memory Details Modal */}
      {selectedMemory && (
        <Modal
          isOpen={!!selectedMemory}
          onClose={() => setSelectedMemory(null)}
          title={selectedMemory.title}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                Type
              </label>
              <p className="text-sm text-text-main mt-1 capitalize">{selectedMemory.type}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                Scope
              </label>
              <p className="text-sm text-text-main capitalize">{selectedMemory.scope}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                Content
              </label>
              <div className="mt-2 p-3 rounded-lg bg-surface-1 border border-border-subtle text-sm text-text-main whitespace-pre-wrap max-h-60 overflow-y-auto">
                {selectedMemory.content}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Importance
                </label>
                <p className="text-sm text-text-main mt-1">
                  {(selectedMemory.importance_score * 100).toFixed(0)}%
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Access Count
                </label>
                <p className="text-sm text-text-main mt-1">
                  {selectedMemory.access_count || 0}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                Metadata
              </label>
              <pre className="mt-2 p-3 rounded-lg bg-surface-1 border border-border-subtle text-xs text-text-muted overflow-x-auto">
                {JSON.stringify(selectedMemory, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <Modal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          title="Export Memory Data"
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-main">Export Format</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-primary cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="format"
                    value="json"
                    checked={exportFormat === "json"}
                    onChange={(e) => setExportFormat(e.target.value)}
                    className="accent-primary"
                  />
                  <div>
                    <p className="font-medium text-text-main">JSON</p>
                    <p className="text-xs text-text-muted">Structured data format</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-primary cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={exportFormat === "csv"}
                    onChange={(e) => setExportFormat(e.target.value)}
                    className="accent-primary"
                  />
                  <div>
                    <p className="font-medium text-text-main">CSV</p>
                    <p className="text-xs text-text-muted">Spreadsheet compatible</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-primary cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="format"
                    value="markdown"
                    checked={exportFormat === "markdown"}
                    onChange={(e) => setExportFormat(e.target.value)}
                    className="accent-primary"
                  />
                  <div>
                    <p className="font-medium text-text-main">Markdown</p>
                    <p className="text-xs text-text-muted">Human-readable format</p>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-4 flex gap-3">
              <Button onClick={handleExport} className="flex-1">
                Export Data
              </Button>
              <Button variant="secondary" onClick={() => setShowExportModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Info Card */}
      <div className="rounded-lg bg-blue/5 border border-blue/20 p-4">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-blue-600">smart_toy</span>
          <div>
            <h4 className="font-semibold text-text-main text-sm">About Memory System</h4>
            <p className="text-sm text-text-muted mt-1">
              Hai Aldrey! The Memory System preserves context across different LLM providers and sessions. 
              Memories are automatically captured from tool usage and can be retrieved based on relevance.
              <br/><br/>
              <strong>Quick Tips:</strong><br/>
              • Search for specific knowledge using keywords<br/>
              • Export your memories for backup or migration<br/>
              • Delete outdated memories to keep storage clean<br/>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
