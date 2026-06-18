/**
 * SQLite Storage Adapter
 * Default persistence layer for memory system
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { CREATE_TABLES_SQL, SCHEMA_VERSION } = require('../migrations/v1_schema');
const StorageInterface = require('./BaseAdapter');

class SqliteAdapter extends StorageInterface {
  constructor(config = {}) {
    super();
    // Initialize dbPath immediately as absolute path
    const rootDir = process.cwd();
    this.dbPath = config.dbPath || `data/9router-memory.sqlite`;
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

    // Ensure dbPath is absolute using full path module
    const path = require('path');
    const fs = require('fs');
    
    const rootDir = process.cwd();
    this.dbPath = config.dbPath || path.join(rootDir, 'data', '9router-memory.sqlite');
    
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

    return this;
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
        else resolve(row);
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
    const values = [id, session.workspaceId, session.projectId, session.userId, session.agentId, session.provider, session.model];
    
    let placeholders = '?, ?, ?, ?, ?, ?, ?';
    let extraColumns = '';
    let extraValues = [];
    
    if (session.metadata) {
      extraColumns = ', metadata';
      extraValues.push(JSON.stringify(session.metadata));
      placeholders += ', ?';
      values.push(session.metadata);
    }
    
    const query = `
      INSERT INTO sessions (id${extraColumns}, workspace_id, project_id, user_id, agent_id, provider, model, started_at, status)
      VALUES (${placeholders}, ?, 'active')
    `;
    
    console.log('[SqliteAdapter] SQL Query:', query.substring(0, 200), '...');
    console.log('[SqliteAdapter] Values:', values.slice(0, 5), '...');
    
    await this.run(query, [...values, now]);
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

  // ==================== Memory Operations ====================

  async saveMemory(memory) {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const expiresAt = memory.ttlDays 
      ? new Date(Date.now() + memory.ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    
    const query = `
      INSERT INTO memories 
      (id, session_id, type, scope, workspace_id, project_id, user_id, agent_id,
       title, content, summary, importance_score, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    
    const query = `UPDATE memories SET ${fields.join(', ')} WHERE id = ?`;
    values.push(memoryId);
    
    await this.run(query, values);
  }

  async deleteMemory(memoryId) {
    await this.run('DELETE FROM memories WHERE id = ?', [memoryId]);
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
    
    let query = 'SELECT * FROM memories WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY importance_score DESC, created_at DESC';
    
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
    
    // Need to pass searchTerm twice more for the INSTR clauses
    const searchValuesForInstruments = [searchTerm, searchTerm];
    const finalValues = [...values, ...searchValuesForInstruments, options.limit || 20];
    const results = await this.all(queryStr, finalValues);
    
    return results.map(row => ({
      memory: row,
      score: Math.max(1 - row.title_rank / 1000, 0) + Math.max(1 - row.content_rank / 1000, 0)
    }));
  }

  async hybridSearch(query, embedding = null, options = {}) {
    const bm25Results = await this.keywordSearch(query, options.filters || {}, options);
    
    if (embedding && embedding.length > 0) {
      // Placeholder for vector search - implement when vector index available
      // For now, return BM25 results only
      return bm25Results;
    }
    
    return bm25Results;
  }

  // ==================== Settings & Audit ====================

  async getSetting(key) {
    return await this.get('SELECT * FROM memory_settings WHERE setting_key = ?', [key]);
  }

  async setSetting(setting) {
    const query = `
      INSERT INTO memory_settings (setting_key, scope, value, workspace_id, user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET
        value = excluded.value,
        scope = excluded.scope,
        workspace_id = excluded.workspace_id,
        user_id = excluded.user_id,
        updated_at = CURRENT_TIMESTAMP
    `;
    
    await this.run(query, [
      setting.key,
      setting.scope,
      JSON.stringify(setting.value),
      setting.workspaceId || null,
      setting.userId || null
    ]);
  }

  async logAudit(auditEvent) {
    const id = uuidv4();
    await this.run(`
      INSERT INTO memory_audit_log 
      (id, action, memory_id, user_id, changes, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      auditEvent.action,
      auditEvent.memoryId || null,
      auditEvent.userId || null,
      JSON.stringify(auditEvent.changes) || null,
      auditEvent.ipAddress || null,
      auditEvent.timestamp || new Date().toISOString()
    ]);
    
    return id;
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
    
    // Observations count
    if (!filters.workspaceId && !filters.projectId && !filters.userId) {
      const totalObservations = await this.get('SELECT COUNT(*) as count FROM observations');
      stats.totalObservations = totalObservations.count;
    }
    
    return stats;
  }
}

module.exports = SqliteAdapter;
