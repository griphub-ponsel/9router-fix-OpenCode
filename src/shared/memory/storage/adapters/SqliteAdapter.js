/**
 * SQLite Storage Adapter
 * Default persistence layer for memory system
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { CREATE_TABLES_SQL, SCHEMA_VERSION } = require('../migrations/v1_schema');
const StorageInterface = require('./BaseAdapter');
const { resolveMemoryDbPath } = require('../resolveMemoryDbPath');

class SqliteAdapter extends StorageInterface {
  constructor(config = {}) {
    super();
    // Always absolute + cwd-independent (see resolveMemoryDbPath)
    this.dbPath = resolveMemoryDbPath(config.dbPath);
    this.connection = null;
    this.initializePromise = null;
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize(config = {}) {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    const fs = require('fs');

    // Re-resolve in case caller passed a different path / env changed
    this.dbPath = resolveMemoryDbPath(config.dbPath || this.dbPath);

    console.log('[SqliteAdapter] DB Path:', this.dbPath);
    console.log('[SqliteAdapter] DB Dir exists:', fs.existsSync(path.dirname(this.dbPath)));
    
    // Ensure directory exists BEFORE initialization
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.initializePromise = new Promise((resolve, reject) => {
      // Use default OPEN_READONLY or just open normally (creates if not exists)
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Enable foreign keys
        this.db.run('PRAGMA foreign_keys = ON', (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Run schema creation
          this.db.exec(CREATE_TABLES_SQL, (err) => {
            if (err) {
              reject(new Error(`Schema initialization failed: ${err.message}`));
              return;
            }

            // Verify version
            this.db.get(
              'SELECT version FROM schema_version WHERE version = ?',
              [SCHEMA_VERSION],
              (err, row) => {
                if (err) {
                  reject(err);
                  return;
                }

                if (!row) {
                  this.db.run(
                    'INSERT INTO schema_version (version, description) VALUES (?, ?)',
                    [SCHEMA_VERSION, 'Memory system initialized'],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                } else {
                  resolve();
                }
              }
            );
          });
        });
      });
    });

    try {
      await this.initializePromise;
    } catch (error) {
      this.initializePromise = null;
      throw error;
    }

    // Best-effort: add embedding_json column for vector support (Phase 2)
    await new Promise((resolve) => {
      this.db.run(
        'ALTER TABLE memories ADD COLUMN embedding_json TEXT',
        (err) => { resolve(); }
      );
    });

    // Best-effort: add is_pinned for Memory Slots (Phase 3)
    await new Promise((resolve) => {
      this.db.run(
        'ALTER TABLE memories ADD COLUMN is_pinned INTEGER DEFAULT 0',
        (err) => { resolve(); }
      );
    });

    // Best-effort: relax observations.type CHECK to allow 'assistant_response'.
    // Existing DBs were created with the old constraint; SQLite can't ALTER a
    // CHECK, so rebuild the table once if the old constraint is detected.
    await this.migrateObservationTypeConstraint();

    return this;
  }

  /**
   * One-time migration: rebuild `observations` when its CHECK constraint
   * predates the 'assistant_response' type. No-op for fresh databases.
   */
  async migrateObservationTypeConstraint() {
    try {
      const row = await this.get(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'observations'"
      );
      if (!row?.sql || row.sql.includes('assistant_response')) return;

      await this.run('PRAGMA foreign_keys = OFF');
      await this.run('BEGIN TRANSACTION');
      await this.run(`
        CREATE TABLE observations_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          type TEXT CHECK(type IN ('prompt', 'assistant_response', 'tool_use', 'tool_result', 'error', 'file_access')),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          content_hash TEXT,
          raw_content TEXT NOT NULL,
          privacy_filtered BOOLEAN DEFAULT 0,
          is_sensitive BOOLEAN DEFAULT 0,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `);
      await this.run(`
        INSERT INTO observations_new (id, session_id, type, timestamp, content_hash, raw_content, privacy_filtered, is_sensitive)
        SELECT id, session_id, type, timestamp, content_hash, raw_content, privacy_filtered, is_sensitive FROM observations
      `);
      await this.run('DROP TABLE observations');
      await this.run('ALTER TABLE observations_new RENAME TO observations');
      await this.run('CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_observations_hash ON observations(content_hash)');
      await this.run('COMMIT');
      await this.run('PRAGMA foreign_keys = ON');
    } catch (error) {
      try { await this.run('ROLLBACK'); } catch { /* not in a transaction */ }
      try { await this.run('PRAGMA foreign_keys = ON'); } catch { /* best effort */ }
      console.warn('[SqliteAdapter] observations type migration skipped:', error.message);
    }
  }

  /**
   * Close database connection
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        this.db = null;
      } else {
        resolve();
      }
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Execute SQL query with parameters
   */
  async run(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  /**
   * Get single row from database
   */
  async get(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Query multiple rows
   */
  async all(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // ==================== Session Operations ====================

  async createSession(session) {
    const now = new Date().toISOString();
    
    // Use provided ID if available, otherwise generate new one
    const id = session.id || uuidv4();
    console.log('[SqliteAdapter] Creating session:', JSON.stringify({id, ...session}));
    
    const columns = ['id', 'workspace_id', 'project_id', 'user_id', 'agent_id', 'provider', 'model'];
    const values = [id, session.workspaceId || 'default', session.projectId || null, session.userId || null, session.agentId || null, session.provider || null, session.model || null];

    if (session.metadata) {
      columns.push('metadata');
      values.push(JSON.stringify(session.metadata));
    }

    columns.push('started_at', 'status');
    values.push(now, 'active');

    const placeholders = columns.map(() => '?').join(', ');
    const query = `
      INSERT INTO sessions (${columns.join(', ')})
      VALUES (${placeholders})
    `;
    
    console.log('[SqliteAdapter] SQL Query:', query.substring(0, 200), '...');
    console.log('[SqliteAdapter] Values:', values.slice(0, 5), '...');
    
    await this.run(query, values);
    return id;
  }

  async updateSession(sessionId, updates) {
    const fields = [];
    const values = [];
    
    if (updates.workspaceId !== undefined) {
      fields.push('workspace_id = ?');
      values.push(updates.workspaceId);
    }
    if (updates.projectId !== undefined) {
      fields.push('project_id = ?');
      values.push(updates.projectId);
    }
    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.endedAt) {
      fields.push('ended_at = ?');
      values.push(updates.endedAt);
    }
    if (updates.tokenCount !== undefined) {
      fields.push('token_count = ?');
      values.push(updates.tokenCount);
    }
    if (updates.metadata) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    
    if (fields.length === 0) return;
    
    values.push(sessionId);
    await this.run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async getSession(sessionId) {
    return await this.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  }

  async listSessions(filters = {}, limit = 50, offset = 0) {
    const conditions = [];
    const values = [];
    
    if (filters.workspaceId) {
      conditions.push('workspace_id = ?');
      values.push(filters.workspaceId);
    }
    if (filters.projectId) {
      conditions.push('project_id = ?');
      values.push(filters.projectId);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      values.push(filters.userId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    
    let query = 'SELECT * FROM sessions WHERE 1=1';
    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }
    
    query += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`;
    values.push(limit, offset);
    
    return await this.all(query, values);
  }

  // ==================== Observation Operations ====================

  async createObservation(observation) {
    const id = uuidv4();
    
    const query = `
      INSERT INTO observations 
      (id, session_id, type, timestamp, content_hash, raw_content, privacy_filtered, is_sensitive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.run(query, [
      id,
      observation.sessionId,
      observation.type,
      observation.timestamp || new Date().toISOString(),
      observation.contentHash || null,
      observation.rawContent,
      observation.privacyFiltered || false,
      observation.isSensitive || false
    ]);
    
    return id;
  }

  async getObservation(observationId) {
    return await this.get('SELECT * FROM observations WHERE id = ?', [observationId]);
  }

  async listObservations(sessionId, filters = {}) {
    const conditions = ['session_id = ?'];
    const values = [sessionId];
    
    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }
    
    const query = `SELECT * FROM observations WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC`;
    return await this.all(query, values);
  }

  async listObservationsBySession(sessionId, options = {}) {
    const { limit = 200, type } = options;
    let query = 'SELECT * FROM observations WHERE session_id = ?';
    const params = [sessionId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    query += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);

    return await this.all(query, params);
  }

  async findObservationByContentHash(contentHash) {
    if (!contentHash) return null;
    return await this.get(
      'SELECT * FROM observations WHERE content_hash = ? ORDER BY timestamp ASC LIMIT 1',
      [contentHash]
    );
  }

  // ==================== Audit ====================

  /**
   * Persist an audit event (create/update/delete/access/consolidate/decay).
   * Previously unimplemented in this adapter, which made every
   * updateMemory/deleteMemory throw when privacy.auditLogging was enabled.
   */
  async logAudit(auditEvent = {}) {
    const query = `
      INSERT INTO memory_audit_log (id, action, memory_id, user_id, changes, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await this.run(query, [
      uuidv4(),
      auditEvent.action,
      auditEvent.memoryId || null,
      auditEvent.userId || null,
      auditEvent.changes ? JSON.stringify(auditEvent.changes) : null,
      auditEvent.ipAddress || null,
      auditEvent.timestamp || new Date().toISOString()
    ]);
  }

  // ==================== Memory Operations ====================

  async saveMemory(memory) {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const expiresAt = memory.ttlDays 
      ? new Date(Date.now() + memory.ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    
    const embeddingJson = memory.embedding && Array.isArray(memory.embedding)
      ? JSON.stringify(memory.embedding)
      : null;
    
    const query = `
      INSERT INTO memories 
      (id, session_id, type, scope, workspace_id, project_id, user_id, agent_id,
       title, content, summary, embedding_json, importance_score, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.run(query, [
      id,
      memory.sessionId || null,
      memory.type,
      memory.scope,
      memory.workspaceId,
      memory.projectId,
      memory.userId,
      memory.agentId,
      memory.title,
      memory.content,
      memory.summary || null,
      embeddingJson,
      memory.importanceScore || 1.0,
      now,
      now,
      expiresAt
    ]);
    
    return id;
  }

  async getMemory(memoryId) {
    return await this.get('SELECT * FROM memories WHERE id = ?', [memoryId]);
  }

  async updateMemory(memoryId, updates) {
    const fields = [];
    const values = [];
    
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.importanceScore !== undefined) {
      fields.push('importance_score = ?');
      values.push(updates.importanceScore);
    }
    if (updates.accessCount !== undefined) {
      fields.push('access_count = ?, last_accessed = CURRENT_TIMESTAMP');
      values.push(updates.accessCount);
    }
    if (updates.expiresAt !== undefined) {
      fields.push('expires_at = ?');
      values.push(updates.expiresAt);
    }
    if (updates.isPinned !== undefined) {
      fields.push('is_pinned = ?');
      values.push(updates.isPinned ? 1 : 0);
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    
    const query = `UPDATE memories SET ${fields.join(', ')} WHERE id = ?`;
    values.push(memoryId);
    
    await this.run(query, values);
  }

  async deleteMemory(memoryId) {
    await this.run('DELETE FROM memories WHERE id = ?', [memoryId]);
  }

  async setPinned(memoryId, pinned = true) {
    await this.run(
      'UPDATE memories SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [pinned ? 1 : 0, memoryId]
    );
  }

  async getPinnedMemories(filters = {}, options = {}) {
    const conditions = ['is_pinned = 1'];
    const values = [];

    if (filters.scope) { conditions.push('scope = ?'); values.push(filters.scope); }
    if (filters.userId) { conditions.push('user_id = ?'); values.push(filters.userId); }
    if (filters.workspaceId) { conditions.push('workspace_id = ?'); values.push(filters.workspaceId); }
    conditions.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');

    let query = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY importance_score DESC, created_at DESC`;
    const { limit = 50 } = options;
    query += ' LIMIT ?';
    values.push(limit);

    return await this.all(query, values);
  }

  async listMemories(filters = {}, options = {}) {
    const conditions = [];
    const values = [];

    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }
    if (filters.scope) {
      conditions.push('scope = ?');
      values.push(filters.scope);
    }
    if (filters.workspaceId) {
      conditions.push('workspace_id = ?');
      values.push(filters.workspaceId);
    }
    if (filters.projectId) {
      conditions.push('project_id = ?');
      values.push(filters.projectId);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      values.push(filters.userId);
    }
    if (filters.agentId) {
      conditions.push('agent_id = ?');
      values.push(filters.agentId);
    }

    // Filter out expired memories
    conditions.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');

    // Pinned first, then by importance + recency
    let query = 'SELECT * FROM memories WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY is_pinned DESC, importance_score DESC, created_at DESC';

    const { limit = 50, offset = 0 } = options;
    query += ` LIMIT ? OFFSET ?`;
    values.push(limit, offset);

    return await this.all(query, values);
  }

  // ==================== Search Operations ====================

  async keywordSearch(query, filters = {}, options = {}) {
    // Simple LIKE search (upgrade to FTS5 for production)
    const searchTerm = `%${query}%`;
    const conditions = ['(title LIKE ? OR content LIKE ?)'];
    const values = [searchTerm, searchTerm];
    
    if (filters.workspaceId) {
      conditions.push('workspace_id = ?');
      values.push(filters.workspaceId);
    }
    if (filters.scope) {
      conditions.push('scope = ?');
      values.push(filters.scope);
    }
    conditions.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');
    
    const queryStr = `
      SELECT *, 
             INSTR(lower(title), lower(?)) as title_rank,
             INSTR(lower(content), lower(?)) as content_rank
      FROM memories 
      WHERE ${conditions.join(' AND ')}
      ORDER BY title_rank DESC, content_rank DESC
      LIMIT ?
    `;
    
    const finalValues = [query, query, ...values, options.limit || 20];
    const results = await this.all(queryStr, finalValues);
    
    return results.map(row => ({
      memory: row,
      score: Math.max(1 - row.title_rank / 1000, 0) + Math.max(1 - row.content_rank / 1000, 0)
    }));
  }

  async semanticSearch(query, filters = {}, options = {}) {
    // Placeholder for semantic search using JS cosine similarity
    // For now, return keyword search results
    return await this.keywordSearch(query, filters, options);
  }

  async hybridSearch(query, embedding = null, options = {}) {
    const bm25Results = await this.keywordSearch(query, options.filters || {}, options);
    
    if (!embedding || embedding.length === 0) {
      return bm25Results;
    }

    const vectorResults = await this.semanticSearch(embedding, options.filters || {}, options.limit || 20);

    // Combine using RRF
    const { reciprocalRankFusion } = require('../../embedding/RRF');
    
    const lists = [bm25Results, vectorResults];
    const weights = options.weights || [0.5, 0.5]; // keyword, vector
    
    const fused = reciprocalRankFusion(lists, {
      k: options.rrfK || 60,
      topK: options.limit || 20,
      weights
    });

    return fused;
  }

  /**
   * Semantic search: load memories that have embeddings, compute cosine similarity in JS.
   * This is practical for local use (<10k memories). For larger scale use sqlite-vss later.
   */
  async semanticSearch(embedding, filters = {}, topK = 10) {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return [];
    }

    const conditions = ['embedding_json IS NOT NULL'];
    const values = [];

    if (filters.workspaceId) {
      conditions.push('workspace_id = ?');
      values.push(filters.workspaceId);
    }
    if (filters.scope) {
      conditions.push('scope = ?');
      values.push(filters.scope);
    }
    if (filters.type) {
      conditions.push('type = ?');
      values.push(filters.type);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      values.push(filters.userId);
    }
    if (filters.projectId) {
      conditions.push('project_id = ?');
      values.push(filters.projectId);
    }

    conditions.push('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');

    const query = `
      SELECT * FROM memories 
      WHERE ${conditions.join(' AND ')}
      ORDER BY importance_score DESC, created_at DESC
      LIMIT 500
    `;

    const rows = await this.all(query, values);

    // Parse embeddings + compute similarity
    const { EmbeddingService } = require('../../embedding/EmbeddingService');
    const scored = [];

    for (const row of rows) {
      try {
        const vec = row.embedding_json ? JSON.parse(row.embedding_json) : null;
        if (!vec || !Array.isArray(vec)) continue;

        const similarity = EmbeddingService.cosineSimilarity(embedding, vec);
        scored.push({
          memory: row,
          similarity,
          score: similarity // for RRF compatibility, we use 'score' field in some paths
        });
      } catch {
        // skip bad embedding
      }
    }

    // Sort by similarity desc
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  // ==================== Phase 3: Facts & Knowledge Graph ====================

  async saveFact(fact) {
    const hash = fact.contentHash || crypto.createHash('sha256').update(fact.factText || fact.text || '').digest('hex');

    const query = `
      INSERT INTO fact_cache (content_hash, fact_text, category, confidence, source_session_id, created_at, last_verified)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(content_hash) DO UPDATE SET
        fact_text = excluded.fact_text,
        category = excluded.category,
        confidence = excluded.confidence,
        last_verified = CURRENT_TIMESTAMP
    `;

    await this.run(query, [
      hash,
      fact.factText || fact.text,
      fact.category || 'general',
      fact.confidence || 0.8,
      fact.sourceSessionId || null
    ]);

    return hash;
  }

  async listFacts(filters = {}, options = {}) {
    const conditions = [];
    const values = [];

    if (filters.category) {
      conditions.push('category = ?');
      values.push(filters.category);
    }
    if (filters.sessionId) {
      conditions.push('source_session_id = ?');
      values.push(filters.sessionId);
    }

    let query = 'SELECT * FROM fact_cache';
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY last_verified DESC, confidence DESC';

    const { limit = 100 } = options;
    query += ' LIMIT ?';
    values.push(limit);

    return await this.all(query, values);
  }

  async saveKnowledgeNode(node) {
    const id = node.id || uuidv4();

    const query = `
      INSERT INTO knowledge_graph (id, source_memory_id, node_type, label, properties, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        properties = excluded.properties
    `;

    const props = node.properties ? JSON.stringify(node.properties) : null;
    const emb = node.embedding ? JSON.stringify(node.embedding) : null;

    await this.run(query, [
      id,
      node.sourceMemoryId || null,
      node.nodeType || 'concept',
      node.label,
      props,
      emb
    ]);

    return id;
  }

  async listKnowledgeNodes(filters = {}, options = {}) {
    const conditions = [];
    const values = [];

    if (filters.nodeType) {
      conditions.push('node_type = ?');
      values.push(filters.nodeType);
    }
    if (filters.sourceMemoryId) {
      conditions.push('source_memory_id = ?');
      values.push(filters.sourceMemoryId);
    }

    let query = 'SELECT * FROM knowledge_graph';
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY id';

    const { limit = 200 } = options;
    query += ' LIMIT ?';
    values.push(limit);

    const rows = await this.all(query, values);
    return rows.map(r => ({
      ...r,
      properties: r.properties ? JSON.parse(r.properties) : null
    }));
  }

  // ==================== Statistics ====================

  async getStats(filters = {}) {
    const stats = {};
    
    // Session counts
    if (!filters.workspaceId && !filters.projectId && !filters.userId) {
      const totalSessions = await this.get('SELECT COUNT(*) as count FROM sessions');
      stats.totalSessions = totalSessions.count;
    }
    
    // Memory counts by type
    const memoriesByType = await this.all(`
      SELECT type, COUNT(*) as count 
      FROM memories 
      WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      GROUP BY type
    `);
    stats.memoriesByType = {};
    memoriesByType.forEach(row => {
      stats.memoriesByType[row.type] = row.count;
    });
    
    // Total memories
    stats.totalMemories = Object.values(stats.memoriesByType).reduce((a, b) => a + b, 0);
    
    // Pinned count (Memory Slots)
    const pinnedCount = await this.get('SELECT COUNT(*) as count FROM memories WHERE is_pinned = 1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)');
    stats.pinnedMemories = pinnedCount.count;
    
    // Facts count
    const factsCount = await this.get('SELECT COUNT(*) as count FROM fact_cache');
    stats.totalFacts = factsCount.count;
    
    // Observations count
    if (!filters.workspaceId && !filters.projectId && !filters.userId) {
      const totalObservations = await this.get('SELECT COUNT(*) as count FROM observations');
      stats.totalObservations = totalObservations.count;
    }
    
    return stats;
  }
}

module.exports = SqliteAdapter;
