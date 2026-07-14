import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { captureChatMemory, injectMemoryContext, deriveSessionId, maybeUpdateSessionSummary } from "@/shared/memory/capture.js";
import { scheduleAutoMemoryExtraction, MEMORY_INTERNAL_HEADER } from "@/shared/memory/autoMemory.js";
import { parseModel } from "../services/model.js";
import {
  needsVisionDelegation,
  findAutoVisionTarget,
  pickVisionFallback,
  bodyHasImages,
  collectImageParts,
  replaceImagesWithText,
  buildVisionProbeBody,
  formatVisionMarker,
  isImageUnsupportedError,
  getCachedVisionDescription,
  setCachedVisionDescription,
} from "../services/visionDelegation.js";

/**
 * Extract assistant text from an internal (non-streaming) chat result.
 * Handles both JSON completion bodies and SSE fallbacks.
 */
async function collectTextFromResponse(response) {
  if (!response) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  const raw = await response.text();
  if (!raw) return null;
  if (contentType.includes("application/json") || raw.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(raw);
      const msg = json?.choices?.[0]?.message;
      if (typeof msg?.content === "string") return msg.content;
      if (Array.isArray(msg?.content)) return msg.content.map((c) => c?.text || "").join("");
    } catch { /* fall through to SSE parse */ }
  }
  let text = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const choice = json?.choices?.[0];
      text += choice?.delta?.content || choice?.message?.content || "";
    } catch { /* ignore non-JSON keepalives */ }
  }
  return text || null;
}

/**
 * Relay image understanding to a vision-capable model, returning a factual
 * text description. Gives image-blind coding models effective vision, mirroring
 * Grok Build CLI.
 *
 * `target` is a full model id ("alias/model", e.g. "xog/grok-4.3"). When it
 * resolves to the SAME provider as the caller, credentials are reused; a
 * cross-provider target is resolved through `resolveVisionCredentials`.
 */
async function relayVisionDescription({ target, images, provider, credentials, log, connectionId, onCredentialsRefreshed, resolveVisionCredentials }) {
  const parsed = parseModel(target);
  const targetProvider = parsed.provider || provider;
  const targetModel = parsed.model || target;

  let relayCreds = credentials;
  let relayConnectionId = connectionId;
  let relayOnRefreshed = onCredentialsRefreshed;

  if (targetProvider !== provider) {
    if (typeof resolveVisionCredentials !== "function") {
      log?.warn?.("VISION", `no credential resolver for cross-provider relay → ${targetProvider}`);
      return null;
    }
    const resolved = await resolveVisionCredentials(targetProvider, targetModel);
    if (!resolved?.credentials) {
      log?.warn?.("VISION", `no credentials for vision relay provider ${targetProvider}`);
      return null;
    }
    relayCreds = resolved.credentials;
    relayConnectionId = resolved.connectionId ?? null;
    relayOnRefreshed = resolved.onCredentialsRefreshed;
  }

  const probe = buildVisionProbeBody(targetModel, images);
  const result = await handleChatCore({
    body: probe,
    modelInfo: { provider: targetProvider, model: targetModel },
    credentials: relayCreds,
    log,
    connectionId: relayConnectionId,
    onCredentialsRefreshed: relayOnRefreshed,
    internalVisionRelay: true,
  });
  if (!result?.success || !result.response) return null;
  return collectTextFromResponse(result.response);
}

/**
 * Delegate every image in `body` to a vision relay and replace them with the
 * resulting text marker (mutates body). Fail-safe: on relay failure the images
 * are replaced with an honest note instead of hard-failing the request.
 */
