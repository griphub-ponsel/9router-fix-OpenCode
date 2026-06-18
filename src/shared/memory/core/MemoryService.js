/**
 * Core Memory Service
 * Main orchestrator for memory operations
 */

const { v4: uuidv4 } = require('uuid');
const SqliteAdapter = require('../storage/adapters/SqliteAdapter');
const { globalConfig } = require('./MemoryConfig');
const { SCOPE, MEMORY_TYPE } = require('../models/Scopes');

class MemoryService {
  constructor() {
    this.adapter = null;
    this.config = new Map();
    this.initialized = false;
    this.eventListeners = new Map();
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
    const storageConfig = {
      dbPath: this.config.get('global').get('storage.dbPath') || './data/9router-memory.sqlite'
    };
    
    this.adapter = new SqliteAdapter(storageConfig);
    await this.adapter.initialize(storageConfig);

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

      // Store observation
      const id = await this.adapter.createObservation({
        sessionId: observation.sessionId,
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
   * @param {string} query - Search query
   * @param {Object} options - Query options
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

    const results = await this.adapter.hybridSearch(query, null, {
      filters,
      limit: options.maxResults || this.config.get('global').get('retrieval.maxResults'),
      scoreThreshold: this.config.get('global').get('retrieval.minRelevanceScore')
    });

    // Apply token budget if specified
    if (options.tokenBudget) {
      const selected = this.selectByTokenBudget(results, options.tokenBudget);
      return selected.map(r => r.memory);
    }

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
   * @param {Object} memory - Memory data
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

    const id = await this.adapter.saveMemory(input);
    
    await this.emit('memory_saved', { id, memory: input });
    return id;
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
   * Consolidate memories (merge duplicates, summarize, decay)
   */
  async consolidate(options = {}) {
    if (!this.config.get('global').isEnabled('consolidation.enabled')) {
      return { skipped: true };
    }

    console.log('[MemoryService] Starting consolidation...');

    const mergedCount = await this.mergeDuplicateMemories(
      this.config.get('global').get('consolidation.mergeThreshold')
    );

    const decayedCount = await this.runDecaySweep();

    if (this.config.get('global').get('consolidation.snapshotEnabled')) {
      // Snapshot logic would go here
    }

    console.log(`[MemoryService] Consolidation complete: merged=${mergedCount}, decayed=${decayedCount}`);

    return { merged: mergedCount, decayed: decayedCount };
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
   * Get statistics
   */
  async getStats() {
    return await this.adapter.getStats();
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

    return { content, filtered, isSensitive };
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
    
    const observations = await this.adapter.listObservations('*', { type: '*' });
    const matching = observations.find(obs => obs.content_hash === contentHash);
    return matching || null;
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
   * Check if user can delete memory
   */
  async canDeleteMemory(memory, userId) {
    if (!userId) return false;
    
    // Owner can always delete
    if (memory.user_id === userId) return true;
    
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
   * Merge duplicate memories
   */
  async mergeDuplicateMemories(similarityThreshold) {
    // Placeholder for actual merge logic
    // Would use semantic similarity comparison
    return 0;
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
