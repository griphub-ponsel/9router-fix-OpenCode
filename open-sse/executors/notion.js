import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { extractNotionToken } from "../../src/lib/providerNormalization.js";

const NOTION_API_BASE = "https://www.notion.so/api/v3";
const RUN_INFERENCE_URL = `${NOTION_API_BASE}/runInferenceTranscript`;
const LOAD_USER_CONTENT_URL = `${NOTION_API_BASE}/loadUserContent`;
const DEFAULT_CLIENT_VERSION = "23.13.20260605.0836";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MODEL_MAP = {
  "claude-opus-4-8": "ambrosia-tart-high",
  "claude-opus4.8": "ambrosia-tart-high",
  "claude-opus-4-7": "apricot-sorbet-high",
  "claude-opus4.7": "apricot-sorbet-high",
  "claude-opus-4-6": "avocado-froyo-medium",
  "claude-opus4.6": "avocado-froyo-medium",
  "claude-sonnet-4-6": "almond-croissant-low",
  "claude-sonnet4.6": "almond-croissant-low",
  "gemini-2.5-flash": "vertex-gemini-2.5-flash",
  "gemini-2.5flash": "vertex-gemini-2.5-flash",
  "gemini-3.1-pro": "galette-medium-thinking",
  "gemini-3.1pro": "galette-medium-thinking",
  "gpt-5.2": "oatmeal-cookie",
  "gpt-5.4": "oval-kumquat-medium",
  "gpt-5.5": "opal-quince-medium",
  "kimi-2.6": "fireworks-kimi-k2.6",
};

const MARKDOWN_CHAT_MODELS = new Set(["vertex-gemini-2.5-flash"]);
const SEG_CONTENT = "content";
const SEG_THINKING = "thinking";
const SEG_TOOL = "tool";
const SEG_META = "meta";
const FINAL_STEP_PRIORITIES = {
  "markdown-chat": 400,
  text: 350,
  title: 340,
  "agent-inference": 300,
};
const THINKING_TYPES = ["agent-inference", "thinking", "reasoning", "inference"];
const TOOL_TYPES = ["tool", "search", "citation", "source", "web", "retrieval"];
const META_TYPES = ["config", "context", "system", "user", "human", "title"];

function createErrorResponse(message, status = 400, code = "notion_error") {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeModel(model) {
  return MODEL_MAP[model] || MODEL_MAP[model?.replace?.(/-/g, "")] || model || MODEL_MAP["claude-sonnet-4-6"];
}

function getThreadType(notionModel) {
  return MARKDOWN_CHAT_MODELS.has(notionModel) ? "markdown-chat" : "workflow";
}

function getTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return part.text || "";
    if (part?.type === "image_url") return "[image omitted]";
    if (part?.type === "tool_result") return typeof part.content === "string" ? part.content : JSON.stringify(part.content || "");
    return part?.text || part?.content || "";
  }).filter(Boolean).join("\n");
}

