/**
 * ChatGPT-style automatic memory engine.
 *
 * Instead of relying only on regex triggers ("inget ya..."), this module lets
 * an LLM (via 9Router self-call) decide what is memory-worthy from the latest
 * conversation turns — exactly how ChatGPT's memory works:
 *
 *   1. After a chat request passes through, the latest user + assistant turns
 *      are handed to a small extraction prompt (fire-and-forget, throttled).
 *   2. The LLM returns structured JSON: facts, preferences, solved problems,
 *      project knowledge — each with a save/update/skip decision.
 *   3. Items are deduped against existing memories (hybrid search) and saved.
 *
 * Everything here is fail-open: any error results in "no memory saved",
 * never a broken chat request.
 */

const { memoryService, SCOPE, MEMORY_TYPE } = require('./index');

/** Header used to mark internal self-calls so they are never re-captured. */
const MEMORY_INTERNAL_HEADER = 'x-9router-memory-internal';

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction engine for a coding assistant (like ChatGPT's memory feature).
Given the latest conversation turns, decide what is worth remembering LONG-TERM.

Extract ONLY durable, reusable knowledge:
- "preference": user preferences (language, style, tools, workflow, naming)
- "identity": stable personal facts the user shares (name, role, timezone)
- "problem_solution": a problem that was diagnosed/solved — capture root cause + fix so it is NEVER repeated
- "project": durable facts about the user's project (architecture, conventions, commands, ports, gotchas)
- "decision": explicit decisions made ("we chose X over Y because Z")

DO NOT extract:
- Transient task details ("fix line 42"), greetings, one-off questions
- Anything already covered by KNOWN MEMORIES (unless it changed — then mark it "update")
- Secrets, API keys, passwords, tokens
- Restatements of code visible in the conversation

Respond with ONLY a JSON array (no markdown fence), each item:
{"kind":"preference|identity|problem_solution|project|decision","title":"<short title, max 80 chars>","content":"<1-3 sentence self-contained memory>","importance":0.0-1.0,"update_title":"<title of KNOWN MEMORY to replace, or null>"}

Return [] if nothing is memory-worthy. Most turns have nothing worth remembering — be selective.`;

const KIND_TO_TYPE = {
  preference: MEMORY_TYPE.USER_PREF,
  identity: MEMORY_TYPE.USER_PREF,
  problem_solution: MEMORY_TYPE.PROCEDURAL,
  project: MEMORY_TYPE.PROJECT,
  decision: MEMORY_TYPE.SEMANTIC
};

const DEFAULTS = {
  enabled: true,
  model: process.env.MEMORY_EXTRACT_MODEL || 'auto',
  baseUrl: process.env.ROUTER_BASE_URL || 'http://localhost:20128',
  minIntervalMs: Number(process.env.MEMORY_EXTRACT_MIN_INTERVAL_MS || 45_000),
  minNewChars: 80,           // skip extraction for trivial turns
  maxTurnChars: 6000,        // per-turn clamp fed to the extractor
  maxKnownTitles: 40,        // existing memory titles shown for dedupe
  dedupeSimilarityGate: true // search-based near-duplicate skip
};

/** Per-session throttle state: sessionId → { lastRunAt, lastHash }. */
const sessionState = new Map();
const MAX_SESSION_STATE = 500;

function hashText(text) {
  // djb2 — cheap stable hash for change detection, not security.
  let hash = 5381;
  const str = String(text || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        return part?.text || part?.input_text || part?.output_text || part?.content || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content.text || content.input_text || content.output_text || content.content || '';
}

/**
 * Pull the latest conversation turns out of an incoming request body.
 * Clients (VS Code, Cline, ...) resend the whole history each turn, so the
 * previous assistant answer is available here without touching the stream.
 */
function getConversationTurns(body = {}, options = {}) {
  const maxTurns = options.maxTurns || 6;
  const maxTurnChars = options.maxTurnChars || DEFAULTS.maxTurnChars;

  const source = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];

  const turns = [];
  for (const message of source) {
    const role = message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = extractText(message.content ?? message.text ?? message.input).trim();
    if (!text) continue;
    turns.push({ role, text: text.slice(0, maxTurnChars) });
  }

  return turns.slice(-maxTurns);
}

function formatTurns(turns) {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'USER' : 'ASSISTANT'}: ${turn.text}`)
    .join('\n---\n');
}

function parseExtractionJson(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let text = raw.trim();

  // Tolerate markdown fences despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  // Tolerate prose around the array.
  if (!text.startsWith('[')) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    text = text.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      kind: String(item.kind || '').toLowerCase(),
      title: String(item.title || '').trim().slice(0, 120),
      content: String(item.content || '').trim().slice(0, 1000),
      importance: Math.min(1, Math.max(0, Number(item.importance) || 0.6)),
      updateTitle: item.update_title ? String(item.update_title).trim() : null
    }))
    .filter((item) => KIND_TO_TYPE[item.kind] && item.title && item.content.length >= 8);
}

/**
 * Self-call 9Router to run the extraction prompt.
 * Marked with MEMORY_INTERNAL_HEADER so chatCore never re-captures it.
 */
