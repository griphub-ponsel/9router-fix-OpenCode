/**
 * Auto-memory (ChatGPT-style extraction) tests.
 */

const { memoryService } = require('../../src/shared/memory');
const { SCOPE, MEMORY_TYPE } = require('../../src/shared/memory/models/Scopes');
const {
  parseExtractionJson,
  getConversationTurns,
  runAutoMemoryExtraction,
  resetAutoMemoryState,
  MEMORY_INTERNAL_HEADER
} = require('../../src/shared/memory/autoMemory');
const {
  captureChatMemory,
  injectMemoryContext,
  deriveSessionId,
  getLatestAssistantText
} = require('../../src/shared/memory/capture');

const testConfig = {
  storage: { dbPath: ':memory:' },
  ingestion: { enabled: true, privacyFilterEnabled: true },
  retrieval: { tokenBudget: 2000, maxResults: 10 },
  privacy: { allowSensitiveData: false }
};

function mockExtractionFetch(items) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(items) } }]
    })
  }));
}

describe('AutoMemory', () => {
  beforeEach(async () => {
    await memoryService.shutdown();
    await memoryService.initialize(testConfig);
    resetAutoMemoryState();
  });

  afterEach(async () => {
    await memoryService.shutdown();
    vi.unstubAllGlobals();
  });

  describe('parseExtractionJson', () => {
    it('parses a plain JSON array', () => {
      const items = parseExtractionJson(JSON.stringify([
        { kind: 'preference', title: 'Likes TypeScript', content: 'User prefers TypeScript over JavaScript.', importance: 0.8 }
      ]));
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe('preference');
    });

    it('tolerates markdown fences and surrounding prose', () => {
      const raw = 'Here you go:\n```json\n[{"kind":"project","title":"Port","content":"The CLI runtime listens on port 20128.","importance":0.7}]\n```';
      const items = parseExtractionJson(raw);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Port');
    });

    it('drops invalid kinds and empty content', () => {
      const items = parseExtractionJson(JSON.stringify([
        { kind: 'nonsense', title: 'x', content: 'something long enough' },
        { kind: 'decision', title: '', content: 'no title' },
        { kind: 'decision', title: 'ok', content: 'short' },
        { kind: 'decision', title: 'Valid', content: 'We chose SQLite over Postgres for local storage.' }
      ]));
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Valid');
    });

    it('returns [] for garbage', () => {
      expect(parseExtractionJson('not json at all')).toEqual([]);
      expect(parseExtractionJson('')).toEqual([]);
      expect(parseExtractionJson(null)).toEqual([]);
    });
  });

  describe('getConversationTurns', () => {
    it('extracts user and assistant turns from messages[]', () => {
      const turns = getConversationTurns({
        messages: [
          { role: 'system', content: 'be helpful' },
          { role: 'user', content: 'why is the build failing?' },
          { role: 'assistant', content: 'EPERM on better_sqlite3 — a process is holding the binary.' },
          { role: 'user', content: 'ah makes sense' }
        ]
      });
      expect(turns).toHaveLength(3);
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
    });

    it('supports Responses API input[] and array content parts', () => {
      const turns = getConversationTurns({
        input: [
          { role: 'user', content: [{ type: 'input_text', text: 'hello there' }] }
        ]
      });
      expect(turns).toHaveLength(1);
      expect(turns[0].text).toBe('hello there');
    });
  });

  describe('runAutoMemoryExtraction', () => {
    const body = {
      messages: [
        { role: 'user', content: 'The build kept failing with EPERM, what gives? I really need this fixed today because of the demo.' },
        { role: 'assistant', content: 'Root cause: the standalone server holds better_sqlite3.node. Stop it before rebuilding and the EPERM goes away.' }
      ]
    };

    it('saves extracted memories via the mocked LLM', async () => {
      vi.stubGlobal('fetch', mockExtractionFetch([
        {
          kind: 'problem_solution',
          title: 'EPERM build fix',
          content: 'Windows build fails with EPERM on better_sqlite3.node when the standalone server is running; stop it before rebuilding.',
          importance: 0.9
        }
      ]));

      const result = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's1' }, { force: true });
      expect(result.ran).toBe(true);
      expect(result.saved).toBe(1);

      const found = await memoryService.searchMemories('EPERM better_sqlite3', { userId: 'local-user' });
      expect(found.some((m) => m.title === 'EPERM build fix')).toBe(true);
      expect(found.find((m) => m.title === 'EPERM build fix').type).toBe(MEMORY_TYPE.PROCEDURAL);
    });

    it('marks the self-call with the internal header (recursion guard)', async () => {
      const fetchMock = mockExtractionFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's2' }, { force: true });
      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers[MEMORY_INTERNAL_HEADER]).toBe('1');
    });

    it('inherits the active request model when extraction model is auto', async () => {
      const fetchMock = mockExtractionFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await runAutoMemoryExtraction(body, {
        userId: 'local-user',
        sessionId: 's2-inherit',
        provider: 'ollama-local',
        model: 'qwen2.5-coder:7b'
      }, { force: true });

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(requestBody.model).toBe('ollama-local/qwen2.5-coder:7b');
    });

    it('keeps an explicitly configured extraction model', async () => {
      const fetchMock = mockExtractionFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await runAutoMemoryExtraction(body, {
        userId: 'local-user',
        sessionId: 's2-explicit',
        provider: 'ollama-local',
        model: 'qwen2.5-coder:7b'
      }, { force: true, model: 'cx/gpt-5.4' });

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(requestBody.model).toBe('cx/gpt-5.4');
    });

    it('skips near-duplicate memories', async () => {
      const item = {
        kind: 'project',
        title: 'CLI port',
        content: 'The CLI runtime listens on port 20128, not 20127.',
        importance: 0.8
      };
      vi.stubGlobal('fetch', mockExtractionFetch([item]));

      const first = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's3' }, { force: true });
      expect(first.saved).toBe(1);

      const second = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's3' }, { force: true });
      expect(second.saved).toBe(0);
      expect(second.skipped).toBe(1);
    });

    it('updates an existing memory when update_title is provided', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'Editor preference',
        content: 'User prefers VS Code stable.',
        importanceScore: 0.7
      });

      vi.stubGlobal('fetch', mockExtractionFetch([
        {
          kind: 'preference',
          title: 'Editor preference',
          content: 'User switched to VS Code Insiders as their main editor.',
          importance: 0.8,
          update_title: 'Editor preference'
        }
      ]));

      const result = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's4' }, { force: true });
      expect(result.updated).toBe(1);

      const rows = await memoryService.adapter.listMemories({ scope: SCOPE.USER, userId: 'local-user' }, { limit: 50 });
      const prefs = rows.filter((m) => m.title === 'Editor preference');
      expect(prefs).toHaveLength(1);
      expect(prefs[0].content).toContain('Insiders');
    });

    it('is throttled per session without force', async () => {
      vi.stubGlobal('fetch', mockExtractionFetch([]));

      const first = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's5' });
      expect(first.ran).toBe(true);

      // Same content, same session → change detection blocks the rerun.
      const second = await runAutoMemoryExtraction(body, { userId: 'local-user', sessionId: 's5' });
      expect(second.ran).toBe(false);
      expect(second.reason).toBe('throttled');
    });
  });

  describe('deriveSessionId', () => {
    it('is stable for the same conversation history', () => {
      const bodyA = { messages: [{ role: 'user', content: 'first message of thread' }, { role: 'assistant', content: 'answer' }] };
      const bodyB = { messages: [{ role: 'user', content: 'first message of thread' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'follow-up' }] };
      expect(deriveSessionId(bodyA)).toBe(deriveSessionId(bodyB));
      expect(deriveSessionId(bodyA)).toMatch(/^conv-/);
    });

    it('respects an explicit session id', () => {
      expect(deriveSessionId({ messages: [{ role: 'user', content: 'x' }] }, 'my-session')).toBe('my-session');
    });
  });

  describe('assistant turn capture', () => {
    it('captures the latest assistant message as an observation', async () => {
      const body = {
        messages: [
          { role: 'user', content: 'fix the login bug please' },
          { role: 'assistant', content: 'Fixed: the JWT expiry check used seconds instead of milliseconds.' },
          { role: 'user', content: 'thanks, works now' }
        ]
      };

      const result = await captureChatMemory(body, { sessionId: 'assist-1', userId: 'local-user' });
      expect(result.observations).toBe(2);

      const observations = await memoryService.adapter.listObservationsBySession('assist-1', { limit: 10 });
      expect(observations.some((o) => o.type === 'assistant_response' && /JWT expiry/.test(o.raw_content))).toBe(true);
    });

    it('extracts assistant text from array content', () => {
      const text = getLatestAssistantText({
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] }
        ]
      });
      expect(text).toContain('part one');
      expect(text).toContain('part two');
    });

    it('builds a clean chronological transcript for session recaps', () => {
      const transcript = memoryService.formatEpisodicTranscript([
        {
          type: 'prompt',
          raw_content: '<environment_info>Windows metadata</environment_info><userRequest>tolong perbaiki login</userRequest>'
        },
        {
          type: 'assistant_response',
          raw_content: 'Login sudah diperbaiki dan dites.'
        }
      ]);

      expect(transcript).toBe('User: tolong perbaiki login\n\nAssistant: Login sudah diperbaiki dan dites.');
      expect(transcript).not.toContain('Windows metadata');
      expect(transcript.indexOf('User:')).toBeLessThan(transcript.indexOf('Assistant:'));
    });

    it('creates a readable recap title without exposing a session id', () => {
      const title = memoryService.createEpisodicTitle('User asked to repair login. The fix was verified.');
      expect(title).toBe('Conversation recap: User asked to repair login');
      expect(title).not.toContain('conv-');
    });
  });

  describe('injectMemoryContext v2', () => {
    it('injects core facts and relevant memories under one system block', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'User name: Aldrey',
        content: "User's name is Aldrey.",
        importanceScore: 1.0
      });
      await memoryService.saveMemory({
        type: MEMORY_TYPE.PROCEDURAL,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'EPERM build fix',
        content: 'EPERM on better_sqlite3.node means a server process is holding the binary; stop it before rebuilding.',
        importanceScore: 0.9
      });

      const body = {
        messages: [{ role: 'user', content: 'build failing with EPERM better_sqlite3 again, help' }]
      };
      const result = await injectMemoryContext(body, { userId: 'local-user' });
      expect(result.injected).toBeGreaterThanOrEqual(2);

      const systemMessage = body.messages.find((m) => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain('past conversations via 9router');
      expect(systemMessage.content).toContain('Aldrey');
      expect(systemMessage.content).toContain('EPERM');
    });

    it('injects recent durable memories for broad recall questions', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.PROJECT,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'Router architecture',
        content: 'Canonical restart method uses a detached PowerShell process.',
        importanceScore: 0.9
      });

      const body = { messages: [{ role: 'user', content: 'Bro, apa yang lu inget tentang gw?' }] };
      const result = await injectMemoryContext(body, { userId: 'api:test-key' });
      const systemMessage = body.messages.find((message) => message.role === 'system');

      expect(result.injected).toBeGreaterThan(0);
      expect(systemMessage.content).toContain('detached PowerShell process');
    });

    it('always injects pinned local-user memories into API-key requests', async () => {
      const memoryId = await memoryService.saveMemory({
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'Pinned provider rule',
        content: 'Never replace XOG with direct xAI.',
        importanceScore: 1
      });
      await memoryService.pinMemory(memoryId, 'local-user');

      const body = { messages: [{ role: 'user', content: 'Update Grok config' }] };
      const result = await injectMemoryContext(body, { userId: 'api:another-client' });
      const systemMessage = body.messages.find((message) => message.role === 'system');

      expect(result.injected).toBeGreaterThan(0);
      expect(systemMessage.content).toContain('Never replace XOG');
    });

    it('skips an oversized memory without blocking smaller relevant memories', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.PROJECT,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'Oversized memory',
        content: `oversized ${'x'.repeat(10000)}`,
        importanceScore: 0.9
      });
      await memoryService.saveMemory({
        type: MEMORY_TYPE.PROJECT,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'Small useful memory',
        content: 'Canonical memory DB is data/9router-memory.sqlite.',
        importanceScore: 0.9
      });

      const body = { messages: [{ role: 'user', content: 'Apa yang lu inget tentang memory gw?' }] };
      const result = await injectMemoryContext(body, { userId: 'local-user', tokenBudget: 80 });
      const systemMessage = body.messages.find((message) => message.role === 'system');

      expect(result.injected).toBeGreaterThan(0);
      expect(systemMessage.content).toContain('Canonical memory DB');
    });

    it('does not double-inject on repeated calls', async () => {
      await memoryService.saveMemory({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'local-user',
        title: 'User name: Aldrey',
        content: "User's name is Aldrey.",
        importanceScore: 1.0
      });

      const body = { messages: [{ role: 'user', content: 'hello' }] };
      await injectMemoryContext(body, { userId: 'local-user' });
      await injectMemoryContext(body, { userId: 'local-user' });

      const systemMessages = body.messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
    });

    it('respects the token budget', async () => {
      for (let i = 0; i < 30; i++) {
        await memoryService.saveMemory({
          type: MEMORY_TYPE.USER_PREF,
          scope: SCOPE.USER,
          userId: 'local-user',
          title: `Fact ${i}`,
          content: `Long remembered fact number ${i}: ${'lorem ipsum dolor sit amet '.repeat(20)}`,
          importanceScore: 0.5
        });
      }

      const body = { messages: [{ role: 'user', content: 'hi' }] };
      const result = await injectMemoryContext(body, { userId: 'local-user', tokenBudget: 300 });
      const systemMessage = body.messages.find((m) => m.role === 'system');
      expect(systemMessage).toBeDefined();
      // ~300 token budget ≈ 1200 chars of memory lines; block must stay small.
      expect(systemMessage.content.length).toBeLessThan(3000);
      expect(result.injected).toBeLessThan(30);
    });
  });
});
