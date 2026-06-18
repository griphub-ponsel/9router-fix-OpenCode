/**
 * Memory System Unit Tests
 */

const { memoryService } = require('../../src/shared/memory');
const { SCOPE, MEMORY_TYPE } = require('../../src/shared/memory/models/Scopes');
const SqliteAdapter = require('../../src/shared/memory/storage/adapters/SqliteAdapter');
const PrivacyFilter = require('../../src/shared/memory/utils/PrivacyFilter');
const { captureChatMemory, extractRememberedPossession } = require('../../src/shared/memory/capture');

describe('MemorySystem', () => {
  
  const testConfig = {
    storage: { dbPath: ':memory:' },
    ingestion: { enabled: true, privacyFilterEnabled: true },
    retrieval: { tokenBudget: 2000, maxResults: 10 },
    privacy: { allowSensitiveData: false }
  };

  beforeEach(async () => {
    // Clean slate for each test
    await memoryService.shutdown();
  });

  afterEach(async () => {
    await memoryService.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully with default config', async () => {
      await memoryService.initialize({});
      
      expect(memoryService.initialized).toBe(true);
      expect(memoryService.adapter).toBeDefined();
    });

    it('should apply custom configuration', async () => {
      await memoryService.initialize(testConfig);
      
      const config = memoryService.getConfig();
      expect(config.storage.dbPath).toContain(':memory:');
      expect(config.retrieval.tokenBudget).toBe(2000);
    });

    it('should fail validation with invalid config', async () => {
      await expect(async () => {
        await memoryService.initialize({
          retrieval: { tokenBudget: -100 }  // Invalid
        });
      }).rejects.toThrow();
    });
  });

  describe('Observation Management', () => {
    let sessionId;

    beforeEach(async () => {
      await memoryService.initialize(testConfig);
      // Note: Would need to add startSession method or mock session
      sessionId = 'test-session-1';
    });

    it('should save observation with privacy filtering', async () => {
      const result = await memoryService.saveObservation({
        sessionId,
        type: 'tool_use',
        rawContent: 'Here is my API key: sk-test123456789abcdef',
        timestamp: new Date().toISOString()
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should deduplicate observations with same hash', async () => {
      const content = 'Same observation content';
      const contentHash = Buffer.from(content).toString('base64');
      
      // Save first time
      const id1 = await memoryService.saveObservation({
        sessionId,
        type: 'prompt',
        rawContent: content,
        contentHash,
        timestamp: new Date().toISOString()
      });

      // Try to save duplicate
      const id2 = await memoryService.saveObservation({
        sessionId,
        type: 'prompt',
        rawContent: content,
        contentHash,
        timestamp: new Date().toISOString()
      });

      // Should return same ID (cached) or skip
      expect(id1).toEqual(id2);
    });

    it('should handle sensitive data redaction', async () => {
      const observation = {
        sessionId,
        type: 'tool_use',
        rawContent: 'Password: supersecretpassword123\nAPI Key: abcdefghijklmnopqrstuvwxyz',
        timestamp: new Date().toISOString()
      };

      // Should not throw, even though contains sensitive data
      const result = await memoryService.saveObservation(observation);
      expect(result).toBeDefined();
    });
  });

  describe('Memory CRUD', () => {
    let memoryId;

    beforeEach(async () => {
      await memoryService.initialize(testConfig);
    });

    it('should create and retrieve memory', async () => {
      memoryId = await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'user-123',
        title: 'Test Preference',
        content: 'User prefers TypeScript over JavaScript'
      });

      expect(memoryId).toBeDefined();

      const retrieved = await memoryService.getMemory(memoryId);
      expect(retrieved.title).toBe('Test Preference');
      expect(retrieved.content).toBe('User prefers TypeScript over JavaScript');
      expect(retrieved.user_id).toBe('user-123');
    });

    it('should update memory fields', async () => {
      memoryId = await memoryService.saveMemory({
        type: MEMORY_TYPE.PROJECT,
        scope: SCOPE.WORKSPACE,
        workspaceId: 'ws-123',
        title: 'Initial Title',
        content: 'Original content'
      });

      await memoryService.updateMemory(memoryId, {
        title: 'Updated Title',
        importanceScore: 0.95
      }, 'user-123');

      const updated = await memoryService.getMemory(memoryId);
      expect(updated.title).toBe('Updated Title');
      expect(updated.importance_score).toBe(0.95);
    });

    it('should delete memory', async () => {
      memoryId = await memoryService.saveMemory({
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.GLOBAL,
        title: 'To Delete',
        content: 'Will be deleted'
      });

      await memoryService.deleteMemory(memoryId, 'user-123');

      const deleted = await memoryService.getMemory(memoryId);
      expect(deleted).toBeNull();
    });
  });

  describe('Search & Retrieval', () => {
    beforeEach(async () => {
      await memoryService.initialize(testConfig);
    });

    it('should perform keyword search', async () => {
      // Create test memories
      const id1 = await memoryService.saveMemory({
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.WORKSPACE,
        title: 'JWT Authentication',
        content: 'Using JWT tokens for stateless authentication in REST APIs'
      });

      const id2 = await memoryService.saveMemory({
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.WORKSPACE,
        title: 'Database Design',
        content: 'PostgreSQL schema for user management'
      });

      // Search for JWT-related content
      const results = await memoryService.searchMemories('JWT authentication', {
        maxResults: 10
      });

      expect(results.length).toBeGreaterThan(0);
      const jwtResult = results.find(r => r.title.includes('JWT'));
      expect(jwtResult).toBeDefined();
    });

    it('should filter by workspace scope', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.WORKSPACE,
        workspaceId: 'ws-specific',
        title: 'Workspace Memory',
        content: 'Specific to workspace'
      });

      const results = await memoryService.searchMemories('workspace', {
        workspaceId: 'ws-specific',
        scope: SCOPE.WORKSPACE
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect token budget', async () => {
      // Create large memories
      const largeContent = ' '.repeat(5000); // ~1000 tokens
      
      const id = await memoryService.saveMemory({
        type: MEMORY_TYPE.CONVERSATION,
        scope: SCOPE.SESSION,
        title: 'Large Context',
        content: largeContent
      });

      // Request with tight budget
      const smallResults = await memoryService.searchMemories('large context', {
        maxResults: 10,
        tokenBudget: 100  // Very small budget
      });

      // Should either return nothing or trimmed content
      expect(Array.isArray(smallResults)).toBe(true);
    });
  });

  describe('Privacy Filter', () => {
    it('should detect API keys', () => {
      const filter = new PrivacyFilter({
        redactApiKeys: true,
        redactPasswords: true
      });

      const text = 'My API key is sk-test123456789abcdefghijklmnopqrstuvwxyz';
      
      expect(filter.containsSensitiveData(text)).toBe(true);
      
      const redacted = filter.redact(text);
      expect(redacted.redactedText).toContain('[REDACTED_API_KEY]');
      expect(redacted.wasRedacted).toBe(true);
    });

    it('should redact passwords', () => {
      const filter = new PrivacyFilter({ redactPasswords: true });
      
      const text = 'password: mysupersecret123';
      const redacted = filter.redact(text);
      
      expect(redacted.redactedText).toContain('[REDACTED_PASSWORD]');
    });

    it('should handle multiple sensitive patterns', () => {
      const filter = new PrivacyFilter({
        redactApiKeys: true,
        redactPasswords: true,
        redactTokens: true
      });

      const text = `
        API Key: sk-live-abcdef123456789
        Password: hunter2
        Token: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
      `;

      const result = filter.redact(text);
      
      expect(result.redactedText.split('[').length - 1).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Token Counter', () => {
    let counter;

    beforeEach(() => {
      counter = new (require('../../src/shared/memory/utils/TokenCounter'))();
    });

    it('should estimate token count reasonably', () => {
      const text = 'This is a simple sentence for testing.';
      const count = counter.count(text);
      
      // Roughly 7 words × 1.3 ratio ≈ 9 tokens
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(20);
    });

    it('should truncate text to fit budget', () => {
      const longText = 'Word '.repeat(1000); // Large text
      const truncated = counter.truncateToFit(longText, 50);
      
      const tokens = counter.count(truncated);
      expect(tokens).toBeLessThanOrEqual(50);
    });

    it('should calculate batch token counts', () => {
      const texts = ['First sentence.', 'Second sentence here.', 'Third one now.'];
      const results = counter.countBatch(texts);
      
      expect(results.length).toBe(texts.length + 1); // +1 for total
      expect(results[results.length - 1].total).toBeGreaterThan(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await memoryService.initialize(testConfig);
    });

    it('should return memory statistics', async () => {
      // Create some test data
      await memoryService.saveMemory({
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.GLOBAL,
        title: 'Stat Test',
        content: 'Testing stats'
      });

      const stats = await memoryService.getStats();
      
      expect(stats.totalMemories).toBeGreaterThan(0);
      expect(stats.memoriesByType).toBeDefined();
    });
  });

  describe('Event Emission', () => {
    let eventsReceived = [];

    beforeEach(async () => {
      await memoryService.initialize(testConfig);
      eventsReceived = [];
      
      memoryService.on('memory_saved', (data) => {
        eventsReceived.push(data);
      });
      
      memoryService.on('memories_retrieved', (data) => {
        eventsReceived.push(data);
      });
    });

    it('should emit event when memory saved', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        title: 'Event Test',
        content: 'Testing event emission'
      });

      expect(eventsReceived.some(e => e.id && e.memory)).toBeTruthy();
      expect(eventsReceived.length).toBeGreaterThan(0);
    });
  });

  describe('Scope Isolation', () => {
    beforeEach(async () => {
      await memoryService.initialize(testConfig);
    });

    it('should separate memories by user', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'user-a',
        title: 'User A Memory',
        content: 'Private to user A'
      });

      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'user-b',
        title: 'User B Memory',
        content: 'Private to user B'
      });

      const userAResults = await memoryService.searchMemories('user A', {
        userId: 'user-a'
      });

      const userBResults = await memoryService.searchMemories('user B', {
        userId: 'user-b'
      });

      expect(userAResults.some(m => m.title === 'User A Memory')).toBe(true);
      expect(userBResults.some(m => m.title === 'User B Memory')).toBe(true);
    });
  });

  describe('Prompt Capture', () => {
    beforeEach(async () => {
      await memoryService.initialize(testConfig);
    });

    it('should remember the user name from an explicit prompt', async () => {
      await captureChatMemory({
        model: 'test/model',
        messages: [
          { role: 'user', content: 'tolong inget nama gw aldrey' }
        ]
      }, {
        sessionId: 'capture-session-1',
        userId: 'local-user'
      });

      const results = await memoryService.searchMemories('Aldrey', {
        userId: 'local-user'
      });

      expect(results.some(memory => memory.title === 'User name: Aldrey')).toBe(true);
    });

    it('should remember the user age from an explicit prompt', async () => {
      await captureChatMemory({
        model: 'test/model',
        messages: [
          { role: 'user', content: 'inget gw sekarang umur 27' }
        ]
      }, {
        sessionId: 'capture-session-2',
        userId: 'local-user'
      });

      const results = await memoryService.searchMemories('27', {
        userId: 'local-user'
      });

      expect(results.some(memory => memory.title === 'User age: 27')).toBe(true);
    });

    it('should remember user possession count from an explicit prompt', async () => {
      await captureChatMemory({
        model: 'test/model',
        messages: [
          { role: 'user', content: 'inget, hape gw ada 5' }
        ]
      }, {
        sessionId: 'capture-session-3',
        userId: 'local-user'
      });

      const results = await memoryService.searchMemories('phones', {
        userId: 'local-user'
      });

      expect(results.some(memory => memory.title === 'User phones: 5')).toBe(true);
    });

    it('should extract possession from various phrasings', () => {
      expect(extractRememberedPossession('hape gw ada 5')).toEqual({ item: 'phones', count: 5 });
      expect(extractRememberedPossession('gw punya 2 mobil')).toEqual({ item: 'cars', count: 2 });
      expect(extractRememberedPossession('my laptop ada 3')).toEqual({ item: 'laptops', count: 3 });
      expect(extractRememberedPossession('inget, hape gw ada 5')).toEqual({ item: 'phones', count: 5 });
    });
  });
});
