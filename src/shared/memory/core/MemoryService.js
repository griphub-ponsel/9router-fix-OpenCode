/**
 * Core Memory Service
 * Main orchestrator for memory operations
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const SqliteAdapter = require('../storage/adapters/SqliteAdapter');
const { globalConfig } = require('./MemoryConfig');
const { SCOPE, MEMORY_TYPE } = require('../models/Scopes');
const { EmbeddingService, getDefaultEmbeddingService } = require('../embedding/EmbeddingService');

class MemoryService {
  constructor() {
    this.adapter = null;
    this.config = new Map();
    this.initialized = false;
    this.eventListeners = new Map();
    this.embeddingService = null;
  }

  /**
   * Initialize memory service with configuration
   */
  async initialize(config = {}) {
    if (this.initialized) {
      console.log('[MemoryService] Already initialized');
      return this;
    }

    console.log('[MemoryService] Initializing...');
    
    // Load configuration
    this.config.set('global', globalConfig.clone());
    if (Object.keys(config).length > 0) {
      this.config.get('global').load(config);
    }

    // Validate config
    const validation = this.config.get('global').validate();
    if (!validation.valid) {
      throw new Error(`Invalid memory configuration: ${validation.errors.join(', ')}`);
    }

    // Initialize storage adapter
    // Prefer MEMORY_DB_PATH / MEMORY_STORAGE_DB_PATH, then config, then
    // canonical repo-root path (resolveMemoryDbPath ignores process.cwd()).
    const configuredPath =
      process.env.MEMORY_DB_PATH ||
      process.env.MEMORY_STORAGE_DB_PATH ||
      this.config.get('global').get('storage.dbPath') ||
      './data/9router-memory.sqlite';
    const storageConfig = {
      dbPath: configuredPath
    };
    
    this.adapter = new SqliteAdapter(storageConfig);
    await this.adapter.initialize(storageConfig);
    console.log('[MemoryService] Using memory DB:', this.adapter.dbPath);

    // Initialize embedding service (Phase 2)
    const embCfg = this.config.get('global').get('embedding') || {};
    if (embCfg.enabled !== false) {
      const provider = embCfg.provider || 'local';
      const model = embCfg.model || null;
      const dimension = embCfg.dimension || 384;
      const baseUrl = embCfg.baseUrl || process.env.MEMORY_EMBEDDING_BASE_URL || null;

      this.embeddingService = new EmbeddingService({
        provider,
        model,
        dimension,
        baseUrl
      });

      // Kick off lazy init (non-blocking for service start)
      this.embeddingService.initialize().catch(err => {
        console.warn('[MemoryService] Embedding provider init warning:', err.message);
      });

      console.log('[MemoryService] Embedding service configured:', provider);
    }

    console.log('[MemoryService] Initialized successfully');
    this.initialized = true;

    return this;
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
    }
    this.initialized = false;
    console.log('[MemoryService] Shutdown complete');
  }

  /**
   * Set current scope context
   */
  setScope(scope) {
    this.currentScope = scope;
  }

  getScope() {
    return this.currentScope || { type: 'workspace' };
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx > -1) {
        listeners.splice(idx, 1);
      }
    }
  }

  /**
   * Emit event
   */
  async emit(event, data) {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try {
        await listener(data);
      } catch (error) {
        console.error(`[MemoryService] Event listener error (${event}):`, error);
      }
    }
  }

  // ==================== High-Level Operations ====================

  /**
   * Save observation from tool use or prompt
   * @param {Object} observation - Observation data
   */
  async saveObservation(observation) {
    if (!this.config.get('global').isEnabled('ingestion.enabled')) {
      return null;
    }

    try {
      // Apply privacy filter
      const filtered = await this.applyPrivacyFilter(observation);
      
      // Check for duplicate
      const existing = await this.findDuplicate(filtered.contentHash);
      if (existing) {
        console.log('[MemoryService] Skipping duplicate observation');
        return existing.id;
      }

      const sessionId = observation.sessionId || uuidv4();
      await this.ensureSession(sessionId, observation);

      // Store observation
      const id = await this.adapter.createObservation({
        sessionId,
        type: observation.type,
        rawContent: filtered.content,
        contentHash: filtered.contentHash,
        timestamp: observation.timestamp,
        privacyFiltered: filtered.filtered,
        isSensitive: filtered.isSensitive
      });

      await this.emit('observation_saved', { id, observation });
      return id;

    } catch (error) {
      console.error('[MemoryService] Failed to save observation:', error);
      throw error;
    }
  }

  /**
   * Search memories
   * Supports keyword, hybrid, and semantic search.
   * 
   * @param {string} query - Search query (text)
   * @param {Object} options - Query options
   * @param {boolean} [options.hybrid] - Force hybrid (keyword + vector)
   * @param {boolean} [options.semantic] - Force semantic-only
   * @param {number[]} [options.embedding] - Pre-computed embedding for the query
   */
  async searchMemories(query, options = {}) {
    const filters = {
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      userId: options.userId,
      agentId: options.agentId,
      scope: options.scope,
      type: options.type
    };

    const embCfg = this.config.get('global').get('embedding') || {};
    const useHybrid = options.hybrid !== false && (options.hybrid === true || embCfg.useHybridSearch);
    const useSemanticOnly = options.semantic === true;

    let embedding = options.embedding || null;

    // Auto-generate embedding for query if needed
    if ((useHybrid || useSemanticOnly) && !embedding && this.embeddingService && query) {
      try {
        embedding = await this.embeddingService.embed(query);
      } catch (e) {
        console.warn('[MemoryService] Failed to embed search query:', e.message);
        embedding = null;
      }
    }

    let results;

    if (useSemanticOnly && embedding) {
      // Pure semantic search
      results = await this.adapter.semanticSearch(embedding, filters, options.maxResults || 20);
    } else if (useHybrid && embedding) {
      // Hybrid
      results = await this.adapter.hybridSearch(query, embedding, {
        filters,
        limit: options.maxResults || this.config.get('global').get('retrieval.maxResults'),
        rrfK: embCfg.rrfK || 60,
        weights: [embCfg.bm25Weight || 0.4, embCfg.vectorWeight || 0.6]
      });
    } else {
      // Pure keyword (BM25)
      results = await this.adapter.keywordSearch(query, filters, {
        limit: options.maxResults || this.config.get('global').get('retrieval.maxResults')
      });
    }

    // Apply token budget if specified
    if (options.tokenBudget) {
      const selected = this.selectByTokenBudget(results, options.tokenBudget);
      return selected.map(r => r.memory);
    }

    return results.map(r => r.memory);
  }

  /**
   * Semantic search by text or precomputed embedding
   */
  async semanticSearchMemories(queryOrEmbedding, options = {}) {
    let embedding = queryOrEmbedding;

    if (typeof queryOrEmbedding === 'string') {
      if (this.embeddingService) {
        embedding = await this.embeddingService.embed(queryOrEmbedding);
      } else {
        embedding = null;
      }
    }

    if (!embedding || !Array.isArray(embedding)) {
      return [];
    }

    const filters = {
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      userId: options.userId,
      scope: options.scope,
      type: options.type
    };

    const results = await this.adapter.semanticSearch(
      embedding,
      filters,
      options.maxResults || 20
    );

    return results.map(r => r.memory);
  }

  /**
   * Smart search with context-aware retrieval
   * @param {string} query - Search query
   * @param {Object} context - Request context
   */
  async smartSearch(query, context = {}) {
    // Build enriched query based on context
    const enrichedQuery = this.enrichQueryWithContext(query, context);
    
    // Determine best filters from context
    const filters = {
      workspaceId: context.workspace?.id,
      projectId: context.project?.id,
      userId: context.user?.id,
      agentId: context.agent?.id,
      scope: context.scope || SCOPE.WORKSPACE
    };

    // Retrieve memories
    const memories = await this.searchMemories(enrichedQuery, {
      maxResults: 20,
      workspaceId: filters.workspaceId,
      projectId: filters.projectId,
      userId: filters.userId,
      agentId: filters.agentId,
      scope: filters.scope,
      tokenBudget: context.tokenBudget
    });

    // Emit retrieval event
    await this.emit('memories_retrieved', { query, memories, context });

    return memories;
  }

  /**
   * Save memory (structured knowledge)
   * Auto-generates embedding if embedding is enabled and autoEmbedOnSave is true.
   */
  async saveMemory(memory) {
    const input = {
      id: uuidv4(),
      sessionId: memory.sessionId,
      type: memory.type,
      scope: memory.scope,
      workspaceId: memory.workspaceId,
      projectId: memory.projectId,
      userId: memory.userId,
      agentId: memory.agentId,
      title: memory.title,
      content: memory.content,
      summary: memory.summary,
      importanceScore: memory.importanceScore || 1.0,
      ttlDays: memory.ttlDays || null
    };

    // Phase 2: Auto-embed if enabled
    const embCfg = this.config.get('global').get('embedding') || {};
    if (embCfg.enabled !== false && embCfg.autoEmbedOnSave !== false && this.embeddingService) {
      try {
        const textToEmbed = [memory.title, memory.content].filter(Boolean).join('\n').slice(0, 6000);
        if (textToEmbed) {
          const embedding = await this.embeddingService.embed(textToEmbed);
          if (embedding && Array.isArray(embedding)) {
            input.embedding = embedding;
          }
        }
      } catch (e) {
        console.warn('[MemoryService] Embedding generation failed for memory, continuing without vector:', e.message);
      }
    }

    const id = await this.adapter.saveMemory(input);
    
    await this.emit('memory_saved', { id, memory: input });
    return id;
  }

  /**
   * Generate embedding for arbitrary text (public helper)
   */
  async generateEmbedding(text) {
    if (!this.embeddingService) {
      await this.initialize(); // ensure
    }
    if (!this.embeddingService) return null;
    return await this.embeddingService.embed(text);
  }

  /**
   * Get single memory by ID
   */
  async getMemory(memoryId) {
    const memory = await this.adapter.getMemory(memoryId);
    
    if (memory) {
      // Increment access count
      await this.adapter.updateMemory(memoryId, {
        accessCount: (memory.access_count || 0) + 1
      });

      await this.emit('memory_accessed', { memoryId, memory });
    }

    return memory;
  }

  /**
   * Delete memory
   */
  async deleteMemory(memoryId, userId) {
    // Check ownership before deleting
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error('Memory not found');
    }

    // Verify user has permission to delete
    const canDelete = await this.canDeleteMemory(memory, userId);
    if (!canDelete) {
      throw new Error('Permission denied');
    }

    await this.adapter.deleteMemory(memoryId);
    
    await this.emit('memory_deleted', { memoryId, userId });
    
    // Log audit
    if (this.config.get('global').isEnabled('privacy.auditLogging')) {
      await this.adapter.logAudit({
        action: 'delete',
        memoryId,
        userId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Update memory
   */
  async updateMemory(memoryId, updates, userId) {
    const existing = await this.getMemory(memoryId);
    if (!existing) {
      throw new Error('Memory not found');
    }

    // Verify permissions
    const canUpdate = await this.canUpdateMemory(existing, userId);
    if (!canUpdate) {
      throw new Error('Permission denied');
    }

    await this.adapter.updateMemory(memoryId, updates);

    await this.emit('memory_updated', { memoryId, updates, userId });

    // Log audit
    if (this.config.get('global').isEnabled('privacy.auditLogging')) {
      await this.adapter.logAudit({
        action: 'update',
        memoryId,
        userId,
        changes: updates,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Consolidate memories (Phase 3)
   * - Merge near-duplicates using vector similarity
   * - Create episodic summaries for recent sessions (optional)
   * - Decay old memories
   */
  async consolidate(options = {}) {
    if (!this.config.get('global').isEnabled('consolidation.enabled')) {
      return { skipped: true };
    }

    console.log('[MemoryService] Starting Phase 3 consolidation...');

    const mergedCount = await this.mergeDuplicateMemories(
      this.config.get('global').get('consolidation.mergeThreshold')
    );

    const decayedCount = await this.runDecaySweep();

    let episodicCount = 0;
    if (options.createEpisodicSummaries !== false) {
      try {
        // Get recent completed sessions that don't have an episodic summary yet
        const sessions = await this.adapter.listSessions({ status: 'completed' }, 20);
        for (const session of sessions) {
          // Check if we already have an episodic memory for this session
          const existing = await this.adapter.listMemories({ sessionId: session.id, type: MEMORY_TYPE.EPISODIC }, { limit: 1 });
          if (existing.length === 0) {
            const memId = await this.createEpisodicSummary(session.id, {
              scope: SCOPE.SESSION,
              userId: session.user_id,
              workspaceId: session.workspace_id,
              projectId: session.project_id
            });
            if (memId) episodicCount++;
          }
        }
      } catch (e) {
        console.warn('[MemoryService] Episodic summarization during consolidate failed:', e.message);
      }
    }

    if (this.config.get('global').get('consolidation.snapshotEnabled')) {
      // Snapshot logic would go here
    }

    console.log(`[MemoryService] Consolidation complete: merged=${mergedCount}, decayed=${decayedCount}, episodic=${episodicCount}`);

    return { merged: mergedCount, decayed: decayedCount, episodic: episodicCount };
  }

  /**
   * Run decay sweep to expire old memories
   */
  async runDecaySweep() {
    const now = new Date();
    const decayRate = this.config.get('global').get('consolidation.decayRate');
    
    // Find memories below threshold
    const oldMemories = await this.adapter.listMemories({
      scope: SCOPE.USER
    }, { limit: 100 });

    let decayedCount = 0;
    for (const memory of oldMemories) {
      const newImportance = memory.importance_score * decayRate;
      
      if (newImportance < 0.1) {
        // Expire memory
        const expiresAt = new Date(now.getTime() - 1).toISOString();
        await this.adapter.updateMemory(memory.id, { expiresAt });
        decayedCount++;
      } else {
        // Update importance
        await this.adapter.updateMemory(memory.id, { 
          importanceScore: newImportance 
        });
      }
    }

    return decayedCount;
  }

  /**
   * Get statistics + embedding status
   */
  async getStats() {
    const base = await this.adapter.getStats();

    // Add embedding provider info (Phase 2)
    const embCfg = this.config.get('global')?.get?.('embedding') || {};
    base.embedding = {
      enabled: embCfg.enabled !== false,
      provider: this.embeddingService ? this.embeddingService.getProvider() : 'none',
      dimension: this.embeddingService ? this.embeddingService.getDimension() : null,
      hasService: !!this.embeddingService
    };

    return base;
  }

  // ==================== Phase 3: Memory Slots (Pinned) ====================

  /**
   * Pin a memory (Memory Slot)
   */
  async pinMemory(memoryId, userId = null) {
    if (!this.initialized) {
      await this.initialize();
    }
    const existing = await this.getMemory(memoryId);
    if (!existing) {
      throw new Error('Memory not found');
    }
    await this.adapter.setPinned(memoryId, true);
    await this.emit('memory_pinned', { memoryId, userId });
    return true;
  }

  /**
   * Unpin a memory
   */
  async unpinMemory(memoryId, userId = null) {
    if (!this.initialized) {
      await this.initialize();
    }
    await this.adapter.setPinned(memoryId, false);
    await this.emit('memory_unpinned', { memoryId, userId });
    return true;
  }

  /**
   * Get all pinned memories (Memory Slots)
   */
  async getPinnedMemories(filters = {}, limit = 50) {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.adapter.getPinnedMemories(filters, { limit });
  }

  // ==================== Phase 3: Advanced Features (Summarize, Facts, Episodic) ====================

  /**
   * Summarize arbitrary text using the local 9Router LLM (self-call).
   * Falls back to simple extractive summary if the LLM call fails.
   */
  async summarizeWithRouter(text, options = {}) {
    if (!text || typeof text !== 'string') return null;

    const maxLength = options.maxLength || 600;
    const style = options.style || 'concise';

    // Try to summarize via the running 9Router instance
    try {
      const baseUrl = process.env.ROUTER_BASE_URL || 'http://localhost:20128';
      // Model priority: explicit option > MEMORY_EXTRACT_MODEL env > "auto" alias
      const model = options.model || process.env.MEMORY_EXTRACT_MODEL || 'auto';
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Internal self-call marker: prevents the memory capture/injection
          // pipeline from recursively processing this request.
          'x-9router-memory-internal': '1'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: `You create ${style} summaries. Keep key facts, decisions, preferences and actions. Max ~${maxLength} characters. Output ONLY the summary.`
            },
            {
              role: 'user',
              content: text.slice(0, 14000)
            }
          ],
          max_tokens: Math.min(900, Math.ceil(maxLength * 1.4)),
          temperature: 0.2
        })
      });

      if (res.ok) {
        const data = await res.json();
        const summary = data.choices?.[0]?.message?.content?.trim();
        if (summary && summary.length > 8) {
          return summary.slice(0, maxLength);
        }
      }
    } catch (e) {
      console.warn('[MemoryService] LLM summarize failed, falling back to extractive:', e.message);
    }

    // Fallback extractive summary
    const sentences = text.split(/[.!?]\s+/).filter(s => s.trim().length > 12);
    let out = '';
    for (const s of sentences) {
      if ((out + ' ' + s).length > maxLength) break;
      out += (out ? ' ' : '') + s.trim();
    }
    return out || text.slice(0, maxLength);
  }

  /**
   * Extract facts from an array of observations.
   * Each observation should have raw_content (or content).
   */
  async extractFactsFromObservations(observations = [], options = {}) {
    const texts = (observations || [])
      .map(o => (o.raw_content || o.content || '').trim())
      .filter(Boolean);

    if (!texts.length) return [];

    const combined = texts.join('\n');
    const facts = [];
    const lines = combined.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 15);

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        /(prefer|always|never|must|should|requires?|uses?|implemented|set up|added|using|via|with|token|jwt|rate.?limit|auth)/i.test(line) &&
        line.length < 320
      ) {
        facts.push({
          value: line,
          type: 'extracted',
          confidence: 0.65
        });
      }
    }

    // Fallback: take a few longer sentences
    if (facts.length < 3) {
      const sentences = combined.split(/[.!?]\s+/);
      for (const s of sentences) {
        if (s.length > 20 && s.length < 280 && facts.length < 6) {
          facts.push({ value: s.trim(), type: 'fact', confidence: 0.5 });
        }
      }
    }

    return facts.slice(0, 10);
  }

  /**
   * Create (or return null) an episodic memory for a session.
   * Aggregates recent observations and saves a summary memory.
   */
  async createEpisodicSummary(sessionId, context = {}) {
    if (!sessionId) return null;

    try {
      const obs = await this.adapter.listObservationsBySession(sessionId, { limit: 120 });
      if (!obs || !obs.length) return null;

      const blob = this.formatEpisodicTranscript(obs, { maxLength: 15000 });

      if (!blob || blob.length < 20) return null;

      const summary = await this.summarizeWithRouter(blob, {
        maxLength: context.maxLength || 850,
        style: 'episodic',
        model: context.model,
      });

      if (!summary) return null;

      const title = context.title || this.createEpisodicTitle(summary);

      const memId = await this.saveMemory({
        type: MEMORY_TYPE.EPISODIC,
        scope: context.scope || SCOPE.SESSION,
        sessionId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        userId: context.userId,
        title,
        content: summary,
        importanceScore: context.importanceScore || 0.75
      });

      return memId;
    } catch (e) {
      console.warn('[MemoryService] createEpisodicSummary failed:', e.message);
      return null;
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Enrich search query with context
   */
  enrichQueryWithContext(query, context) {
    let enriched = query;

    // Add project context if available
    if (context.project?.name) {
      enriched += ` project:${context.project.name}`;
    }

    // Add tech stack context
    if (context.project?.techStack) {
      enriched += ` ${context.project.techStack.join(' ')}`;
    }

    // Add recent task context
    if (context.recentTasks && context.recentTasks.length > 0) {
      enriched += ` tasks:(${context.recentTasks.join(' OR ')})`;
    }

    return enriched;
  }

  /**
   * Apply privacy filter to observation
   */
  async applyPrivacyFilter(observation) {
    if (!this.config.get('global').isEnabled('ingestion.privacyFilterEnabled')) {
      return { content: observation.rawContent, filtered: false, isSensitive: false };
    }

    const privacyPatterns = this.getPrivacyPatterns();
    let content = observation.rawContent;
    let isSensitive = false;
    let filtered = false;

    for (const pattern of privacyPatterns) {
      if (pattern.test(content)) {
        isSensitive = true;
        filtered = true;
        break;
      }
    }

    if (isSensitive && !this.config.get('global').get('privacy.allowSensitiveData')) {
      content = '[SENSITIVE CONTENT REMOVED]';
    }

    const contentHash = observation.contentHash || this.hashContent(content);
    return { content, contentHash, filtered, isSensitive };
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex');
  }

  async ensureSession(sessionId, observation = {}) {
    const existing = await this.adapter.getSession(sessionId);
    if (existing) return existing.id;

    await this.adapter.createSession({
      id: sessionId,
      workspaceId: observation.workspaceId || this.currentScope?.workspaceId || 'default',
      projectId: observation.projectId || this.currentScope?.projectId || null,
      userId: observation.userId || this.currentScope?.userId || null,
      agentId: observation.agentId || this.currentScope?.agentId || null,
      provider: observation.provider || null,
      model: observation.model || null,
      metadata: observation.sessionMetadata || null
    });

    return sessionId;
  }

  /**
   * Get privacy patterns
   */
  getPrivacyPatterns() {
    const patterns = [
      new RegExp('api[_-]?key\\s*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-]{20,})[\'"]?', 'gi'),
      new RegExp('password\\s*[=:]\\s*[\'"]?([^\\s\'"]{4,})[\'"]?', 'gi'),
      new RegExp('(?:bearer|token)\\s+[a-zA-Z0-9_\\-\\.]+', 'gi'),
      /\b\d{3}-\d{2}-\d{4}\b/
    ];
    return patterns;
  }

  /**
   * Find duplicate observations
   */
  async findDuplicate(contentHash) {
    if (!contentHash) return null;

    if (typeof this.adapter.findObservationByContentHash === 'function') {
      return await this.adapter.findObservationByContentHash(contentHash);
    }

    return null;
  }

  /**
   * Select memories within token budget
   */
  selectByTokenBudget(results, tokenBudget) {
    const selected = [];
    let totalTokens = 0;

    for (const item of results) {
      const tokens = this.estimateTokens(item.memory.content);
      
      if (totalTokens + tokens <= tokenBudget) {
        selected.push(item);
        totalTokens += tokens;
      } else {
        break;
      }
    }

    return selected;
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text) {
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  /**
   * Sanitize text for episodic memory recaps by removing injected metadata.
   */
  sanitizeEpisodicText(text) {
    const metadataTags = [
      'environment_info', 'workspace_info', 'attachments', 'context',
      'reminderInstructions', 'userMemory', 'sessionMemory', 'repoMemory'
    ].join('|');
    const metadataBlocks = new RegExp(`<(${metadataTags})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1>|$)`, 'gi');
    const remainingTags = new RegExp(`<\\/?(?:userRequest|${metadataTags})>`, 'gi');

    return String(text || '')
      .replace(metadataBlocks, ' ')
      .replace(remainingTags, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Build a readable, chronological transcript for episodic summarization.
   */
  formatEpisodicTranscript(observations = [], options = {}) {
    const { maxLength = 15000 } = options;
    const labels = {
      prompt: 'User',
      user: 'User',
      assistant: 'Assistant',
      assistant_response: 'Assistant'
    };

    const transcript = (observations || [])
      .map((observation) => {
        const content = this.sanitizeEpisodicText(
          observation?.raw_content || observation?.rawContent || observation?.content || ''
        );
        if (!content) return null;

        const label = labels[observation?.type] || 'Observation';
        return `${label}: ${content}`;
      })
      .filter(Boolean)
      .join('\n\n');

    return transcript.slice(0, Math.max(0, maxLength)).trim();
  }

  /**
   * Derive a short recap title from summary content without exposing IDs.
   */
  createEpisodicTitle(summary, options = {}) {
    const { maxLength = 72 } = options;
    const cleanSummary = this.sanitizeEpisodicText(summary)
      .replace(/^(?:summary|conversation recap)\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const firstSentence = cleanSummary.split(/[.!?](?:\s|$)/, 1)[0] || 'Conversation';
    const availableLength = Math.max(1, maxLength - 'Conversation recap: '.length);
    const subject = firstSentence.length > availableLength
      ? `${firstSentence.slice(0, availableLength - 1).trimEnd()}…`
      : firstSentence;

    return `Conversation recap: ${subject}`;
  }

  /**
   * Check if user can delete memory
   */
  async canDeleteMemory(memory, userId) {
    if (!userId) return false;
    
    // Owner can always delete
    if (memory.user_id === userId) return true;

    // Memories without a specific owner are managed by the local dashboard/API caller.
    if (!memory.user_id) return true;
    
    // Workspace admins might have broader permissions
    // TODO: Implement role-based access control
    return false;
  }

  /**
   * Check if user can update memory
   */
  async canUpdateMemory(memory, userId) {
    return this.canDeleteMemory(memory, userId);
  }

  /**
   * Merge duplicate memories using vector similarity (Phase 3 - leverages Phase 2 embeddings)
   */
  async mergeDuplicateMemories(similarityThreshold = 0.85) {
    const memories = await this.adapter.listMemories({}, { limit: 500 });

    if (!this.embeddingService) {
      console.log('[MemoryService] No embedding service - skipping vector merge');
      return 0;
    }

    const groups = [];
    const visited = new Set();

    for (let i = 0; i < memories.length; i++) {
      if (visited.has(memories[i].id)) continue;
      const group = [memories[i]];
      visited.add(memories[i].id);

      // Get embedding for this memory (or generate on fly)
      let embA = memories[i].embedding_json ? JSON.parse(memories[i].embedding_json) : null;
      if (!embA) {
        embA = await this.generateEmbedding(`${memories[i].title}\n${memories[i].content}`);
      }

      for (let j = i + 1; j < memories.length; j++) {
        if (visited.has(memories[j].id)) continue;
        let embB = memories[j].embedding_json ? JSON.parse(memories[j].embedding_json) : null;
        if (!embB) {
          embB = await this.generateEmbedding(`${memories[j].title}\n${memories[j].content}`);
        }

        const sim = EmbeddingService.cosineSimilarity(embA, embB);
        if (sim >= similarityThreshold) {
          group.push(memories[j]);
          visited.add(memories[j].id);
        }
      }

      if (group.length > 1) groups.push(group);
    }

    let merged = 0;
    for (const group of groups) {
      // Keep the highest importance one, merge content into it
      group.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
      const keeper = group[0];
      const others = group.slice(1);

      const mergedContent = [
        keeper.content,
        ...others.map(o => o.content)
      ].filter(Boolean).join('\n---\n');

      await this.adapter.updateMemory(keeper.id, {
        content: mergedContent.slice(0, 12000),
        importanceScore: Math.max(keeper.importance_score || 1, 0.95)
      });

      for (const other of others) {
        await this.adapter.deleteMemory(other.id);
        merged++;
      }
    }

    console.log(`[MemoryService] Merged ${merged} duplicate memories`);
    return merged;
  }

  // ==================== Utility Methods ====================

  /**
   * Get all configs
   */
  getConfig() {
    return this.config.get('global').getAll();
  }

  /**
   * Update config dynamically
   */
  updateConfig(newConfig) {
    this.config.get('global').load(newConfig);
  }
}

// Singleton instance
const memoryService = new MemoryService();

module.exports = {
  MemoryService,
  memoryService
};
