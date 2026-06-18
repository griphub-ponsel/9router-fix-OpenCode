/**
 * Memory Configuration Manager
 */

class MemoryConfig {
  constructor() {
    this.defaults = {
      // Storage configuration
      storage: {
        dbPath: './data/9router-memory.sqlite',
        maxConnections: 5,
        timeout: 30000
      },

      // Ingestion settings
      ingestion: {
        enabled: true,
        autoCompress: false,         // Auto-compress observations to memories
        compressThreshold: 10000,    // Token threshold before compression
        dedupWindowMinutes: 60,      // Deduplication window
        privacyFilterEnabled: true,  // Strip sensitive data
        maxObservationSize: 100000   // Max observation size in bytes
      },

      // Retrieval settings
      retrieval: {
        maxResults: 20,              // Max memories per query
        tokenBudget: 2000,           // Token budget for memory context
        bm25Weight: 0.4,             // Keyword search weight
        vectorWeight: 0.6,           // Semantic search weight (when available)
        minRelevanceScore: 0.3,      // Minimum score to include results
        recencyBoost: true,          // Boost recent memories
        importanceBoost: true        // Boost high-importance memories
      },

      // Provider adapter settings
      adapters: {
        defaultProvider: 'openai',
        providers: ['openai', 'claude', 'gemini', 'ollama', 'local']
      },

      // Consolidation settings
      consolidation: {
        enabled: true,
        intervalMinutes: 30,         // Run consolidation every 30 minutes
        mergeThreshold: 0.8,         // Merge memories with >80% similarity
        decayRate: 0.95,             // Daily decay multiplier
        minTtlDays: 7,               // Minimum TTL for expired memories
        snapshotEnabled: false,      // Create periodic snapshots
        snapshotIntervalDays: 7      // Snapshot frequency
      },

      // Privacy & security
      privacy: {
        piiDetectionEnabled: true,
        redactApiKeys: true,
        redactPasswords: true,
        redactTokens: true,
        allowSensitiveData: false,   // Require opt-in for sensitive data
        auditLogging: true
      },

      // Performance settings
      performance: {
        cacheEnabled: true,
        cacheMaxSize: 100,
        cacheTtlSeconds: 300,
        batchInsertSize: 50
      }
    };

    this.config = {};
    this.loadDefaults();
  }

  loadDefaults() {
    this.config = JSON.parse(JSON.stringify(this.defaults));
  }

  /**
   * Load config from environment or file
   * @param {Object} customConfig - Custom configuration override
   */
  load(customConfig = {}) {
    this.config = {
      ...this.defaults,
      ...customConfig,
      // Deep merge nested objects
      storage: { ...this.defaults.storage, ...(customConfig.storage || {}) },
      ingestion: { ...this.defaults.ingestion, ...(customConfig.ingestion || {}) },
      retrieval: { ...this.defaults.retrieval, ...(customConfig.retrieval || {}) },
      consolidation: { ...this.defaults.consolidation, ...(customConfig.consolidation || {}) },
      privacy: { ...this.defaults.privacy, ...(customConfig.privacy || {}) },
      performance: { ...this.defaults.performance, ...(customConfig.performance || {}) }
    };
  }

  /**
   * Get entire config
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Get specific setting
   */
  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value === undefined || value === null) return defaultValue;
      value = value[k];
    }
    
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Set specific setting
   */
  set(key, value) {
    const keys = key.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = current[keys[i]] || {};
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Enable/disable feature flag
   */
  enableFeature(featurePath) {
    this.set(featurePath, true);
  }

  disableFeature(featurePath) {
    this.set(featurePath, false);
  }

  /**
   * Check if feature is enabled
   */
  isEnabled(featurePath) {
    return this.get(featurePath, false);
  }

  /**
   * Validate configuration
   */
  validate() {
    const errors = [];
    
    if (this.config.retrieval.tokenBudget <= 0) {
      errors.push('tokenBudget must be positive');
    }
    if (this.config.ingestion.compressThreshold <= 0) {
      errors.push('compressThreshold must be positive');
    }
    if (this.config.consolidation.decayRate <= 0 || this.config.consolidation.decayRate >= 1) {
      errors.push('decayRate must be between 0 and 1');
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Create copy of current config
   */
  clone() {
    const copy = new MemoryConfig();
    copy.config = JSON.parse(JSON.stringify(this.config));
    return copy;
  }
}

// Singleton instance
const globalConfig = new MemoryConfig();

module.exports = {
  MemoryConfig,
  globalConfig
};
