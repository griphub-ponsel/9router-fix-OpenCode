import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const MERLIN_ENDPOINT = PROVIDERS["merlin"].baseUrl;
const MERLIN_ORIGIN = "https://www.getmerlin.in";
const MERLIN_REFERER = "https://www.getmerlin.in/chat";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Merlin web endpoint hard-limits a single message payload. Keep well under it.
const MAX_MERLIN_CONTENT = 30000;
const MAX_TOOLS_SPEC = 9000;
const MAX_LAST_TURN = 9000;
const MAX_CONTEXT = 28000;

// Map common OpenAI/Anthropic-style ids → Merlin model ids (best-effort convenience).
const MODEL_ALIASES = {
  "claude-opus-4-8": "claude-4.8-opus",
  "claude-opus-4-6": "claude-4.6-opus",
  "claude-sonnet-4-6": "claude-4.6-sonnet",
  "claude-haiku-4-5": "claude-4.5-haiku",
  "gpt-5.4": "gpt-5.4",
  "gpt-5.5": "gpt-5.5",
  "gemini-3-pro": "gemini-3.1-pro",
  "gemini-2.5-flash": "gemini-2.5-flash-lite",
};

const CITATION_RE = /(\[|【)\s*(citation|引用):\d+(-\d+)?\s*(\]|】)/g;
const JSON_BLOCK_RE = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i;

function removeCitations(text) {
  return text.replace(CITATION_RE, "");
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n... (truncated)`;
}

function resolveModel(model) {
  return MODEL_ALIASES[model] || model;
}

// ---------------------------------------------------------------------------
// Message / content helpers
// ---------------------------------------------------------------------------

function extractText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") { parts.push(item); continue; }
    if (!item || typeof item !== "object") continue;
    const t = item.type;
    if (t === "text") parts.push(String(item.text || ""));
    else if (["tool_result", "tool_use_result", "tool_result_error"].includes(t)) {
      parts.push(String(item.content || item.output || item.text || ""));
    } else if ("text" in item) parts.push(String(item.text || ""));
  }
  return parts.join("\n");
}

function newToolCallId() {
  return `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Tool normalization + parsing (OpenAI function-calling shape)
// ---------------------------------------------------------------------------

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    if (tool.type === "function" && tool.function && typeof tool.function === "object") {
      out.push(tool);
      continue;
    }
    if (tool.name) {
      out.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.parameters || tool.input_schema || { type: "object", properties: {} },
        },
      });
    }
  }
  return out;
}

function formatToolCall(tc) {
  const fn = tc.function && typeof tc.function === "object" ? tc.function : {};
  const name = fn.name || tc.name;
  if (typeof name !== "string" || !name) return null;
  const rawArgs = fn.arguments !== undefined ? fn.arguments : (tc.arguments !== undefined ? tc.arguments : "{}");
  const args = typeof rawArgs === "object" ? JSON.stringify(rawArgs) : (typeof rawArgs === "string" ? rawArgs : "{}");
  return { id: String(tc.id || newToolCallId()), type: "function", function: { name, arguments: args } };
}

function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const formatted = formatToolCall(item);
    if (formatted) out.push(formatted);
  }
  return out;
}

