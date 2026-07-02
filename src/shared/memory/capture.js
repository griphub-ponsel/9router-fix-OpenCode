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

  return { observations: 1, memories: memoryIds.length, memoryIds };
}

/**
 * Retrieve the user's stored preference memories and inject them into the
 * outgoing chat request as a system message, so the downstream model can
 * actually USE what 9router has remembered (name, age, possessions, pin, ...).
 *
 * Fail-open: any error returns { injected: 0 } and leaves the body untouched.
 */
async function injectMemoryContext(body = {}, context = {}) {
  try {
    await ensureInitialized();

    const userId = context.userId || 'local-user';
    const promptText = getUserPromptText(body);
    const seen = new Set();
    const memories = [];
    const addMemories = (rows = []) => {
      for (const memory of rows || []) {
        const key = String(memory.id || memory.title || memory.content || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        memories.push(memory);
      }
    };
    const userIds = userId === 'local-user' ? ['local-user'] : [userId, 'local-user'];
    for (const uid of userIds) {
      const rows = await memoryService.adapter.listMemories({
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: uid
      }, { limit: 50 });
      addMemories(rows);
    }

    if (promptText.trim()) {
      for (const uid of userIds) {
        const rows = await memoryService.searchMemories(promptText, {
          scope: SCOPE.USER,
          userId: uid,
          maxResults: 12,
          hybrid: true
        });
        addMemories(rows);
      }
    }

    if (!memories || memories.length === 0) {
      return { injected: 0 };
    }

    const lines = memories
      .map((memory) => String(memory.content || memory.title || '').trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return { injected: 0 };
    }

    const memoryBlock = [
      '# Known facts about the user (from 9router memory)',
      'Use these remembered facts when relevant. If the user asks you to remember something, briefly acknowledge that it has been saved in 9router memory. Do not mention this block unless asked.',
      '',
      ...lines.map((line) => `- ${line}`)
    ].join('\n');

    // OpenAI / Claude chat format: messages[]
    if (Array.isArray(body.messages)) {
      const already = body.messages.some(
        (m) => m && m.role === 'system' && typeof m.content === 'string' && m.content.includes('9router memory')
      );
      if (!already) {
        const firstNonSystem = body.messages.findIndex((m) => m && m.role !== 'system');
        const insertAt = firstNonSystem === -1 ? body.messages.length : firstNonSystem;
        body.messages.splice(insertAt, 0, { role: 'system', content: memoryBlock });
      }
      return { injected: lines.length };
    }

    // OpenAI Responses API: input[]
    if (Array.isArray(body.input)) {
      const already = body.input.some(
        (m) => m && m.role === 'system' && typeof m.content === 'string' && m.content.includes('9router memory')
      );
      if (!already) {
        body.input.unshift({ role: 'system', content: memoryBlock });
      }
      return { injected: lines.length };
    }

    // Gemini format: contents[] + systemInstruction
    if (Array.isArray(body.contents)) {
      const existing = body.systemInstruction?.parts?.[0]?.text || '';
      if (!existing.includes('9router memory')) {
        body.systemInstruction = {
          role: 'system',
          parts: [{ text: existing ? `${existing}\n\n${memoryBlock}` : memoryBlock }]
        };
      }
      return { injected: lines.length };
    }

    return { injected: 0 };
  } catch {
    return { injected: 0 };
  }
}

module.exports = {
  captureChatMemory,
  injectMemoryContext,
  extractRememberedAge,
  extractRememberedGeneric,
  extractRememberedIdentity,
  extractRememberedPossession,
  extractRememberedPin,
  getUserPromptText
};