async function delegateImagesInBody({ body, target, model, provider, credentials, log, connectionId, onCredentialsRefreshed, resolveVisionCredentials }) {
  const images = collectImageParts(body);

  // Cache hit: this exact image set was already described on an earlier turn
  // (client resent history). Reuse it and skip the relay call entirely.
  const cached = getCachedVisionDescription(images);
  if (cached) {
    const marker = formatVisionMarker(cached, { count: images.length, delegated: true, sibling: target });
    replaceImagesWithText(body, marker);
    log?.debug?.("VISION", `${images.length} image(s) served from cache for ${model} (relay skipped)`);
    return true;
  }

  let description = null;
  try {
    description = await relayVisionDescription({
      target, images, provider, credentials, log, connectionId,
      onCredentialsRefreshed, resolveVisionCredentials,
    });
  } catch (err) {
    log?.warn?.("VISION", `delegation failed: ${err?.message || err}`);
  }
  // Only cache successful descriptions — fallback notes must not be reused.
  if (description) setCachedVisionDescription(images, description);
  const marker = formatVisionMarker(description, { count: images.length, delegated: !!description, sibling: target });
  replaceImagesWithText(body, marker);
  log?.debug?.("VISION", `${images.length} image(s) ${description ? `relayed via ${target}` : "replaced with note"} for ${model}`);
  return !!description;
}

function getHeader(headers = {}, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) return value;
  }
  return null;
}