function buildTranscript(messages = [], model, account, tools = []) {
  const notionModel = normalizeModel(model);
  const threadType = getThreadType(notionModel);
  const now = new Date().toISOString();
  const systemInstructions = [];
  const transcript = [
    {
      id: crypto.randomUUID(),
      type: "config",
      value: {
        type: threadType,
        model: notionModel,
        modelFromUser: true,
        useWebSearch: true,
      },
    },
    {
      id: crypto.randomUUID(),
      type: "context",
      value: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        currentDatetime: now,
        userId: account.userId,
        spaceId: account.spaceId,
      },
    },
  ];

  // If tools are provided, inject them as system instructions so the model knows what's available.
  // This is a soft approach — the model will see the tools and can request to call them.
  if (Array.isArray(tools) && tools.length > 0) {
    const toolDescriptions = tools.map((t) => {
      const fn = t.function || t;
      const name = fn.name || t.name || "unknown";
      const desc = fn.description || "";
      const params = fn.parameters || fn.input_schema || {};
      const paramStr = Object.keys(params).length > 0 ? `\nParameters: ${JSON.stringify(params)}` : "";
      return `- ${name}: ${desc}${paramStr}`;
    }).join("\n");

    const toolInstructions = [
      "You have access to the following tools. When you need to use a tool, respond with a JSON block in the following format:",
      "```tool_call",
      '{"name": "<tool_name>", "arguments": {<arguments>}}',
      "```",
      "You may call multiple tools by emitting multiple tool_call blocks. Do NOT wrap tool calls in prose — emit them directly.",
      "",
      "Available tools:",
      toolDescriptions,
    ].join("\n");
    systemInstructions.push(toolInstructions);
  }

  for (const message of messages) {
    const role = message?.role;
    const text = getTextContent(message?.content);
    if (!text) continue;
    if (role === "system") {
      systemInstructions.push(text);
      continue;
    }
    if (role === "assistant") {
      transcript.push({
        id: crypto.randomUUID(),
        type: "agent-inference",
        value: [{ type: "text", content: text }],
      });
      continue;
    }
    if (role === "user" || role === "tool") {
      let formattedText = text;
      // Format tool results clearly so the model can understand the context
      if (role === "tool") {
        const toolCallId = message.tool_call_id || message.toolCallId || "";
        const toolName = message.name || "";
        const header = toolName ? `[Tool Result: ${toolName}]` : "[Tool Result]";
        const idLine = toolCallId ? ` (id: ${toolCallId})` : "";
        formattedText = `${header}${idLine}\n${text}`;
      }
      const mergedText = systemInstructions.length > 0
        ? `[System Instructions: ${systemInstructions.join("\n\n")}]\n\n${formattedText}`
        : formattedText;
      systemInstructions.length = 0;
      transcript.push({
        id: crypto.randomUUID(),
        type: "user",
        value: [[mergedText]],
        userId: account.userId,
        createdAt: now,
      });
    }
  }

  if (systemInstructions.length > 0) {
    transcript.push({
      id: crypto.randomUUID(),
      type: "user",
      value: [[`[System Instructions: ${systemInstructions.join("\n\n")}]`]],
      userId: account.userId,
      createdAt: now,
    });
  }

  return { transcript, threadType };
}

