import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";

const BASE_URL = "https://hyperagent.com";
const THREADS_URL = `${BASE_URL}/api/threads`;

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("\n");
}

export function extractHyperagentPrompt(messages = []) {
  return messages.map((message) => {
    const text = contentToText(message?.content);
    if (!text) return "";
    const role = String(message?.role || "user");
    return `${role[0].toUpperCase()}${role.slice(1)}: ${text}`;
  }).filter(Boolean).join("\n\n");
}

export function parseHyperagentSse(raw = "") {
  let text = "";
  let done = false;
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") { done = true; continue; }
    try {
      const event = JSON.parse(data);
      if (event.type === "text" && typeof event.content === "string") text += event.content;
      if (event.type === "done" || event.type === "session_end") done = true;
    } catch { /* ignore keepalives/non-JSON events */ }
  }
  return { text, done };
}

function normalizeCookie(value = "") {
  return String(value).trim().replace(/^__Host-hyperagent_session=/, "").split(";")[0];
}

function buildHeaders(credentials) {
  const cookie = normalizeCookie(credentials?.apiKey || credentials?.accessToken || "");
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Cookie: `__Host-hyperagent_session=${cookie}`,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/threads/new`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
  };
}

function redactCookieHeader(headers) {
  return { ...headers, Cookie: "[REDACTED]" };
}

function makeError(message, status = 502) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completionJson(model, text, prompt) {
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(text.length / 4);
  return {
    id: `chatcmpl-hyperagent-${crypto.randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

function completionSse(model, text) {
  const id = `chatcmpl-hyperagent-${crypto.randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const base = { id, object: "chat.completion.chunk", created, model };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`));
      if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function buildChatPayload(content, body) {
  return {
    sessionId: crypto.randomUUID(),
    unifiedStream: true,
    searchMode: "exa",
    enableExecuteScript: false,
    enablePersistentSandbox: true,
    enableWebpage: false,
    enableSlides: false,
    tablesEnabled: false,
    enableWebSearch: false,
    enableBrowser: false,
    enableImageGeneration: false,
    enableVideoGeneration: false,
    enableAudioGeneration: false,
    enableTranscription: false,
    enableAvatarVideo: false,
    enableExaFindSimilar: false,
    enableExaAnswer: false,
    enableExaResearch: false,
    enableExaWebsets: false,
    enableGeoTools: false,
    hyperAppsEnabled: false,
    documentsEnabled: false,
    enableThreadSearch: false,
    residentialProxyEnabled: false,
    solveCaptchasEnabled: false,
    content,
    debug: false,
    enabledIntegrations: [],
    integrationMode: "open",
    globalTablesEnabled: false,
    injectPlanMode: false,
    ...(body?.reasoning_effort ? { effort: body.reasoning_effort } : {}),
  };
}

export class HyperagentExecutor extends BaseExecutor {
  constructor() {
    super("hyperagent", PROVIDERS.hyperagent);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const prompt = extractHyperagentPrompt(body?.messages);
    const headers = buildHeaders(credentials);
    const loggedHeaders = redactCookieHeader(headers);
    if (!normalizeCookie(credentials?.apiKey || credentials?.accessToken)) {
      return { response: makeError("Hyperagent session cookie is missing", 401), url: THREADS_URL, headers: loggedHeaders, transformedBody: body };
    }
    if (!prompt) {
      return { response: makeError("Missing or empty messages array", 400), url: THREADS_URL, headers: loggedHeaders, transformedBody: body };
    }

    const threadBody = { modelId: model, source: "9router" };
    let threadResponse;
    try {
      threadResponse = await fetch(THREADS_URL, { method: "POST", headers, body: JSON.stringify(threadBody), signal });
    } catch (error) {
      return { response: makeError(`Hyperagent connection failed: ${error.message}`), url: THREADS_URL, headers: loggedHeaders, transformedBody: threadBody };
    }
    if (!threadResponse.ok) {
      const message = threadResponse.status === 401 || threadResponse.status === 403
        ? "Hyperagent auth failed — import a fresh __Host-hyperagent_session cookie"
        : `Hyperagent thread creation returned HTTP ${threadResponse.status}`;
      return { response: makeError(message, threadResponse.status), url: THREADS_URL, headers: loggedHeaders, transformedBody: threadBody };
    }

    const thread = await threadResponse.json();
    if (!thread?.id) return { response: makeError("Hyperagent returned no thread id"), url: THREADS_URL, headers: loggedHeaders, transformedBody: threadBody };

    const chatUrl = `${THREADS_URL}/${encodeURIComponent(thread.id)}/chat`;
    const chatBody = buildChatPayload(prompt, body);
    log?.info?.("HYPERAGENT", `Thread ${thread.id.slice(0, 12)}… model=${model} prompt=${prompt.length} chars`);
    const upstream = await fetch(chatUrl, { method: "POST", headers, body: JSON.stringify(chatBody), signal });
    if (!upstream.ok) {
      const message = upstream.status === 401 || upstream.status === 403
        ? "Hyperagent auth failed — session cookie may be expired"
        : `Hyperagent chat returned HTTP ${upstream.status}`;
      return { response: makeError(message, upstream.status), url: chatUrl, headers: loggedHeaders, transformedBody: chatBody };
    }

    const parsed = parseHyperagentSse(await upstream.text());
    const response = stream
      ? new Response(completionSse(model, parsed.text), { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } })
      : new Response(JSON.stringify(completionJson(model, parsed.text, prompt)), { status: 200, headers: { "Content-Type": "application/json" } });
    return { response, url: chatUrl, headers: loggedHeaders, transformedBody: chatBody };
  }
}

export default HyperagentExecutor;
