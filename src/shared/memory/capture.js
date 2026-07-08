/**
 * Chat prompt capture helpers for the memory system.
 */

const { memoryService, SCOPE, MEMORY_TYPE, TokenCounter } = require('./index');

const tokenCounter = new TokenCounter();

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        return part?.text || part?.input_text || part?.content || '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return content.text || content.input_text || content.content || '';
}

function getUserPromptText(body = {}) {
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];

  if (typeof body.input === 'string') return body.input;

  return messages
    .filter((message) => !message.role || message.role === 'user')
    .map((message) => extractText(message.content || message.text || message.input))
    .filter(Boolean)
    .join('\n\n');
}

function getChatMessages(body = {}) {
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  return [];
}

/** Last user message only — much better retrieval query than the whole history. */
function getLastUserText(body = {}) {
  if (typeof body.input === 'string') return body.input;
  const messages = getChatMessages(body);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || (message.role && message.role !== 'user')) continue;
    const text = extractText(message.content || message.text || message.input).trim();
    if (text) return text;
  }
  return '';
}

/** Latest assistant message from the (client-resent) history. */
function getLatestAssistantText(body = {}) {
  const messages = getChatMessages(body);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const text = extractText(message.content || message.text).trim();
    if (text) return text;
  }
  return '';
}

