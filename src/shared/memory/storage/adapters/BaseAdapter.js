/**
 * Storage Adapter Interface
 * Abstract base class for all storage backends
 */

class StorageInterface {
  /**
   * Initialize the storage connection
   * @param {Object} config - Storage configuration
   * @returns {Promise<void>}
   */
  async initialize(config) {
    throw new Error('Method not implemented');
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Method not implemented');
  }

  // ==================== Session Operations ====================

  /**
   * Create a new session
   * @param {Object} session - Session data
   * @returns {Promise<string>} - Session ID
   */
  async createSession(session) {
    throw new Error('Method not implemented');
  }

  /**
   * Update session
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateSession(sessionId, updates) {
    throw new Error('Method not implemented');
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>}
   */
  async getSession(sessionId) {
    throw new Error('Method not implemented');
  }

  /**
   * List sessions with filters
   * @param {Object} filters - Filter criteria
   * @param {number} limit - Max results
   * @param {number} offset - Pagination offset
   * @returns {Promise<Object[]>}
   */
  async listSessions(filters = {}, limit = 50, offset = 0) {
    throw new Error('Method not implemented');
  }

  // ==================== Observation Operations ====================

  /**
   * Create observation
   * @param {Object} observation - Observation data
   * @returns {Promise<string>} - Observation ID
   */
  async createObservation(observation) {
    throw new Error('Method not implemented');
  }

  /**
   * Get observation by ID
   * @param {string} observationId - Observation ID
   * @returns {Promise<Object|null>}
   */
  async getObservation(observationId) {
    throw new Error('Method not implemented');
  }

  /**
   * List observations for session
   * @param {string} sessionId - Session ID
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object[]>}
   */
  async listObservations(sessionId, filters = {}) {
    throw new Error('Method not implemented');
  }

  // ==================== Memory Operations ====================

  /**
   * Save memory
   * @param {Object} memory - Memory data
   * @returns {Promise<string>} - Memory ID
   */
  async saveMemory(memory) {
    throw new Error('Method not implemented');
  }

  /**
   * Get memory by ID
   * @param {string} memoryId - Memory ID
   * @returns {Promise<Object|null>}
   */
  async getMemory(memoryId) {
    throw new Error('Method not implemented');
  }

  /**
   * List memories with filters
   * @param {Object} filters - Filter criteria (type, scope, workspace_id, etc.)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Object[]>}
   */
  async listMemories(filters = {}, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Update memory
   * @param {string} memoryId - Memory ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateMemory(memoryId, updates) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete memory
   * @param {string} memoryId - Memory ID
   * @returns {Promise<void>}
   */
  async deleteMemory(memoryId) {
    throw new Error('Method not implemented');
  }

  // ==================== Advanced Queries ====================

  /**
   * Search memories by keyword
   * @param {string} query - Search query
   * @param {Object} filters - Additional filters
   * @param {Object} options - Query options
   * @returns {Promise<Array<{memory: Object, score: number}>>}
   */
  async keywordSearch(query, filters = {}, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Semantic search using embeddings
   * @param {number[]} embedding - Embedding vector
   * @param {Object} filters - Filters
   * @param {number} topK - Number of results
   * @returns {Promise<Array<{memory: Object, similarity: number}>>}
   */
  async semanticSearch(embedding, filters = {}, topK = 10) {
    throw new Error('Method not implemented');
  }

  /**
   * Hybird search combining keyword + semantic
   * @param {string} query - Text query
   * @param {number[]} embedding - Optional embedding
   * @param {Object} options - Query options
   * @returns {Promise<Array<{memory: Object, rank: number}>>}
   */
  async hybridSearch(query, embedding = null, options = {}) {
    throw new Error('Method not implemented');
  }

  // ==================== Settings & Audit ====================

  /**
   * Get memory setting
   * @param {string} key - Setting key
   * @returns {Promise<Object|null>}
   */
  async getSetting(key) {
    throw new Error('Method not implemented');
  }

  /**
   * Set memory setting
   * @param {Object} setting - Setting data
   * @returns {Promise<void>}
   */
  async setSetting(setting) {
    throw new Error('Method not implemented');
  }

  /**
   * Log audit event
   * @param {Object} auditEvent - Audit log entry
   * @returns {Promise<string>} - Event ID
   */
  async logAudit(auditEvent) {
    throw new Error('Method not implemented');
  }

  // ==================== Statistics ====================

  /**
   * Get memory statistics
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>}
   */
  async getStats(filters = {}) {
    throw new Error('Method not implemented');
  }
}

module.exports = StorageInterface;