async function callExtractionModel(turns, knownTitles, config) {
  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [MEMORY_INTERNAL_HEADER]: '1'
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `KNOWN MEMORIES (titles):\n${knownTitles.length ? knownTitles.map((t) => `- ${t}`).join('\n') : '(none)'}\n\nCONVERSATION:\n${formatTurns(turns)}`
        }
      ]
    })
  });

  if (!res.ok) throw new Error(`extraction call failed: HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseExtractionJson(typeof content === 'string' ? content : extractText(content));
}

async function listKnownTitles(userId, limit) {
  const rows = await memoryService.adapter.listMemories(
    { scope: SCOPE.USER, userId },
    { limit }
  );
  return rows.map((row) => String(row.title || '').trim()).filter(Boolean);
}

async function findByTitle(userId, title) {
  if (!title) return null;
  const rows = await memoryService.adapter.listMemories(
    { scope: SCOPE.USER, userId },
    { limit: 200 }
  );
  const wanted = title.toLowerCase();
  return rows.find((row) => String(row.title || '').trim().toLowerCase() === wanted) || null;
}

async function isNearDuplicate(item, userId) {
  try {
    const results = await memoryService.searchMemories(`${item.title} ${item.content}`, {
      scope: SCOPE.USER,
      userId,
      maxResults: 3,
      hybrid: true
    });
    const normalized = item.content.trim().toLowerCase();
    return results.some((memory) => {
      const existing = String(memory.content || '').trim().toLowerCase();
      if (!existing) return false;
      if (existing === normalized) return true;
      // Containment either way ≈ same fact reworded.
      return existing.includes(normalized) || normalized.includes(existing);
    });
  } catch {
    return false;
  }
}

async function persistExtractedItem(item, context) {
  const userId = context.userId || 'local-user';
  const type = KIND_TO_TYPE[item.kind];

  // Explicit update decision from the LLM (like ChatGPT rewriting a bio entry).
  if (item.updateTitle) {
    const existing = await findByTitle(userId, item.updateTitle);
    if (existing) {
      await memoryService.updateMemory(existing.id, {
        title: item.title,
        content: item.content,
        importanceScore: item.importance
      }, userId);
      return { id: existing.id, action: 'updated' };
    }
  }

  if (DEFAULTS.dedupeSimilarityGate && await isNearDuplicate(item, userId)) {
    return { id: null, action: 'skipped_duplicate' };
  }

  const id = await memoryService.saveMemory({
    type,
    scope: SCOPE.USER,
    userId,
    // Note: no sessionId — memories.session_id has a FK to sessions(id), and
    // the session row only exists when the observation path created it.
    workspaceId: context.workspaceId,
    title: item.title,
    content: item.content,
    importanceScore: item.importance
  });
  return { id, action: 'saved' };
}

function pruneSessionState() {
  if (sessionState.size <= MAX_SESSION_STATE) return;
  const oldest = [...sessionState.entries()]
    .sort((a, b) => a[1].lastRunAt - b[1].lastRunAt)
    .slice(0, sessionState.size - MAX_SESSION_STATE);
  for (const [key] of oldest) sessionState.delete(key);
}

/**
 * Decide whether extraction should run for this request (throttle + change detection).
 */
function shouldExtract(sessionId, turns, config) {
  const combined = turns.map((t) => t.text).join('\n');
  if (combined.length < config.minNewChars) return false;

  const state = sessionState.get(sessionId);
  const hash = hashText(combined);
  const now = Date.now();

  if (state) {
    if (state.lastHash === hash) return false;                    // nothing new
    if (now - state.lastRunAt < config.minIntervalMs) return false; // too soon
  }

  sessionState.set(sessionId, { lastRunAt: now, lastHash: hash });
  pruneSessionState();
  return true;
}

/**
 * Main entry: run LLM-based memory extraction for the latest turns.
 * Resolves with a summary; designed to be awaited in tests but
 * fire-and-forget in production (see scheduleAutoMemoryExtraction).
 */
async function runAutoMemoryExtraction(body = {}, context = {}, overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  if (!config.enabled) return { ran: false, reason: 'disabled' };

  const turns = getConversationTurns(body, config);
  if (!turns.length) return { ran: false, reason: 'no_turns' };

  const sessionId = context.sessionId || 'chat-local';
  if (!overrides.force && !shouldExtract(sessionId, turns, config)) {
    return { ran: false, reason: 'throttled' };
  }

  if (!memoryService.initialized) {
    await memoryService.initialize();
  }

  const userId = context.userId || 'local-user';
  const knownTitles = await listKnownTitles(userId, config.maxKnownTitles);
  const items = await callExtractionModel(turns, knownTitles, config);
  if (!items.length) return { ran: true, saved: 0, updated: 0, skipped: 0 };

  let saved = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of items.slice(0, 6)) {
    try {
      const result = await persistExtractedItem(item, { ...context, userId, sessionId });
      if (result.action === 'saved') saved++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { ran: true, saved, updated, skipped };
}

/**
 * Fire-and-forget wrapper used by the chat pipeline: never throws, never blocks.
 */
function scheduleAutoMemoryExtraction(body, context = {}, log = null) {
  try {
    // Clone the pieces we need — the live body gets mutated downstream
    // (memory injection, translation, compression).
    const snapshot = {
      messages: Array.isArray(body?.messages) ? JSON.parse(JSON.stringify(body.messages)) : undefined,
      input: Array.isArray(body?.input) ? JSON.parse(JSON.stringify(body.input)) : undefined
    };

    setImmediate(() => {
      runAutoMemoryExtraction(snapshot, context)
        .then((result) => {
          if (result?.ran && (result.saved || result.updated)) {
            log?.debug?.('MEMORY', `auto-extract: +${result.saved} saved, ~${result.updated} updated`);
          }
        })
        .catch((error) => {
          log?.debug?.('MEMORY', `auto-extract failed: ${error?.message || error}`);
        });
    });
  } catch {
    // Fail-open by design.
  }
}

/** Reset throttle state — for tests. */
function resetAutoMemoryState() {
  sessionState.clear();
}

module.exports = {
  MEMORY_INTERNAL_HEADER,
  getConversationTurns,
  parseExtractionJson,
  runAutoMemoryExtraction,
  scheduleAutoMemoryExtraction,
  resetAutoMemoryState
};