function parseCookieString(cookieString) {
  const out = {};
  for (const part of String(cookieString || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function buildCookieHeader(credentials, account) {
  const psd = credentials?.providerSpecificData || {};
  const fullCookie = psd.fullCookie || psd.cookie || "";
  const token = extractNotionToken(credentials?.apiKey || credentials?.accessToken || "", fullCookie);
  const cookieUserId = parseCookieString(fullCookie).notion_user_id;
  const cookies = {
    ...parseCookieString(fullCookie),
    token_v2: token,
    notion_user_id: account.userId || cookieUserId,
  };
  return Object.entries(cookies)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function getAccount(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const fullCookie = psd.fullCookie || psd.cookie || "";
  const token = extractNotionToken(credentials?.apiKey || credentials?.accessToken || "", fullCookie);
  if (!fullCookie) {
    throw new Error("Notion AI requires the full Cookie header from notion.so. token_v2 alone can list models but Notion blocks inference.");
  }
  const spaceId = psd.spaceId || psd.space_id || "";
  const userId = psd.userId || psd.user_id || parseCookieString(fullCookie).notion_user_id;
  if (!token || !userId) {
    throw new Error("Notion AI requires token_v2 and notion_user_id. Paste the full Cookie header from notion.so, not only token_v2.");
  }
  return { token, spaceId, userId };
}

function isUuid(value) {
  return UUID_RE.test(String(value || ""));
}

function extractSpaceIdFromUserContent(payload) {
  const spaces = payload?.recordMap?.space;
  if (!spaces || typeof spaces !== "object") return "";
  return Object.keys(spaces).find(isUuid) || "";
}

async function resolveAccountSpace(credentials, account, signal, proxyOptions) {
  if (isUuid(account.spaceId)) return account;
  const psd = credentials?.providerSpecificData || {};
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": psd.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "x-notion-active-user-header": account.userId,
    "notion-client-version": psd.clientVersion || DEFAULT_CLIENT_VERSION,
    "origin": "https://www.notion.so",
    "referer": "https://www.notion.so/",
    "cookie": buildCookieHeader(credentials, account),
  };
  const response = await proxyAwareFetch(LOAD_USER_CONTENT_URL, {
    method: "POST",
    headers,
    body: "{}",
    signal,
  }, proxyOptions);
  if (!response.ok) {
    throw new Error(`Notion space lookup failed with HTTP ${response.status}. Re-check the saved spaceId.`);
  }
  const payload = await response.json().catch(() => null);
  const resolvedSpaceId = extractSpaceIdFromUserContent(payload);
  if (!resolvedSpaceId) {
    throw new Error("Notion space lookup did not return a valid spaceId. Re-add the Notion AI session with the workspace spaceId UUID.");
  }
  return { ...account, spaceId: resolvedSpaceId };
}

function buildHeaders(credentials, account) {
  const psd = credentials?.providerSpecificData || {};
  return {
    "Content-Type": "application/json",
    "Accept": "application/x-ndjson",
    "User-Agent": psd.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "x-notion-space-id": account.spaceId,
    "x-notion-active-user-header": account.userId,
    "notion-audit-log-platform": "web",
    "notion-client-version": psd.clientVersion || DEFAULT_CLIENT_VERSION,
    "origin": "https://www.notion.so",
    "referer": "https://www.notion.so/ai",
    "cookie": buildCookieHeader(credentials, account),
  };
}

function buildPayload(body, model, account) {
  const { transcript, threadType } = buildTranscript(body?.messages || [], model, account, body?.tools || []);
  const notionModel = normalizeModel(model);
  const threadId = crypto.randomUUID();
  const isMarkdownChat = threadType === "markdown-chat";
  return {
    traceId: crypto.randomUUID(),
    spaceId: account.spaceId,
    threadId,
    threadType,
    createThread: !isMarkdownChat,
    generateTitle: true,
    saveAllThreadOperations: true,
    setUnreadState: true,
    isPartialTranscript: isMarkdownChat,
    asPatchResponse: true,
    patchResponseVersion: 2,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
    threadParentPointer: { table: "space", id: account.spaceId, spaceId: account.spaceId },
    transcript,
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      model: notionModel,
      emitInferences: false,
    },
  };
}

function stripNotionMarkup(text) {
  return String(text || "")
    .replace(/<lang\b[^>]*>/gi, "")
    .replace(/<\/lang>/gi, "")
    .replace(/\bprimary="[a-zA-Z-]{1,15}"\s*/g, "");
}

function normalizePath(patch) {
  const path = patch?.p ?? patch?.path ?? patch?.pointer ?? "";
  if (Array.isArray(path)) return `/${path.map((part) => String(part).replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
  const text = String(path || "");
  return text.startsWith("/") ? text : `/${text}`;
}

function extractSegmentIndex(path) {
  const match = String(path || "").match(/(?:^|\/)s\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

function extractValueIndex(path) {
  const match = String(path || "").match(/(?:^|\/)s\/(\d+)\/value\/(\d+)(?:\/|$)/);
  return match ? Number(match[2]) : null;
}

function extractValueAddIndex(path) {
  const match = String(path || "").match(/(?:^|\/)s\/(\d+)\/value\/(\d+|-)(?:\/|$)/);
  if (!match) return null;
  return match[2] === "-" ? -1 : Number(match[2]);
}

function extractValueText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractValueText).join("");
  if (!value || typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content;
  if (value.value !== undefined) return extractValueText(value.value);
  if (typeof value.text === "string") return value.text;
  return "";
}

function extractTextFromPatch(patch) {
  const op = patch?.o;
  const value = patch?.v;
  if (op === "x" && typeof value === "string") return value;
  if (op === "p" && typeof value === "string") {
    const path = normalizePath(patch);
    return path.includes("/content") || path.includes("/text") ? value : "";
  }
  if (op === "a" && value && typeof value === "object") return extractValueText(value.value ?? value.content ?? value);
  return "";
}

/**
 * Extract tool_call blocks from text content that the model may emit
 * when it was instructed to use ```tool_call``` code blocks.
 * Returns { text, toolCalls } where text has the tool_call blocks removed.
 */
function extractInlineToolCalls(text) {
  if (!text || typeof text !== "string") return { text: text || "", toolCalls: [] };

  const toolCalls = [];
  // Match ```tool_call\n{...}\n``` blocks (single-line or multi-line JSON)
  const blockRegex = /```tool_call\s*\n([\s\S]*?)```/g;
  let match;
  let cleaned = text;

  while ((match = blockRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    try {
      // Could be a single JSON object or multiple concatenated objects
      const parsed = JSON.parse(jsonStr);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        const name = call.name || call.tool_name || call.function?.name || "";
        if (!name) continue;
        const id = call.id || call.tool_call_id || call.tool_use_id || `call_${crypto.randomUUID().slice(0, 12)}`;
        const input = call.arguments || call.input || call.function?.arguments || {};
        toolCalls.push({
          id,
          name,
          arguments: typeof input === "string" ? input : JSON.stringify(input || {}),
        });
      }
      // Remove the parsed block from the text
      cleaned = cleaned.replace(match[0], "").trim();
    } catch {
      // Not valid JSON — treat as regular text, skip
    }
  }

  // Also try to match plain JSON tool_call blocks without code fences
  // (e.g. {"name": "search", "arguments": {...}} on its own line)
  if (toolCalls.length === 0) {
    const jsonLineRegex = /\{[\s]*"name"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}[\s]*\}/g;
    let jsonMatch;
    while ((jsonMatch = jsonLineRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const name = parsed.name || "";
        if (!name) continue;
        const id = parsed.id || `call_${crypto.randomUUID().slice(0, 12)}`;
        const input = parsed.arguments || parsed.input || {};
        toolCalls.push({
          id,
          name,
          arguments: typeof input === "string" ? input : JSON.stringify(input || {}),
        });
        cleaned = cleaned.replace(jsonMatch[0], "").trim();
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  return { text: cleaned, toolCalls };
}

/**
 * Extract a tool_call event from a SEG_TOOL patch.
 * Returns null if the patch is a tool result, citation, or metadata (not a tool invocation).
 */
function extractToolCallFromPatch(patch) {
  const value = patch?.v;
  if (!value || typeof value !== "object") return null;

  const patchType = extractPatchType(patch);

  // Skip non-invocation tool types (citations, sources, retrievals are metadata)
  if (["citation", "source", "retrieval"].some((t) => patchType.includes(t))) return null;

  // Navigate to the actual tool data — Notion may nest it under .value
  const toolData = value.value && typeof value.value === "object" && !Array.isArray(value.value)
    ? value.value
    : value;

  // Also handle array-style value (pick first tool_use entry)
  const toolArray = Array.isArray(value.value) ? value.value : (Array.isArray(value) ? value : null);
  if (toolArray) {
    for (const entry of toolArray) {
      if (entry && typeof entry === "object" && (entry.type === "tool_use" || entry.type === "tool" || entry.name)) {
        const name = entry.name || entry.tool_name || "";
        if (!name) continue;
        const id = entry.id || entry.tool_call_id || entry.tool_use_id || `call_${crypto.randomUUID().slice(0, 12)}`;
        const input = entry.input || entry.arguments || {};
        return { id, name, arguments: typeof input === "string" ? input : JSON.stringify(input || {}) };
      }
    }
    return null;
  }

  // Single object: extract name, id, input
  const name = toolData.name || toolData.tool_name || toolData.toolName || "";
  if (!name) return null;

  // If the patch has output/content but no input, it's a tool result — skip
  if ((toolData.output || toolData.result || toolData.content) && !toolData.input && !toolData.arguments) return null;

  const id = toolData.id || toolData.tool_call_id || toolData.toolCallId || toolData.tool_use_id || `call_${crypto.randomUUID().slice(0, 12)}`;
  const input = toolData.input || toolData.arguments || toolData.tool_input || toolData.toolInput || {};

  return {
    id,
    name,
    arguments: typeof input === "string" ? input : JSON.stringify(input || {}),
  };
}

function extractFinalContentFromRecordMap(data) {
  const threadMessages = data?.recordMap?.thread_message;
  if (!threadMessages || typeof threadMessages !== "object") return "";
  const candidates = [];
  for (const item of Object.values(threadMessages)) {
    const outerValue = item?.value;
    const innerValue = outerValue?.value;
    const step = innerValue?.step;
    if (!step || typeof step !== "object") continue;
    const type = String(step.type || "").toLowerCase();
    if (META_TYPES.some((item) => type.includes(item))) continue;
    const text = stripNotionMarkup(extractValueText(step.value)).trim();
    if (!text) continue;
    const priority = FINAL_STEP_PRIORITIES[type] || 100;
    candidates.push({ text, priority, edited: Number(outerValue?.last_edited_time || outerValue?.created_time || 0) });
  }
  const hasFinalStep = candidates.some((candidate) => candidate.priority >= FINAL_STEP_PRIORITIES.text);
  const filteredCandidates = hasFinalStep
    ? candidates.filter((candidate) => candidate.priority >= FINAL_STEP_PRIORITIES.text)
    : candidates;
  filteredCandidates.sort((a, b) => (b.priority - a.priority) || (b.edited - a.edited) || (b.text.length - a.text.length));
  return filteredCandidates[0]?.text || "";
}

function extractNotionError(data) {
  if (data?.type === "error") return data;
  const segments = data?.data?.s;
  if (!Array.isArray(segments)) return null;
  return segments.find((item) => item?.type === "error") || null;
}

function classifyType(type) {
  const effectiveType = String(type || "").toLowerCase();
  if (!effectiveType || effectiveType === "text" || effectiveType === "markdown-chat") return SEG_CONTENT;
  if (META_TYPES.some((item) => effectiveType.includes(item))) return SEG_META;
  if (THINKING_TYPES.some((item) => effectiveType.includes(item))) return SEG_THINKING;
  if (TOOL_TYPES.some((item) => effectiveType.includes(item))) return SEG_TOOL;
  return SEG_CONTENT;
}

function extractPatchType(patch) {
  const value = patch?.v;
  return String(patch?.type || (value && typeof value === "object" ? value.type : "") || "").toLowerCase();
}

class NotionPatchParser {
  constructor() {
    this.segmentTypes = new Map();
    this.valueTypes = new Map();
    this.nextValueIds = new Map();
    this.pendingSegments = [];
    this.toolCalls = [];
    this.seenToolIds = new Set();
  }

  key(segmentIndex, valueIndex) {
    return `${segmentIndex}:${valueIndex}`;
  }

  bindPendingSegment(segmentIndex, path) {
    if (this.pendingSegments.length === 0) return;
    const valueIndex = extractValueIndex(path);
    let chosenIndex = 0;
    if (valueIndex !== null) {
      const thinkingIndex = this.pendingSegments.findIndex((segment) => segment.valueTypes.get(valueIndex) === SEG_THINKING);
      if (thinkingIndex >= 0) chosenIndex = thinkingIndex;
    }
    const [chosen] = this.pendingSegments.splice(chosenIndex, 1);
    this.segmentTypes.set(segmentIndex, chosen.segmentClass);
    for (const [localValueIndex, valueClass] of chosen.valueTypes) {
      this.valueTypes.set(this.key(segmentIndex, localValueIndex), valueClass);
    }
    this.nextValueIds.set(segmentIndex, chosen.nextValueId);
  }

  registerTopLevelSegment(patchType, patchValue) {
    const segmentClass = classifyType(patchType);
    const valueTypes = new Map();
    let nextValueId = 0;
    const valueArray = patchValue && typeof patchValue === "object" ? patchValue.value : null;
    if (Array.isArray(valueArray)) {
      valueArray.forEach((item, index) => {
        const itemType = item && typeof item === "object" ? item.type : "";
        valueTypes.set(index, classifyType(itemType));
        nextValueId = index + 1;
      });
    }
    if (!valueTypes.has(0)) {
      valueTypes.set(0, segmentClass);
      nextValueId = Math.max(nextValueId, 1);
    }
    this.pendingSegments.push({ segmentClass, valueTypes, nextValueId });
    return valueTypes.get(0) || segmentClass;
  }

  getPatchRole(patch) {
    const op = String(patch?.o || "");
    const value = patch?.v;
    const path = normalizePath(patch);
    let segmentIndex = extractSegmentIndex(path);
    const patchType = extractPatchType(patch);
    const pathStripped = path.replace(/^\/+|\/+$/g, "");
    let patchRole = null;

    if (op === "a" && pathStripped === "s/-") {
      patchRole = this.registerTopLevelSegment(patchType, value);
      segmentIndex = null;
    } else if (op === "a" && segmentIndex !== null) {
      if (!this.segmentTypes.has(segmentIndex) && this.pendingSegments.length > 0) this.bindPendingSegment(segmentIndex, path);
      if (!this.segmentTypes.has(segmentIndex)) this.segmentTypes.set(segmentIndex, classifyType(patchType));

      const valueAddIndex = extractValueAddIndex(path);
      if (valueAddIndex !== null) {
        const valueIndex = valueAddIndex < 0 ? (this.nextValueIds.get(segmentIndex) || 0) : valueAddIndex;
        this.nextValueIds.set(segmentIndex, Math.max(this.nextValueIds.get(segmentIndex) || 0, valueIndex + 1));
        const valueClass = classifyType(patchType);
        this.valueTypes.set(this.key(segmentIndex, valueIndex), valueClass);
        patchRole = valueClass;
      }
    }

    if (segmentIndex !== null && !this.segmentTypes.has(segmentIndex) && this.pendingSegments.length > 0) {
      this.bindPendingSegment(segmentIndex, path);
    }

    if (patchRole) return patchRole;
    const valueIndex = extractValueIndex(path);
    if (segmentIndex !== null && valueIndex !== null && this.valueTypes.has(this.key(segmentIndex, valueIndex))) {
      return this.valueTypes.get(this.key(segmentIndex, valueIndex));
    }
    if (segmentIndex !== null && this.segmentTypes.has(segmentIndex)) return this.segmentTypes.get(segmentIndex);
    return classifyType(patchType);
  }

  parseData(data) {
    const error = extractNotionError(data);
    if (error) {
      const message = String(error.message || error.error || "Notion AI returned an upstream error");
      return [{ type: "error", message, code: error.subType || error.code || "notion_upstream_error" }];
    }
    const type = String(data?.type || "").toLowerCase();
    if (type === "record-map") {
      const text = extractFinalContentFromRecordMap(data);
      return text ? [{ type: "final_content", text }] : [];
    }
    if (type === "markdown-chat") {
      const text = stripNotionMarkup(extractValueText(data.value)).trim();
      return text ? [{ type: "final_content", text }] : [];
    }
    if (type !== "patch" || !Array.isArray(data.v)) return [];

    const events = [];
    for (const patch of data.v) {
      if (!patch || typeof patch !== "object") continue;
      const role = this.getPatchRole(patch);
      if (role === SEG_META) continue;

      // Extract tool calls from SEG_TOOL patches
      if (role === SEG_TOOL) {
        const tc = extractToolCallFromPatch(patch);
        if (tc && !this.seenToolIds.has(tc.id)) {
          this.seenToolIds.add(tc.id);
          this.toolCalls.push(tc);
        }
        continue;
      }

      const text = stripNotionMarkup(extractTextFromPatch(patch));
      if (!text) continue;
      events.push({ type: role === SEG_THINKING ? "thinking" : "content", text });
    }
    return events;
  }
}

function parseNdjsonEvent(line, parser = new NotionPatchParser()) {
  let data;
  try { data = JSON.parse(line); } catch { return []; }
  const items = Array.isArray(data) ? data : [data];
  const events = [];
  for (const item of items) events.push(...parser.parseData(item));
  return events;
}

function extractCompleteJsonValues(buffer) {
  const values = [];
  let index = 0;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let rootArray = false;

  while (index < buffer.length) {
    const char = buffer[index];
    if (start < 0) {
      if (/\s|,/.test(char)) {
        index += 1;
        continue;
      }
      if (char === "[") {
        rootArray = true;
        index += 1;
        continue;
      }
      if (rootArray && char === "]") {
        index += 1;
        rootArray = false;
        continue;
      }
      if (char !== "{" && char !== "[") break;
      start = index;
      depth = 0;
      inString = false;
      escaped = false;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        values.push(buffer.slice(start, index + 1));
        start = -1;
      }
    }
    index += 1;
  }

  return { values, rest: start >= 0 ? buffer.slice(start) : buffer.slice(index) };
}

function createOpenAIChunk({ id, model, content = "", role = "", finishReason = null, toolCalls = null }) {
  const delta = {};
  if (role) delta.role = role;
  if (content) delta.content = content;
  if (toolCalls) delta.tool_calls = toolCalls;
  const choice = { index: 0, delta, finish_reason: finishReason };
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
  })}\n\n`;
}

/**
 * Emit accumulated tool_calls as OpenAI SSE chunks.
 * Each tool_call emits a start chunk (name+id) followed by an arguments chunk.
 */
function emitToolCallChunks(encoder, controller, responseId, model, toolCalls) {
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    // Start chunk: tool call declaration
    controller.enqueue(encoder.encode(createOpenAIChunk({
      id: responseId,
      model,
      role: i === 0 ? "assistant" : "",
      toolCalls: [{
        index: i,
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: "" },
      }],
    })));
    // Arguments chunk
    if (tc.arguments && tc.arguments !== "{}") {
      controller.enqueue(encoder.encode(createOpenAIChunk({
        id: responseId,
        model,
        toolCalls: [{
          index: i,
          function: { arguments: tc.arguments },
        }],
      })));
    }
  }
}

