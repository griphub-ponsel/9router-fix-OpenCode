/**
 * Chat prompt capture helpers for the memory system.
 */

const { memoryService, SCOPE, MEMORY_TYPE } = require('./index');

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
    /\b(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike)\s+(?:gw|gue|saya|aku|ku|my|I)\s+(?:ada|punya|have|ada\s+di)?\s*(\d{1,4})\b/i,
    /\b(?:gw|gue|saya|aku|I)\s+(?:punya|ada|have)\s+(\d{1,4})\s+(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike)\b/i,
    /\b(?:gw|gue|saya|aku|my)\s+(?:hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike)\s+(?:ada|punya|have|is)?\s*(\d{1,4})\b/i,
    /\b(?:inget|ingat|remember)\s*,?\s*(?:hape|hp|phone|mobil|motor|rumah|laptop|car|house|bike)\s+(?:gw|gue|saya|aku|ku|my)?\s*(?:ada|punya|have|is)?\s*(\d{1,4})\b/i
  ];

  const itemMap = {
    hape: 'phones', hp: 'phones', phone: 'phones', phones: 'phones',
    mobil: 'cars', car: 'cars',
    motor: 'motorcycles', bike: 'motorcycles',
    rumah: 'houses', house: 'houses',
    laptop: 'laptops', komputer: 'computers', computer: 'computers'
  };

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const count = Number(match?.[1]);
    if (!Number.isInteger(count) || count < 0) continue;

    const matchedWord = (match[0].match(/\b(hape|hp|phone|phones|mobil|motor|rumah|laptop|komputer|computer|car|house|bike)\b/i) || [])[1]?.toLowerCase();
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

async function captureChatMemory(body = {}, context = {}) {
  const promptText = getUserPromptText(body);
  if (!promptText.trim()) {
    return { observations: 0, memories: 0 };
  }

  await ensureInitialized();

  const sessionId = context.sessionId || body.session_id || body.conversation_id || body.thread_id || 'chat-local';
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

  const memoryIds = [];
  const identity = extractRememberedIdentity(promptText);
  const ageFact = extractRememberedAge(promptText);
  const possessionFact = extractRememberedPossession(promptText);

  if (identity?.name) {
    memoryIds.push(await saveUserNameMemory(identity.name, context));
  }

  if (ageFact?.age) {
    memoryIds.push(await saveUserAgeMemory(ageFact.age, context));
  }

  if (possessionFact?.item) {
    memoryIds.push(await saveUserPossessionMemory(possessionFact.item, possessionFact.count, context));
  }

  return { observations: 1, memories: memoryIds.length, memoryIds };
}

module.exports = {
  captureChatMemory,
  extractRememberedAge,
  extractRememberedIdentity,
  extractRememberedPossession,
  getUserPromptText
};