import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const GROK_CHAT_API = PROVIDERS["grok-web"].baseUrl;
const GROK_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const MODEL_MAP = {
  "grok-3": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3", isThinking: false },
  "grok-3-mini": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_MINI_THINKING", isThinking: true },
  "grok-3-thinking": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_THINKING", isThinking: true },
  "grok-4": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4", isThinking: false },
  "grok-4-mini": { grokModel: "grok-4-mini", modelMode: "MODEL_MODE_GROK_4_MINI_THINKING", isThinking: true },
  "grok-4-thinking": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4_THINKING", isThinking: true },
  "grok-4-heavy": { grokModel: "grok-4", modelMode: "MODEL_MODE_HEAVY", isThinking: true },
  "grok-4.1-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-4.1-fast": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-4.1-expert": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_EXPERT", isThinking: true },
  "grok-4.1-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4.2": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20-beta": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.3": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4", isThinking: false },
};

function randomString(length, alphanumeric = false) {
  const chars = alphanumeric ? "abcdefghijklmnopqrstuvwxyz0123456789" : "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function generateStatsigId() {
  const msg = Math.random() < 0.5
    ? `e:TypeError: Cannot read properties of null (reading 'children["${randomString(5, true)}"]')`
    : `e:TypeError: Cannot read properties of undefined (reading '${randomString(10)}')`;
  return btoa(msg);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseOpenAIMessages(messages) {
  const turns = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => String(c.text || ""))
        .join(" ");
    }
    text = text.trim();
    if (!text) continue;
    turns.push({ role, text });
  }

  // Last user turn becomes the actual prompt; earlier turns are flattened
  // into a single context block tagged by role. Grok web reject "Invalid input"
  // when it can't find a clean trailing user message.
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    // No user message at all — Grok will reject. Caller handles empty-message.
    return turns.map((t) => t.text).join("\n\n");
  }

  const prior = turns.slice(0, lastUserIdx);
  const lastUser = turns[lastUserIdx].text;

  if (prior.length === 0) return lastUser;

  const contextLines = prior.map((t) => {
    const tag =
      t.role === "system" ? "System" : t.role === "assistant" ? "Assistant" : "User";
    return `[${tag}]\n${t.text}`;
  });

  return `${contextLines.join("\n\n")}\n\n[User]\n${lastUser}`;
}

async function* readGrokNdjsonEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try { yield JSON.parse(line); } catch { /* skip */ }
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining) {
      try { yield JSON.parse(remaining); } catch { /* skip */ }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* extractContent(eventStream, isThinkingModel, signal) {
  let fingerprint = "";
  let responseId = "";
  let thinkOpened = false;
  let hasOutput = false;

  for await (const event of readGrokNdjsonEvents(eventStream, signal)) {
    if (event.error) {
      const code = event.error.code || event.error.status || "";
      const msg = event.error.message || event.error.detail || "";
      if (hasOutput && /^invalid input\b/i.test(String(msg || "").trim())) {
        yield { done: true, fingerprint, responseId };
        return;
      }
      yield {
        error: msg ? `${msg}${code ? ` (${code})` : ""}` : `Grok error: ${code || "unknown"}`,
        done: true,
      };
      return;
    }
    const resp = event.result?.response;
    if (!resp) continue;

    if (resp.llmInfo?.modelHash && !fingerprint) fingerprint = resp.llmInfo.modelHash;
    if (resp.responseId) responseId = resp.responseId;

    if (resp.modelResponse) {
      const mr = resp.modelResponse;
      // Grok upstream sometimes returns its rejection text inside modelResponse
      // instead of an error envelope. Surface those as errors so downstream
      // clients see a real error chunk instead of "Invalid input" leaking
      // through as plain content.
      const trimmed = (mr.message || "").trim();
      if (trimmed && /^invalid input\b/i.test(trimmed)) {
        if (hasOutput) {
          yield { done: true, fingerprint, responseId };
          return;
        }
        yield {
          error:
            "Grok rejected the request (Invalid input). The selected model alias may not be available on your subscription, or the request payload is malformed.",
          done: true,
        };
        return;
      }
      if (thinkOpened && isThinkingModel) {
        if (mr.message) {
          hasOutput = true;
          yield { thinking: mr.message };
        }
        thinkOpened = false;
      }
      if (mr.message) {
        hasOutput = true;
        yield { fullMessage: mr.message, fingerprint, responseId };
      }
      if (mr.metadata?.llm_info?.modelHash) fingerprint = mr.metadata.llm_info.modelHash;
      continue;
    }

    if (resp.token != null) {
      const token = String(resp.token);
      if (/^invalid input\b/i.test(token.trim())) {
        if (hasOutput) {
          yield { done: true, fingerprint, responseId };
          return;
        }
        yield {
          error: "Grok rejected the request (Invalid input).",
          done: true,
        };
        return;
      }
      hasOutput = true;
      yield { delta: resp.token, fingerprint, responseId };
    }
  }
  yield { done: true, fingerprint, responseId };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function stripTrailingInvalidInput(text) {
  if (!text) return "";
  return String(text)
    .replace(/(?:\n|\r|\s)*invalid input\s*$/i, "")
    .trimEnd();
}

function buildStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal) {
  const encoder = new TextEncoder();
  const tailSentinel = "Invalid input";
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let fp = "";
        let pendingText = "";
        for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
          if (chunk.fingerprint) fp = chunk.fingerprint;

          if (chunk.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }
          if (chunk.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { reasoning_content: chunk.thinking }, finish_reason: null, logprobs: null }],
            })));
            continue;
          }
          if (chunk.done) break;
          if (chunk.delta) {
            pendingText += chunk.delta;

            // Keep a small tail buffer so we can strip trailing "Invalid input"
            // that Grok occasionally appends after a valid answer.
            const keep = tailSentinel.length + 8;
            if (pendingText.length > keep) {
              const flushPart = pendingText.slice(0, pendingText.length - keep);
              pendingText = pendingText.slice(pendingText.length - keep);
              if (flushPart) {
                controller.enqueue(encoder.encode(sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
                  choices: [{ index: 0, delta: { content: flushPart }, finish_reason: null, logprobs: null }],
                })));
              }
            }
          }
        }

        if (pendingText) {
          const finalText = stripTrailingInvalidInput(pendingText);
          if (finalText) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: finalText }, finish_reason: null, logprobs: null }],
            })));
          }
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
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