async function applyMemoryContext({ body, provider, model, clientRawRequest, log, memoryExtractModel }) {
  try {
    // Never capture/inject for internal memory self-calls (extraction,
    // summarization) — prevents infinite recursion through /v1/chat/completions.
    if (getHeader(clientRawRequest?.headers, MEMORY_INTERNAL_HEADER)) return;

    // 9Router is a personal, single-user local router. API keys authenticate
    // clients; they are not separate memory identities. Keeping one canonical
    // owner makes every dashboard memory available across VS Code, OpenCode,
    // CLI tools, and rotated client keys instead of fragmenting recall.
    const userId = "local-user";
    const explicitSession = getHeader(clientRawRequest?.headers, "x-9router-session-id") || body.session_id || body.conversation_id || body.thread_id || null;
    const sessionId = deriveSessionId(body, explicitSession);
    const captured = await captureChatMemory(body, {
      endpoint: clientRawRequest?.endpoint,
      provider,
      model,
      sessionId,
      userId,
    });
    const injected = await injectMemoryContext(body, { userId });
    if (captured?.memories) log?.debug?.("MEMORY", `Saved ${captured.memories} remembered fact(s)`);
    if (injected?.injected) log?.debug?.("MEMORY", `Injected ${injected.injected} remembered fact(s) into prompt`);
    if (injected?.error) log?.warn?.("MEMORY", `injection failed: ${injected.error}`);

    // ChatGPT-style background jobs (fire-and-forget, throttled, fail-open):
    // LLM decides what's memory-worthy + rolling episodic session summary.
    // Dashboard-picked extraction model (settings.memoryExtractModel) wins over
    // the module default (MEMORY_EXTRACT_MODEL env → "auto" alias).
    scheduleAutoMemoryExtraction(body, { userId, sessionId, provider, model }, log, memoryExtractModel ? { model: memoryExtractModel } : {});
    setImmediate(() => {
      maybeUpdateSessionSummary(sessionId, { userId }).catch(() => {});
    });
  } catch (error) {
    log?.warn?.("MEMORY", `skipped: ${error?.message || error}`);
  }
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore(options) {
  const { modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, memoryExtractModel, sourceFormatOverride, providerThinking, internalVisionRelay, visionFallbackModels, autoVisionFallbackModels, resolveVisionCredentials, visionRetryAttempted } = options;
  let body = options.body;
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  if (!internalVisionRelay && !visionRetryAttempted) {
    await applyMemoryContext({ body, provider, model, clientRawRequest, log, memoryExtractModel });
  }

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  // Vision delegation: give image-blind models effective vision by relaying
  // image understanding to a vision-capable model, then injecting the resulting
  // description as text (mirroring the Grok Build CLI harness).
  //
  // Two proactive triggers (plus a reactive retry further down when the
  // upstream rejects images despite capabilities saying otherwise):
  //   1. needsVisionDelegation(provider, model) — models whose family looks
  //      vision-capable but whose upstream API rejects raw images (xAI Grok
  //      Composer/Build/Code). Always delegates.
  //   2. Any model that simply can't read images (caps.vision === false).
  //
  // Target selection order: user-configured fallback (random pick for load
  // balance, may point at ANOTHER provider) → same-provider vision model
  // (hardcoded sibling or auto-discovered from capabilities) → auto-derived
  // cross-provider fallback from the user's connected providers. Fail-safe: on
  // any error the image is replaced with an honest note instead of hard-failing
  // the request.
  const pickVisionTarget = () =>
    pickVisionFallback(visionFallbackModels) ||
    findAutoVisionTarget(provider, model) ||
    pickVisionFallback(autoVisionFallbackModels);

  if (!internalVisionRelay && !visionRetryAttempted && bodyHasImages(body)) {
    const visionCaps = getCapabilitiesForModel(provider, model);
    const forcedDelegation = needsVisionDelegation(provider, model);
    const genericDelegation = visionCaps?.vision === false;
    const target = pickVisionTarget();

    if ((forcedDelegation || genericDelegation) && target) {
      await delegateImagesInBody({
        body, target, model, provider, credentials, log, connectionId,
        onCredentialsRefreshed, resolveVisionCredentials,
      });
    }
  }

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  // Headroom: compress context on the SOURCE body BEFORE translation. The proxy
  // only understands openai/claude/responses shapes; the source body is always
  // one of those, while the translated body may be an exotic provider shape
  // (kiro/gemini) that Headroom can't parse. Running post-translation silently
  // skipped those targets ("unsupported <fmt> request shape"). Running here
  // makes Headroom work for ALL providers. Fail-open: compress mutates `body`
  // in place and returns null on any error, leaving the original body intact.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(body, { enabled: headroomEnabled, url: headroomUrl, model: upstreamModel, format: sourceFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${headroomSizeLine}`);
    }
  } else if (headroomEnabled) {
    // Circuit-open skips repeat on every request while the proxy is down —
    // log those at debug; the initial connection failure already warned.
    const headroomSkipMsg = `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`;
    if (headroomDiagnostics.circuitOpen) log?.debug?.("HEADROOM", headroomSkipMsg);
    else log?.warn?.("HEADROOM", headroomSkipMsg);
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: upstreamModel };
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, upstreamModel);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = upstreamModel;
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // NOTE: Headroom compression runs earlier, on the pre-translation source body
  // (see block above), so it works for ALL provider target shapes — not just
  // openai/claude/responses. Do not re-add a post-translation Headroom call.

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    log?.debug?.("PONYTAIL", `${ponytailLevel} | ${finalFormat}`);
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  try {
    const result = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (provider !== "notion" && !executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      const newCredentials = await refreshWithRetry(() => executor.refreshCredentials(credentials, log), 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
          if (retryResult.response.ok) { providerResponse = retryResult.response; providerUrl = retryResult.url; }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    reqLogger.logError(new Error(message), finalBody || translatedBody);

    // Reactive vision fallback (ALL providers): the upstream rejected image
    // input even though capabilities didn't predict it (wrong/missing caps
    // entry, per-endpoint gating like OpenRouter's "No endpoints found that
    // support image input", or generic content-shape errors like alibaba's
    // "Unexpected item type in content."). Delegate the images to a vision
    // relay and retry the whole request ONCE with the images replaced by text.
    if (!internalVisionRelay && !visionRetryAttempted && bodyHasImages(body) && isImageUnsupportedError(statusCode, message, true)) {
      const target = pickVisionTarget();
      if (target) {
        log?.warn?.("VISION", `upstream rejected images (${statusCode}); delegating to ${target} and retrying`);
        await delegateImagesInBody({
          body, target, model, provider, credentials, log, connectionId,
          onCredentialsRefreshed, resolveVisionCredentials,
        });
        return handleChatCore({ ...options, body, visionRetryAttempted: true });
      }
      log?.warn?.("VISION", `upstream rejected images (${statusCode}) but no vision relay target available`);
    }

    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // Responses-API request translators hardcode stream:true upstream (see
  // request/openai-responses.js), so a non-streaming client still gets SSE
  // back. Convert it properly here — parseSSEToOpenAIResponse in the plain
  // non-streaming handler only understands Chat Completions chunks and would
  // silently produce empty content (and swallow upstream error events).
  if (!stream && !providerRequiresStreaming && PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
