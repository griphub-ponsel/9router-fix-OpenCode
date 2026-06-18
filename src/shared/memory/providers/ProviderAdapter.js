/**
 * Provider Adapter Interface
 * Abstract base for formatting memories for different LLM providers
 */

class ProviderAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Inject memories into prompt context
   * @param {Array} memories - Memory objects
   * @param {Object} context - Request context
   * @returns {string} Formatted context block
   */
  injectMemories(memories, context = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Format observation for storage
   * @param {Object} observation - Raw observation
   * @returns {Object} Formatted observation
   */
  formatObservation(observation) {
    return { ...observation };
  }

  /**
   * Get adapter name
   */
  getName() {
    throw new Error('Method not implemented');
  }
}

module.exports = ProviderAdapter;
