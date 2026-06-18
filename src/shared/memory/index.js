/**
 * Memory System Module
 * Central export point for all memory components
 */

// Core services
const { MemoryService, memoryService } = require('./core/MemoryService');
const { MemoryConfig, globalConfig } = require('./core/MemoryConfig');

// Storage adapters
const StorageInterface = require('./storage/adapters/BaseAdapter');
const SqliteAdapter = require('./storage/adapters/SqliteAdapter');

// Models
const { SCOPE, MEMORY_TYPE, ACCESS_LEVEL } = require('./models/Scopes');

// Provider adapters
const ProviderAdapter = require('./providers/ProviderAdapter');
const OpenAIAdapter = require('./providers/OpenAIAdapter');
const ClaudeAdapter = require('./providers/ClaudeAdapter');
const GeminiAdapter = require('./providers/GeminiAdapter');
const { AdapterRegistry, registry: adapterRegistry } = require('./providers/AdapterRegistry');

// Utils
const PrivacyFilter = require('./utils/PrivacyFilter');
const TokenCounter = require('./utils/TokenCounter');

module.exports = {
  // Main service instance
  memoryService,
  
  // Classes for custom instances
  MemoryService,
  MemoryConfig,
  
  // Storage
  StorageInterface,
  SqliteAdapter,
  
  // Provider adapters
  ProviderAdapter,
  OpenAIAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  AdapterRegistry,
  adapterRegistry,
  
  // Constants
  SCOPE,
  MEMORY_TYPE,
  ACCESS_LEVEL,
  
  // Utils
  PrivacyFilter,
  TokenCounter,
  
  // Config
  globalConfig
};