function dedupeToolCalls(toolCalls) {
  const seen = new Set();
  const out = [];
  for (const tc of normalizeToolCalls(toolCalls)) {
    const fn = tc.function || {};
    const key = `${fn.name}::${fn.arguments}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tc);
  }
  return out;
}

// Best-effort extraction of a single JSON object from model text.
function tryParseJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch { /* ignore */ }

  const blockMatch = JSON_BLOCK_RE.exec(trimmed);
  if (blockMatch) {
    try {
      const obj = JSON.parse(blockMatch[1]);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch { /* ignore */ }
  }

  // Brace-scan: find a balanced { ... } that parses (string-aware).
  const scanFrom = (startIdx) => {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = startIdx; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(trimmed.slice(startIdx, i + 1));
            if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
          } catch { /* ignore */ }
          return null;
        }
      }
    }
    return null;
  };

  const start = trimmed.indexOf("{");
  if (start >= 0) {
    const obj = scanFrom(start);
    if (obj) return obj;
  }
  if (trimmed.includes('"tool_calls"')) {
    const idx = trimmed.indexOf('"tool_calls"');
    const brace = trimmed.lastIndexOf("{", idx);
    if (brace >= 0) {
      const obj = scanFrom(brace);
      if (obj) return obj;
    }
  }
  return null;
}

// Returns [contentString|null, toolCalls[]]
function parseAssistantOutput(text) {
  const stripped = String(text || "").trim();
  if (!stripped) return [null, []];
  const obj = tryParseJsonObject(stripped);
  if (obj) {
    const toolCalls = dedupeToolCalls(obj.tool_calls);
    if (toolCalls.length) {
      const content = obj.content;
      if (content == null) return [null, toolCalls];
      if (typeof content === "string") return [content || null, toolCalls];
      return [JSON.stringify(content), toolCalls];
    }
    const content = obj.content;
    if (typeof content === "string" && content) return [content, []];
    if (content != null && typeof content !== "object") return [String(content), []];
  }
  return [stripped, []];
}

function toolChoiceInstruction(toolChoice) {
  if (toolChoice == null || toolChoice === "auto") return "Call a tool only when it helps fulfill the request.";
  if (toolChoice === "none") return "";
  if (toolChoice === "required") return "You MUST call at least one tool before answering.";
  if (typeof toolChoice === "object") {
    const name = toolChoice?.function?.name;
    if (typeof name === "string" && name) return `You MUST call the ${name} tool.`;
  }
  return "Call a tool only when it helps fulfill the request.";
}

function buildToolsInstruction(tools, toolChoice) {
  const normalized = normalizeTools(tools);
  if (!normalized.length || toolChoice === "none") return "";
  const names = normalized.map((t) => String(t?.function?.name || "")).filter(Boolean);
  const specs = truncate(JSON.stringify(normalized), MAX_TOOLS_SPEC);
  return [
    "You are a coding/agent assistant connected to an OpenAI-style function-calling channel. Tools execute on the user's machine.",
    toolChoiceInstruction(toolChoice),
    "",
    `Callable tools (exact names): ${names.join(", ")}`,
    "",
    "Tool schemas (JSON):",
    specs,
    "",
    "OUTPUT PROTOCOL — your entire reply MUST be a single raw JSON object (no markdown, no prose, no code fences) in one of these forms:",
    'To call tools: {"content": null, "tool_calls": [{"id": "call_<unique>", "type": "function", "function": {"name": "<exact_tool_name>", "arguments": "<JSON-encoded string of args>"}}]}',
    'To answer without tools: {"content": "<your reply>", "tool_calls": []}',
    "",
    "Rules:",
    "- The whole response is ONLY that JSON object. No text before or after.",
    "- arguments MUST be a JSON-encoded string (escaped), not a raw object.",
    "- Use exact tool names from the list. Each tool call needs a unique id starting with call_.",
    "- Never claim you lack filesystem/terminal access — call the appropriate tool instead.",
  ].join("\n");
}

// Serialize a single message into a readable transcript line for context.
function serializeMessage(msg) {
  const role = msg?.role || "user";
  if (role === "tool") {
    const id = msg.tool_call_id || msg.name || "";
    return `Tool result${id ? ` [${id}]` : ""}: ${truncate(extractText(msg.content), 6000)}`;
  }
  if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    const calls = normalizeToolCalls(msg.tool_calls).map((tc) => `${tc.function.name}(${tc.function.arguments})`);
    const text = extractText(msg.content);
    return `Assistant called tools: ${calls.join("; ")}${text ? `\nAssistant: ${text}` : ""}`;
  }
  const label = role === "assistant" ? "Assistant" : role === "system" ? "System" : "User";
  return `${label}: ${extractText(msg.content)}`;
}

// ---------------------------------------------------------------------------
// Merlin request body
// ---------------------------------------------------------------------------

function buildMerlinBody(messages, model, tools = null, toolChoice = null) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && m.role) : [];

  const systemParts = [];
  const transcript = [];
  for (const msg of list) {
    if (msg.role === "system" || msg.role === "developer") {
      const t = extractText(msg.content).trim();
      if (t) systemParts.push(t);
    } else {
      transcript.push(msg);
    }
  }

  // Last non-system turn becomes the "current message"; everything before is context.
  const lastMsg = transcript.length ? transcript[transcript.length - 1] : null;
  const priorMsgs = transcript.slice(0, -1);

  const toolsInstruction = buildToolsInstruction(tools, toolChoice);
  const lastTurnText = lastMsg ? truncate(serializeMessage(lastMsg), MAX_LAST_TURN) : "";

  // Build context tail-first (most recent priors kept) under budget.
  let contextBudget = MAX_CONTEXT;
  const sysText = systemParts.join("\n\n").trim();
  const contextChunks = [];
  for (let i = priorMsgs.length - 1; i >= 0; i -= 1) {
    const line = serializeMessage(priorMsgs[i]);
    if (line.length + 1 > contextBudget) {
      if (contextBudget > 200) contextChunks.unshift(truncate(line, contextBudget));
      break;
    }
    contextChunks.unshift(line);
    contextBudget -= line.length + 1;
  }
  let context = contextChunks.join("\n");
  if (sysText && context) context = `${sysText}\n\n--- Conversation so far ---\n${context}`;
  else if (sysText) context = sysText;

  // Compose content. Tool protocol must be prominent → put it at the head of content.
  let content;
  if (toolsInstruction) {
    content = `${toolsInstruction}\n\n--- Current message ---\n${lastTurnText}`;
  } else {
    content = lastTurnText || (lastMsg ? extractText(lastMsg.content) : "");
  }
  content = truncate(content, MAX_MERLIN_CONTENT);
  context = truncate(context, MAX_MERLIN_CONTENT);

  return {
    attachments: [],
    chatId: crypto.randomUUID(),
    language: "AUTO",
    message: {
      childId: crypto.randomUUID(),
      content,
      context,
      id: crypto.randomUUID(),
      parentId: "root",
    },
    mode: "UNIFIED_CHAT",
    model: resolveModel(model),
    metadata: {
      noTask: true,
      isWebpageChat: false,
      deepResearch: false,
      webAccess: false,
      proFinderMode: false,
      mcpConfig: { isEnabled: false },
      merlinMagic: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Merlin SSE reading
// ---------------------------------------------------------------------------

// Merlin streams `event: <type>\n data: <json>\n\n`. Surface text from
// `event: message` payloads ({ data: { text|content, type } }). Cumulative.
async function* readMerlinSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx;
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let eventType = "";
        const dataLines = [];
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
          if (trimmed.startsWith("event:")) eventType = trimmed.slice(6).trim();
          else if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trim());
        }
        if (dataLines.length === 0) continue;

        const dataStr = dataLines.join("\n");
        let parsed;
        try { parsed = JSON.parse(dataStr); } catch { continue; }

        if (eventType === "error" || parsed?.error) {
          const message = parsed?.error?.message || parsed?.message || "Merlin upstream error";
          yield { error: String(message) };
          return;
        }
        const data = parsed?.data;
        if (eventType === "message" && data && data.type === "text") {
          const content = data.text || data.content;
          if (content && content !== " ") yield { content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Read the full Merlin stream → final cumulative text (or { error }).
async function readFullMerlinText(body, signal) {
  let full = "";
  for await (const evt of readMerlinSse(body, signal)) {
    if (evt.error) return { error: evt.error };
    if (evt.content.length > full.length) full = evt.content;
  }
  return { text: removeCitations(full) };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Plain-text streaming (no tools)
// ---------------------------------------------------------------------------

function buildStreamingResponse(upstreamBody, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let seenLen = 0;
        for await (const evt of readMerlinSse(upstreamBody, signal)) {
          if (evt.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Error: ${evt.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }
          const full = evt.content;
          if (full.length <= seenLen) continue;
          const delta = removeCitations(full.slice(seenLen));
          seenLen = full.length;
          if (!delta) continue;
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null, logprobs: null }],
          })));
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(upstreamBody, model, cid, created, signal) {
  const result = await readFullMerlinText(upstreamBody, signal);
  if (result.error) {
    return new Response(JSON.stringify({
      error: { message: result.error, type: "upstream_error", code: "MERLIN_ERROR" },
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  const fullAnswer = result.text;
  const completionTokens = Math.ceil(fullAnswer.length / 4);
  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullAnswer }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: completionTokens, total_tokens: completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Tool-emulation responses (buffer full text → parse → emit tool_calls/content)
// ---------------------------------------------------------------------------

function buildToolStreamingResponse({ content, toolCalls, model, cid, created }) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
      })));

      if (toolCalls.length) {
        toolCalls.forEach((tc, index) => {
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{
              index: 0,
              delta: { tool_calls: [{ index, id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } }] },
              finish_reason: null, logprobs: null,
            }],
          })));
        });
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null }],
        })));
      } else {
        if (content) {
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
          })));
        }
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function buildToolNonStreamingResponse({ content, toolCalls, model, cid, created }) {
  const message = { role: "assistant", content: toolCalls.length ? (content ?? null) : (content ?? "") };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const completionTokens = Math.ceil(((content || "") + JSON.stringify(toolCalls)).length / 4);
  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message, finish_reason: toolCalls.length ? "tool_calls" : "stop", logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: completionTokens, total_tokens: completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class MerlinExecutor extends BaseExecutor {
  constructor() {
    super("merlin", PROVIDERS["merlin"]);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: MERLIN_ENDPOINT, headers: {}, transformedBody: body };
    }

    const token = credentials?.accessToken || credentials?.apiKey;
    if (!token) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing Merlin access token", type: "invalid_request" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: MERLIN_ENDPOINT, headers: {}, transformedBody: body };
    }

    const tools = body?.tools;
    const toolChoice = body?.tool_choice ?? null;
    const toolsActive = Array.isArray(tools) && tools.length > 0 && toolChoice !== "none";

    const merlinBody = buildMerlinBody(messages, model, tools, toolChoice);
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      "X-Merlin-Version": "web-merlin",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: MERLIN_ORIGIN,
      Referer: MERLIN_REFERER,
      "User-Agent": DEFAULT_USER_AGENT,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };

    log?.info?.("MERLIN", `Query to ${resolveModel(model)} (stream=${!!stream}, tools=${toolsActive ? tools.length : 0}), msgs=${messages.length}`);

    const fetchOptions = { method: "POST", headers, body: JSON.stringify(merlinBody) };
    if (signal) fetchOptions.signal = signal;

    let response;
    try {
      response = await proxyAwareFetch(MERLIN_ENDPOINT, fetchOptions, proxyOptions);
    } catch (err) {
      log?.error?.("MERLIN", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Merlin connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Merlin returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Merlin auth failed — access token may be expired. Re-paste your getmerlin.in Bearer token.";
      else if (status === 429) errMsg = "Merlin rate limited / out of queries. Wait a moment and retry.";
      log?.warn?.("MERLIN", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Merlin returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
    }

    const cid = `chatcmpl-merlin-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Tool-emulation path: buffer full output, parse JSON tool_calls.
    if (toolsActive) {
      const result = await readFullMerlinText(response.body, signal);
      if (result.error) {
        const errResp = new Response(JSON.stringify({
          error: { message: result.error, type: "upstream_error", code: "MERLIN_ERROR" },
        }), { status: 502, headers: { "Content-Type": "application/json" } });
        return { response: errResp, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
      }
      const [content, toolCalls] = parseAssistantOutput(result.text);
      log?.info?.("MERLIN", `Tool parse → ${toolCalls.length} tool_calls${toolCalls.length ? ` [${toolCalls.map((t) => t.function.name).join(", ")}]` : ""}`);
      const finalResponse = stream
        ? new Response(buildToolStreamingResponse({ content, toolCalls, model, cid, created }), {
            status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
          })
        : buildToolNonStreamingResponse({ content, toolCalls, model, cid, created });
      return { response: finalResponse, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
    }

    // Plain chat path.
    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, signal);
    }
    return { response: finalResponse, url: MERLIN_ENDPOINT, headers, transformedBody: merlinBody };
  }
}

// Backwards-compatible helper used by older tests.
function parseOpenAIMessages(messages) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && m.role) : [];
  const turns = list.filter((m) => m.role !== "system" && m.role !== "developer");
  const last = turns.length ? extractText(turns[turns.length - 1].content) : "";
  const context = turns.slice(0, -1).map((m) => `${m.role}: ${extractText(m.content)}`).join("\n");
  return { context, lastContent: last };
}

export {
  parseOpenAIMessages,
  buildMerlinBody,
  resolveModel,
  removeCitations,
  readMerlinSse,
  normalizeTools,
  buildToolsInstruction,
  parseAssistantOutput,
  tryParseJsonObject,
};

export default MerlinExecutor;