async function buildNonStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal) {
  let fullContent = "";
  let fingerprint = "";
  const thinkingParts = [];

  for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
    if (chunk.fingerprint) fingerprint = chunk.fingerprint;
    if (chunk.error) {
      return new Response(JSON.stringify({
        error: { message: chunk.error, type: "upstream_error", code: "GROK_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (chunk.thinking) { thinkingParts.push(chunk.thinking); continue; }
    if (chunk.done) break;
    if (chunk.fullMessage) fullContent = chunk.fullMessage;
    else if (chunk.delta) fullContent += chunk.delta;
  }

  fullContent = stripTrailingInvalidInput(fullContent);

  const msg = { role: "assistant", content: fullContent };
  if (thinkingParts.length > 0) msg.reasoning_content = thinkingParts.join("\n");

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: fingerprint || null,
    choices: [{ index: 0, message: msg, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GrokWebExecutor extends BaseExecutor {
  constructor() {
    super("grok-web", PROVIDERS["grok-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {}, transformedBody: body };
    }

    const modelInfo = MODEL_MAP[model];
    if (!modelInfo) {
      log?.warn?.(
        "GROK-WEB",
        `Unmapped model "${model}", falling back to grok-4. ` +
          `Pick one of: ${Object.keys(MODEL_MAP).join(", ")}.`,
      );
    }
    const { grokModel, modelMode, isThinking } = modelInfo || MODEL_MAP["grok-4"];

    const message = parseOpenAIMessages(messages);
    if (!message.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {}, transformedBody: body };
    }

    const grokPayload = {
      temporary: true, modelName: grokModel, modelMode, message,
      fileAttachments: [], imageAttachments: [],
      disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
      returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
      forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
      isReasoning: false, disableTextFollowUps: false, disableMemory: true,
      forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
      deviceEnvInfo: {
        darkModeEnabled: false, devicePixelRatio: 2,
        screenWidth: 2056, screenHeight: 1329, viewportWidth: 2056, viewportHeight: 1083,
      },
    };

    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      Baggage: "sentry-environment=production,sentry-release=d6add6fb0460641fd482d767a335ef72b9b6abb8,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://grok.com",
      Pragma: "no-cache",
      Referer: "https://grok.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": GROK_USER_AGENT,
      "x-statsig-id": generateStatsigId(),
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`,
    };

    // Strip "sso=" prefix if user pasted it
    if (credentials.apiKey) {
      let token = credentials.apiKey;
      if (token.startsWith("sso=")) token = token.slice(4);
      headers["Cookie"] = `sso=${token}`;
    }

    log?.info?.("GROK-WEB", `Query to ${model} (grok=${grokModel}, mode=${modelMode}), len=${message.length}`);

    let response;
    try {
      response = await fetch(GROK_CHAT_API, {
        method: "POST", headers, body: JSON.stringify(grokPayload), signal,
      });
    } catch (err) {
      log?.error?.("GROK-WEB", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Grok connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Grok returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Grok auth failed — SSO cookie may be expired. Re-paste your sso cookie value from grok.com.";
      else if (status === 429) errMsg = "Grok rate limited. Wait a moment and retry, or rotate cookies.";
      log?.warn?.("GROK-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Grok returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    const cid = `chatcmpl-grok-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, isThinking, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, isThinking, signal);
    }
    return { response: finalResponse, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
  }
}

export default GrokWebExecutor;
