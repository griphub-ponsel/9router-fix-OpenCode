/**
 * Provider Adapter Registry
 * Manages available adapters for different LLM providers
 */

const ProviderAdapter = require('./ProviderAdapter');
const OpenAIAdapter = require('./OpenAIAdapter');
const ClaudeAdapter = require('./ClaudeAdapter');
const GeminiAdapter = require('./GeminiAdapter');

class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
    this.defaultAdapter = null;
    
    this.registerDefaults();
  }

  /**
   * Register default adapters on initialization
   */
  registerDefaults() {
    this.register('openai', new OpenAIAdapter());
    this.register('claude', new ClaudeAdapter());
    this.register('gemini', new GeminiAdapter());
    
    // Set defaults
    this.defaultAdapter = 'openai';
  }

  /**
   * Register custom adapter
   */
  register(name, adapter) {
    if (!(adapter instanceof ProviderAdapter)) {
      throw new Error(`Invalid adapter for ${name}. Must extend ProviderAdapter.`);
    }
    
    this.adapters.set(name, adapter);
    console.log(`[AdapterRegistry] Registered adapter: ${name}`);
  }

  /**
   * Get adapter by name
   */
  getAdapter(name) {
    const adapter = this.adapters.get(name);
    
    if (!adapter) {
      // Fall back to default
      const defaultName = this.defaultAdapter;
      const fallback = this.adapters.get(defaultName);
      
      if (fallback) {
        console.warn(`[AdapterRegistry] Adapter '${name}' not found, falling back to '${defaultName}'`);
        return fallback;
      }
      
      throw new Error(`No adapter found for '${name}' and no default configured`);
    }
    
    return adapter;
  }

  /**
   * Set default adapter
   */
  setDefault(adapterName) {
    if (!this.adapters.has(adapterName)) {
      throw new Error(`Cannot set '${adapterName}' as default - adapter not registered`);
    }
    
    this.defaultAdapter = adapterName;
    console.log(`[AdapterRegistry] Default adapter set to: ${adapterName}`);
  }

  /**
   * List available adapters
   */
  listAdapters() {
    return Array.from(this.adapters.keys()).map(name => ({
      name,
      className: this.adapters.get(name).constructor.name
    }));
  }

  /**
   * Check if adapter exists
   */
  hasAdapter(name) {
    return this.adapters.has(name);
  }
}

// Singleton instance
const registry = new AdapterRegistry();

module.exports = {
  AdapterRegistry,
  registry
};