function buildStreamingResponse(upstreamBody, model, signal) {
  const responseId = `chatcmpl-notion-${crypto.randomUUID().slice(0, 12)}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let emittedContent = "";
  let finalContent = "";
  const parser = new NotionPatchParser();

  const emitParsedValues = (controller, values) => {
    for (const valueText of values) {
      for (const item of parseNdjsonEvent(valueText, parser)) {
        if (item.type === "final_content") {
          finalContent = item.text;
          continue;
        }
        if (item.type === "error") {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: item.message, type: "upstream_error", code: item.code } })}\n\n`));
          continue;
        }
        if (item.type !== "content") continue;
        emittedContent += item.text;
        controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, role: emittedRole ? "" : "assistant", content: item.text })));
        emittedRole = true;
      }
    }
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      try {
        while (true) {
          if (signal?.aborted) throw signal.reason || new Error("Request aborted");
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = extractCompleteJsonValues(buffer);
          buffer = parsed.rest;
          emitParsedValues(controller, parsed.values);
        }
        buffer += decoder.decode();
        const parsed = extractCompleteJsonValues(buffer);
        buffer = parsed.rest;
        emitParsedValues(controller, parsed.values);
        const tail = buffer.trim();
        if (tail && tail !== "[" && tail !== "]") {
          emitParsedValues(controller, [tail]);
        }
        if (finalContent && !emittedContent) {
          controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, role: "assistant", content: finalContent })));
          emittedContent = finalContent;
          emittedRole = true;
        } else if (finalContent && finalContent.startsWith(emittedContent)) {
          const suffix = finalContent.slice(emittedContent.length);
          if (suffix) controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, role: emittedRole ? "" : "assistant", content: suffix })));
        }
        // Emit tool calls if Notion returned any (from native patches or inline text blocks)
        const allToolCalls = [...(parser.toolCalls || [])];
        // Also check if the model emitted tool_call blocks in the text content
        if (allToolCalls.length === 0) {
          const fullText = finalContent || emittedContent;
          const { toolCalls: inlineCalls } = extractInlineToolCalls(fullText);
          if (inlineCalls.length > 0) allToolCalls.push(...inlineCalls);
        }
        if (allToolCalls.length > 0) {
          emitToolCallChunks(encoder, controller, responseId, model, allToolCalls);
          controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, finishReason: "tool_calls" })));
        } else {
          controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, finishReason: "stop" })));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        try { reader.releaseLock(); } catch { }
      }
    },
  });
}