function cheapHash(text) {
  let hash = 5381;
  const str = String(text || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

/**
 * Derive a stable per-conversation session id when the client did not send one.
 * Clients like VS Code resend the whole history each turn, so the first user
 * message is a stable fingerprint for the conversation. This keeps each chat
 * thread in its OWN memory session instead of one giant "chat-local" bucket.
 */
function deriveSessionId(body = {}, explicitId = null) {
  if (explicitId && explicitId !== 'chat-local') return explicitId;

  const messages = getChatMessages(body);
  for (const message of messages) {
    if (message?.role && message.role !== 'user') continue;
    const text = extractText(message?.content || message?.text || message?.input).trim();
    if (text) return `conv-${cheapHash(text.slice(0, 500))}`;
  }
  return explicitId || 'chat-local';
}

function normalizeName(name) {
  const cleaned = String(name || '').trim().replace(/[.,!?;:]+$/, '');
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractRememberedIdentity(text) {
  const patterns = [
    /\b(?:nama|name)\s+(?:gw|gue|saya|aku|ku)\s*(?:adalah|is|=|:)?\s+([a-z][a-z0-9_.-]{1,40})\b/i,
    /\bmy\s+name\s*(?:is|=|:)?\s+([a-z][a-z0-9_.-]{1,40})\b/i,
    /\b(?:panggil|call)\s+(?:gw|gue|saya|aku|me)?\s*(?:as|dengan|=|:)?\s+([a-z][a-z0-9_.-]{1,40})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = normalizeName(match?.[1]);
    if (name) return { name };
  }

  return null;
}

function extractRememberedAge(text) {
  const patterns = [
    /\b(?:gw|gue|saya|aku|i)\s+(?:sekarang\s+)?(?:umur|usia|am)\s*(?:adalah|is|=|:)?\s*(\d{1,3})\b/i,
    /\b(?:umur|usia|age)\s+(?:gw|gue|saya|aku|ku|my)?\s*(?:sekarang\s+)?(?:adalah|is|=|:)?\s*(\d{1,3})\b/i,
    /\b(?:i'?m|i\s+am)\s+(\d{1,3})\s*(?:years?\s+old)?\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const age = Number(match?.[1]);
    if (Number.isInteger(age) && age > 0 && age < 130) return { age };
  }

  return null;
}

async function ensureInitialized() {
  if (!memoryService.initialized) {
    await memoryService.initialize();
  }
}

async function saveUserNameMemory(name, context) {
  const userId = context.userId || 'local-user';
  const existingMemories = await memoryService.adapter.listMemories({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId
  }, { limit: 100 });

  const existingNameMemory = existingMemories.find((memory) =>
    String(memory.title || '').toLowerCase().startsWith('user name:')
  );

  const title = `User name: ${name}`;
  const content = `User's name is ${name}.`;

  if (existingNameMemory) {
    if (existingNameMemory.title === title && existingNameMemory.content === content) {
      return existingNameMemory.id;
    }

    await memoryService.updateMemory(existingNameMemory.id, {
      title,
      content,
      importanceScore: 1.0
    }, userId);
    return existingNameMemory.id;
  }

  return await memoryService.saveMemory({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId,
    title,
    content,
    importanceScore: 1.0
  });
}

async function saveUserAgeMemory(age, context) {
  const userId = context.userId || 'local-user';
  const existingMemories = await memoryService.adapter.listMemories({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId
  }, { limit: 100 });

  const existingAgeMemory = existingMemories.find((memory) =>
    String(memory.title || '').toLowerCase().startsWith('user age:')
  );

  const title = `User age: ${age}`;
  const content = `User is ${age} years old.`;

  if (existingAgeMemory) {
    if (existingAgeMemory.title === title && existingAgeMemory.content === content) {
      return existingAgeMemory.id;
    }

    await memoryService.updateMemory(existingAgeMemory.id, {
      title,
      content,
      importanceScore: 1.0
    }, userId);
    return existingAgeMemory.id;
  }

  return await memoryService.saveMemory({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId,
    title,
    content,
    importanceScore: 1.0
  });
}

function extractRememberedPossession(text) {
  const patterns = [
    /\b(?:inget|ingat|ingetin|remember|simpan|catat|catet)\s*,?\s*(?:kalau|bahwa)?\s*(?:jumlah|jumalh|total)?\s*(?:file|files|berkas)\s+(?:ini|itu|gw|gue|saya|aku|ku|my)?\s*(?:ada|punya|have|is|=|:)?\s*(\d{1,4})\b/i,
    /\b(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike|file|files|berkas)\s+(?:gw|gue|saya|aku|ku|my|I|ini|itu)\s+(?:ada|punya|have|ada\s+di)?\s*(\d{1,4})\b/i,
    /\b(?:gw|gue|saya|aku|I)\s+(?:punya|ada|have)\s+(\d{1,4})\s+(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike|file|files|berkas)\b/i,
    /\b(?:gw|gue|saya|aku|my|jumlah|jumalh|total)\s+(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike|file|files|berkas)\s+(?:ini|itu|ada|punya|have|is)?\s*(\d{1,4})\b/i,
    /\b(?:inget|ingat|ingetin|remember|simpan|catat|catet)\s*,?\s*(?:hape|hp|phone|mobil|motor|rumah|laptop|car|house|bike|file|files|berkas)\s+(?:gw|gue|saya|aku|ku|my|ini|itu)?\s*(?:ada|punya|have|is)?\s*(\d{1,4})\b/i
  ];

  const itemMap = {
    hape: 'phones', hp: 'phones', phone: 'phones', phones: 'phones',
    mobil: 'cars', car: 'cars',
    motor: 'motorcycles', bike: 'motorcycles',
    rumah: 'houses', house: 'houses',
    laptop: 'laptops', komputer: 'computers', computer: 'computers',
    file: 'files', files: 'files', berkas: 'files'
  };

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const count = Number(match?.[1]);
    if (!Number.isInteger(count) || count < 0) continue;

    const matchedWord = (match[0].match(/\b(hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike|file|files|berkas)\b/i) || [])[1]?.toLowerCase();
    const item = itemMap[matchedWord] || matchedWord || 'items';
    return { item, count };
  }

  return null;
}

async function saveUserPossessionMemory(item, count, context) {
  const userId = context.userId || 'local-user';
  const existingMemories = await memoryService.adapter.listMemories({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId
  }, { limit: 100 });

  const title = `User ${item}: ${count}`;
  const content = `User has ${count} ${item}.`;

  const existing = existingMemories.find((memory) =>
    String(memory.title || '').toLowerCase().startsWith(`user ${item}:`)
  );

  if (existing) {
    if (existing.title === title && existing.content === content) {
      return existing.id;
    }

    await memoryService.updateMemory(existing.id, {
      title,
      content,
      importanceScore: 1.0
    }, userId);
    return existing.id;
  }

  return await memoryService.saveMemory({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId,
    title,
    content,
    importanceScore: 1.0
  });
}

function extractRememberedPin(text) {
  const patterns = [
    /\b(?:inget|ingat|ingetin|remember|simpan|catat|catet)\s*,?\s*(?:kalau|bahwa)?\s*(?:pin|kode|passcode|password)\s+(?:ini|gw|gue|saya|aku|ku|my)?\s*(?:adalah|is|=|:)?\s*(\d{3,12})\b/i,
    /\b(?:pin|kode|passcode|password)\s+(?:ini|gw|gue|saya|aku|ku|my)?\s*(?:adalah|is|=|:)?\s*(\d{3,12})\b/i,
    /\bmy\s+(?:pin|code|passcode|password)\s*(?:is|=|:)?\s*(\d{3,12})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const pin = match?.[1];
    if (pin && /^\d{3,12}$/.test(pin)) return { pin };
  }

  return null;
}

async function saveUserPinMemory(pin, context) {
  const userId = context.userId || 'local-user';
  const existingMemories = await memoryService.adapter.listMemories({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId
  }, { limit: 100 });

  const title = `User pin: ${pin}`;
  const content = `User's pin is ${pin}.`;

  const existing = existingMemories.find((memory) =>
    String(memory.title || '').toLowerCase().startsWith('user pin:')
  );

  if (existing) {
    if (existing.title === title && existing.content === content) {
      return existing.id;
    }

    await memoryService.updateMemory(existing.id, {
      title,
      content,
      importanceScore: 1.0
    }, userId);
    return existing.id;
  }

  return await memoryService.saveMemory({
    type: MEMORY_TYPE.USER_PREF,
    scope: SCOPE.USER,
    userId,
    title,
    content,
    importanceScore: 1.0
  });
}

function extractRememberedGeneric(text) {
  const patterns = [
    /\b(?:tolong\s+)?(?:ingetin|inget|ingat|remember|simpan|catat|catet)\s*,?\s*(?:kalau|bahwa|that)?\s+([\s\S]{3,300})/i,
    /\bplease\s+remember\s+(?:that\s+)?([\s\S]{3,300})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const content = String(match?.[1] || '')
      .trim()
      .replace(/^[,:;\-\s]+/, '')
      .replace(/[\s.!?]+$/, '');
    if (content.length >= 3) return { content };
  }

  return null;
}

async function saveGenericUserMemory(content, context) {
  const userId = context.userId || 'local-user';
  const existingMemories = await memoryService.adapter.listMemories({
    type: MEMORY_TYPE.SEMANTIC,
    scope: SCOPE.USER,
    userId
  }, { limit: 100 });

  const normalized = content.toLowerCase();
  const existing = existingMemories.find((memory) =>
    String(memory.content || '').trim().toLowerCase() === normalized
  );
  if (existing) return existing.id;

  return await memoryService.saveMemory({
    type: MEMORY_TYPE.SEMANTIC,
    scope: SCOPE.USER,
    userId,
    title: `User memory: ${content.slice(0, 60)}`,
    content,
    importanceScore: 0.9
  });
}

// Dedupe guard so the same assistant turn (resent with every request) is
// only captured once per session. Keyed by session, capped to avoid growth.
const capturedAssistantHashes = new Map();
const MAX_ASSISTANT_HASH_SESSIONS = 300;

function alreadyCapturedAssistant(sessionId, hash) {
  const seen = capturedAssistantHashes.get(sessionId);
  if (seen?.has(hash)) return true;
  if (!seen) {
    if (capturedAssistantHashes.size >= MAX_ASSISTANT_HASH_SESSIONS) {
      const oldestKey = capturedAssistantHashes.keys().next().value;
      capturedAssistantHashes.delete(oldestKey);
    }
    capturedAssistantHashes.set(sessionId, new Set([hash]));
  } else {
    seen.add(hash);
  }
  return false;
}

async function captureChatMemory(body = {}, context = {}) {
  const promptText = getUserPromptText(body);
  if (!promptText.trim()) {
    return { observations: 0, memories: 0 };
  }

  await ensureInitialized();

  const sessionId = deriveSessionId(body, context.sessionId || body.session_id || body.conversation_id || body.thread_id || null);
  await memoryService.saveObservation({
    sessionId,
    type: 'prompt',
    rawContent: promptText,
    timestamp: new Date().toISOString(),
    workspaceId: context.workspaceId || 'default',
    userId: context.userId || 'local-user',
    provider: context.provider || null,
    model: context.model || body.model || null
  });

  // Capture the previous assistant answer too (clients resend full history),
  // so "what the AI concluded/fixed" is remembered — not just what user asked.
  let assistantObservations = 0;
  const assistantText = getLatestAssistantText(body);
  if (assistantText) {
    const hash = cheapHash(assistantText);
    if (!alreadyCapturedAssistant(sessionId, hash)) {
      await memoryService.saveObservation({
        sessionId,
        type: 'assistant_response',
        rawContent: assistantText.slice(0, 20000),
        timestamp: new Date().toISOString(),
        workspaceId: context.workspaceId || 'default',
        userId: context.userId || 'local-user',
        provider: context.provider || null,
        model: context.model || body.model || null
      });
      assistantObservations = 1;
    }
  }

  const memoryIds = [];
  const identity = extractRememberedIdentity(promptText);
  const ageFact = extractRememberedAge(promptText);
  const possessionFact = extractRememberedPossession(promptText);
  const pinFact = extractRememberedPin(promptText);
  const genericFact = extractRememberedGeneric(promptText);

  if (identity?.name) {
    memoryIds.push(await saveUserNameMemory(identity.name, context));
  }

  if (ageFact?.age) {
    memoryIds.push(await saveUserAgeMemory(ageFact.age, context));
  }

  if (possessionFact?.item) {
    memoryIds.push(await saveUserPossessionMemory(possessionFact.item, possessionFact.count, context));
  }

  if (pinFact?.pin) {
    memoryIds.push(await saveUserPinMemory(pinFact.pin, context));
  }

  if (memoryIds.length === 0 && genericFact?.content) {
    memoryIds.push(await saveGenericUserMemory(genericFact.content, context));
  }

  return { observations: 1 + assistantObservations, memories: memoryIds.length, memoryIds, sessionId };
}

/**
 * Retrieve the user's stored memories and inject them into the outgoing chat
 * request as a system message — ChatGPT-style:
 *
 *   1. Core user facts (user_pref + pinned) are ALWAYS included.
 *   2. Memories relevant to the CURRENT prompt (semantic/episodic/procedural/
 *      project — e.g. "we solved this bug before") are retrieved via hybrid
 *      search and included by relevance.
 *   3. Everything is clamped to a token budget so long histories stay cheap.
 *
 * Fail-open: any error returns { injected: 0 } and leaves the body untouched.
 */
async function injectMemoryContext(body = {}, context = {}) {
  try {
    await ensureInitialized();

    const userId = context.userId || 'local-user';
    const tokenBudget = context.tokenBudget || 1200;
    const lastUserText = getLastUserText(body);
    const seen = new Set();
    const coreFacts = [];
    const relevantMemories = [];

    const addTo = (bucket, rows = []) => {
      for (const memory of rows || []) {
        const key = String(memory.id || memory.title || memory.content || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.push(memory);
      }
    };

    const userIds = userId === 'local-user' ? ['local-user'] : [userId, 'local-user'];

    // 1. Core user facts: preferences/identity — always present, like ChatGPT's bio.
    for (const uid of userIds) {
      const rows = await memoryService.adapter.listMemories({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: uid
      }, { limit: 30 });
      addTo(coreFacts, rows);
    }

    // Pinned memories are always injected regardless of relevance.
    try {
      const pinned = await memoryService.getPinnedMemories({ userId }, 20);
      addTo(coreFacts, pinned);
    } catch { /* older adapters may not support pins */ }

    // 2. Relevance-based recall for the current prompt (solved problems,
    //    project knowledge, past session summaries).
    if (lastUserText.trim()) {
      for (const uid of userIds) {
        const rows = await memoryService.searchMemories(lastUserText.slice(0, 2000), {
          scope: SCOPE.USER,
          userId: uid,
          maxResults: 10,
          hybrid: true
        });
        addTo(relevantMemories, rows);
      }
    }

    if (coreFacts.length === 0 && relevantMemories.length === 0) {
      return { injected: 0 };
    }

    // 3. Token budget: core facts first, then relevant memories by order.
    const lines = [];
    let usedTokens = 0;
    const pushLine = (memory, prefix = '') => {
      const text = String(memory.content || memory.title || '').trim();
      if (!text) return false;
      const line = `- ${prefix}${text}`;
      const cost = tokenCounter.count(line);
      if (usedTokens + cost > tokenBudget) return false;
      usedTokens += cost;
      lines.push(line);
      return true;
    };

    for (const memory of coreFacts) pushLine(memory);

    const relevantLines = [];
    for (const memory of relevantMemories) {
      const text = String(memory.content || memory.title || '').trim();
      if (!text) continue;
      const isEpisodic = memory.type === MEMORY_TYPE.EPISODIC;
      const line = `- ${isEpisodic ? '[past session] ' : ''}${text}`;
      const cost = tokenCounter.count(line);
      if (usedTokens + cost > tokenBudget) break;
      usedTokens += cost;
      relevantLines.push(line);
    }

    if (lines.length === 0 && relevantLines.length === 0) {
      return { injected: 0 };
    }

    const sections = [
      '# Memory (from past conversations via 9router)',
      'Use these remembered facts when relevant. If a past solution applies to the current problem, use it instead of rediscovering it. If the user asks you to remember something, briefly acknowledge that it has been saved. Do not mention this block unless asked.'
    ];
    if (lines.length) {
      sections.push('', '## Known facts about the user', ...lines);
    }
    if (relevantLines.length) {
      sections.push('', '## Possibly relevant memories for this request', ...relevantLines);
    }
    const memoryBlock = sections.join('\n');
    const injectedCount = lines.length + relevantLines.length;
    const MARKER = 'past conversations via 9router';

    // OpenAI / Claude chat format: messages[]
    if (Array.isArray(body.messages)) {
      const already = body.messages.some(
        (m) => m && m.role === 'system' && typeof m.content === 'string' && m.content.includes(MARKER)
      );
      if (!already) {
        const firstNonSystem = body.messages.findIndex((m) => m && m.role !== 'system');
        const insertAt = firstNonSystem === -1 ? body.messages.length : firstNonSystem;
        body.messages.splice(insertAt, 0, { role: 'system', content: memoryBlock });
      }
      return { injected: injectedCount };
    }

    // OpenAI Responses API: input[]
    if (Array.isArray(body.input)) {
      const already = body.input.some(
        (m) => m && m.role === 'system' && typeof m.content === 'string' && m.content.includes(MARKER)
      );
      if (!already) {
        body.input.unshift({ role: 'system', content: memoryBlock });
      }
      return { injected: injectedCount };
    }

    // Gemini format: contents[] + systemInstruction
    if (Array.isArray(body.contents)) {
      const existing = body.systemInstruction?.parts?.[0]?.text || '';
      if (!existing.includes(MARKER)) {
        body.systemInstruction = {
          role: 'system',
          parts: [{ text: existing ? `${existing}\n\n${memoryBlock}` : memoryBlock }]
        };
      }
      return { injected: injectedCount };
    }

    return { injected: 0 };
  } catch {
    return { injected: 0 };
  }
}

/**
 * Rolling episodic session summaries — the "we've been here before" memory.
 * Every `SUMMARY_EVERY_N_OBSERVATIONS` new observations in a session, the
 * session is re-summarized (LLM self-call) and the summary memory is UPDATED
 * in place, so each conversation leaves behind exactly one episodic memory.
 * Designed to be fire-and-forget from the chat pipeline.
 */
const SUMMARY_EVERY_N_OBSERVATIONS = 10;
const sessionSummaryState = new Map(); // sessionId → lastSummarizedCount
const MAX_SUMMARY_STATE = 500;

async function maybeUpdateSessionSummary(sessionId, context = {}) {
  if (!sessionId || sessionId === 'chat-local') return null;

  try {
    await ensureInitialized();

    const observations = await memoryService.adapter.listObservationsBySession(sessionId, { limit: 200 });
    const count = observations?.length || 0;
    const lastCount = sessionSummaryState.get(sessionId) || 0;
    if (count < SUMMARY_EVERY_N_OBSERVATIONS || count - lastCount < SUMMARY_EVERY_N_OBSERVATIONS) {
      return null;
    }

    if (sessionSummaryState.size >= MAX_SUMMARY_STATE && !sessionSummaryState.has(sessionId)) {
      const oldestKey = sessionSummaryState.keys().next().value;
      sessionSummaryState.delete(oldestKey);
    }
    sessionSummaryState.set(sessionId, count);

    const blob = observations
      .map((o) => o.raw_content || '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 15000);
    if (blob.length < 200) return null;

    const summary = await memoryService.summarizeWithRouter(blob, { maxLength: 850, style: 'episodic' });
    if (!summary) return null;

    const userId = context.userId || 'local-user';
    const title = `Session summary: ${sessionId}`;

    // Update in place if this session already has a summary memory.
    const existing = await memoryService.adapter.listMemories({
      type: MEMORY_TYPE.EPISODIC,
      scope: SCOPE.USER,
      userId
    }, { limit: 200 });
    const match = existing.find((memory) => memory.title === title);
    if (match) {
      await memoryService.updateMemory(match.id, { content: summary, importanceScore: 0.75 }, userId);
      return match.id;
    }

    return await memoryService.saveMemory({
      type: MEMORY_TYPE.EPISODIC,
      scope: SCOPE.USER,
      sessionId,
      userId,
      title,
      content: summary,
      importanceScore: 0.75
    });
  } catch {
    return null;
  }
}

module.exports = {
  captureChatMemory,
  injectMemoryContext,
  deriveSessionId,
  getLatestAssistantText,
  getLastUserText,
  maybeUpdateSessionSummary,
  extractRememberedAge,
  extractRememberedGeneric,
  extractRememberedIdentity,
  extractRememberedPossession,
  extractRememberedPin,
  getUserPromptText
};