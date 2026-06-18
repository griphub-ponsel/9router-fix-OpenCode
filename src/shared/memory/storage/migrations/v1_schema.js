/**
 * Memory System Database Schema (SQLite)
 * Initial migration for 9router memory layer
 */

const SCHEMA_VERSION = '1.0.0';

const CREATE_TABLES_SQL = `
-- Core tables
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT,
    user_id TEXT,
    agent_id TEXT,
    provider TEXT,
    model TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    status TEXT CHECK(status IN ('active', 'completed', 'archived')),
    token_count INTEGER DEFAULT 0,
    metadata JSON
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('prompt', 'tool_use', 'tool_result', 'error', 'file_access')),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT, -- For deduplication
    raw_content TEXT NOT NULL,
    privacy_filtered BOOLEAN DEFAULT 0,
    is_sensitive BOOLEAN DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_hash ON observations(content_hash);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    type TEXT CHECK(type IN ('conversation', 'user_pref', 'project', 'agent', 'episodic', 'semantic', 'procedural')),
    scope TEXT CHECK(scope IN ('global', 'workspace', 'project', 'session', 'agent', 'user')),
    workspace_id TEXT,
    project_id TEXT,
    user_id TEXT,
    agent_id TEXT,
    
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    
    embedding FLOAT[384], -- Optional, for vector search
    
    importance_score REAL DEFAULT 1.0,
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    ttl_days INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_type_scope ON memories(type, scope);
CREATE INDEX IF NOT EXISTS idx_memories_workspace_project ON memories(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_agent ON memories(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_graph (
    id TEXT PRIMARY KEY,
    source_memory_id TEXT,
    node_type TEXT CHECK(node_type IN ('entity', 'concept', 'relationship')),
    label TEXT NOT NULL,
    properties JSON,
    embedding FLOAT[384],
    
    FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kg_source ON knowledge_graph(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_kg_label ON knowledge_graph(label);

CREATE TABLE IF NOT EXISTS fact_cache (
    content_hash TEXT PRIMARY KEY,
    fact_text TEXT NOT NULL,
    category TEXT,
    confidence REAL,
    source_session_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_verified TIMESTAMP,
    
    FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_category ON fact_cache(category);

-- User preferences and settings
CREATE TABLE IF NOT EXISTS memory_settings (
    setting_key TEXT PRIMARY KEY,
    scope TEXT CHECK(scope IN ('global', 'workspace', 'project', 'user')),
    value JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    workspace_id TEXT,
    user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_settings_scope ON memory_settings(scope);

-- Audit log for memory operations
CREATE TABLE IF NOT EXISTS memory_audit_log (
    id TEXT PRIMARY KEY,
    action TEXT CHECK(action IN ('create', 'update', 'delete', 'access', 'consolidate', 'decay')),
    memory_id TEXT,
    user_id TEXT,
    changes JSON,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_memory ON memory_audit_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON memory_audit_log(user_id);

-- Version tracking table
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

INSERT OR IGNORE INTO schema_version (version, description) 
VALUES ('${SCHEMA_VERSION}', 'Initial memory system schema');
`;

module.exports = {
  SCHEMA_VERSION,
  CREATE_TABLES_SQL
};