async function buildJsonResponse(upstreamBody, model, signal) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finalContent = "";
  let upstreamError = null;
  const parser = new NotionPatchParser();
  const consumeParsedValues = (values) => {
    for (const valueText of values) {
      for (const item of parseNdjsonEvent(valueText, parser)) {
        if (item.type === "error") upstreamError = item;
        if (item.type === "final_content") finalContent = item.text;
        if (item.type === "content") content += item.text;
      }
    }
  };
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("Request aborted");
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = extractCompleteJsonValues(buffer);
      buffer = parsed.rest;
      consumeParsedValues(parsed.values);
    }
    buffer += decoder.decode();
    const parsed = extractCompleteJsonValues(buffer);
    buffer = parsed.rest;
    consumeParsedValues(parsed.values);
    const tail = buffer.trim();
    if (tail && tail !== "[" && tail !== "]") {
      consumeParsedValues([tail]);
    }
  } finally {
    try { reader.releaseLock(); } catch { }
  }

  if (upstreamError) {
    return createErrorResponse(upstreamError.message, upstreamError.code === "trust-rule-denied" ? 403 : 502, upstreamError.code);
  }

  const finalText = finalContent || content;
  const promptTokens = 0;
  const completionTokens = Math.ceil(finalText.length / 4);

  // Collect tool calls from both native Notion patches and inline text blocks
  let toolCalls = [...(parser.toolCalls || [])];
  let displayText = finalText;
  if (toolCalls.length === 0) {
    const { text: cleanedText, toolCalls: inlineCalls } = extractInlineToolCalls(finalText);
    if (inlineCalls.length > 0) {
      toolCalls = inlineCalls;
      displayText = cleanedText;
    }
  }

  const message = { role: "assistant", content: displayText || "" };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return new Response(JSON.stringify({
    id: `chatcmpl-notion-${crypto.randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class NotionExecutor extends BaseExecutor {
  constructor() {
    super("notion", PROVIDERS.notion);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    let account;
    try {
      account = getAccount(credentials);
      account = await resolveAccountSpace(credentials, account, signal, proxyOptions);
    } catch (error) {
      return { response: createErrorResponse(error.message, 401, "missing_notion_session"), url: RUN_INFERENCE_URL, headers: {}, transformedBody: body };
    }

    const headers = buildHeaders(credentials, account);
    const payload = buildPayload(body, model, account);
    log?.info?.("NOTION", `Dispatching ${model} via Notion AI (${normalizeModel(model)})`);

    let response;
    try {
      response = await proxyAwareFetch(RUN_INFERENCE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      }, proxyOptions);
    } catch (error) {
      return { response: createErrorResponse(`Notion AI connection failed: ${error.message || String(error)}`, 502, "notion_fetch_failed"), url: RUN_INFERENCE_URL, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const message = response.status === 401 || response.status === 403
        ? "Notion AI session rejected. Re-check token_v2/full cookie, spaceId, userId, and Notion AI access."
        : `Notion AI returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      return { response: createErrorResponse(message, response.status, `notion_http_${response.status}`), url: RUN_INFERENCE_URL, headers, transformedBody: payload };
    }

    if (!response.body) {
      return { response: createErrorResponse("Notion AI returned an empty response body", 502, "notion_empty_body"), url: RUN_INFERENCE_URL, headers, transformedBody: payload };
    }

    const finalResponse = stream
      ? new Response(buildStreamingResponse(response.body, model, signal), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } })
      : await buildJsonResponse(response.body, model, signal);

    return { response: finalResponse, url: RUN_INFERENCE_URL, headers, transformedBody: payload };
  }
}

export default NotionExecutor;
