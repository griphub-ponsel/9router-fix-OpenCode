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

function buildTranscript(messages = [], model, account) {
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
      const mergedText = systemInstructions.length > 0
        ? `[System Instructions: ${systemInstructions.join("\n\n")}]\n\n${text}`
        : text;
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
  const { transcript, threadType } = buildTranscript(body?.messages || [], model, account);
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
      if (role === SEG_META || role === SEG_TOOL) continue;
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

function createOpenAIChunk({ id, model, content = "", role = "", finishReason = null }) {
  const delta = {};
  if (role) delta.role = role;
  if (content) delta.content = content;
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
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
        controller.enqueue(encoder.encode(createOpenAIChunk({ id: responseId, model, finishReason: "stop" })));
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
  return new Response(JSON.stringify({
    id: `chatcmpl-notion-${crypto.randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: finalText }, finish_reason: "stop" }],
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
