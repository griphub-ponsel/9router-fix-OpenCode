import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

/** GitHub Claude thinking models need enough output budget or Copilot returns choices:[]. */
function testMaxTokens(model) {
  const m = String(model || "").toLowerCase();
  if (/^(gh|github)\/claude.*opus.*4\.[68]/.test(m)) return 256;
  if (/^(gh|github)\/claude/.test(m)) return 64;
  // xAI Grok Composer (Responses API) needs output budget; max_tokens=1 → empty choices
  if (/^(xog|xai-oauth)\/grok-composer/.test(m) || /^grok-composer/.test(m)) return 256;
  return 1;
}

function testChatBody(model) {
  const body = {
    model,
    max_tokens: testMaxTokens(model),
    stream: false,
    messages: [{ role: "user", content: "hi" }],
  };
  if (/^(gh|github)\/claude.*opus.*4\.8/i.test(model) && !body.reasoning_effort) {
    body.reasoning_effort = "medium";
  } else if (/^(gh|github)\/claude.*opus.*4\.6/i.test(model) && !body.reasoning_effort) {
    body.reasoning_effort = "low";
  }
  return body;
}

function textFromResponsesOutput(output) {
  if (!Array.isArray(output)) return "";
  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text;
    }
  }
  return "";
}

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    // Bypass dashboardGuard for internal self-call via CLI token (machineId-based)
    headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);

    const start = Date.now();

    // Route to appropriate endpoint based on kind
    if (kind === "embedding") {
      const res = await fetch(`${baseUrl}/api/v1/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: "test" }),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      const rawText = await res.text().catch(() => "");
      let parsed = null;
      try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

      if (!res.ok) {
        const detail = parsed?.error?.message || parsed?.error || rawText;
        return NextResponse.json({ ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status });
      }
      const hasEmbedding = Array.isArray(parsed?.data) && parsed.data.length > 0 && Array.isArray(parsed.data[0]?.embedding);
      if (!hasEmbedding) {
        return NextResponse.json({ ok: false, latencyMs, status: res.status, error: "Provider returned no embedding data" });
      }
      return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
    }

    // Default: chat completions
    // NOTE: keep max_tokens small but > 1. Some models (esp. thinking-capable
    // ones via GitHub Copilot) return HTTP 200 with an empty completion when
    // max_tokens=1, which made this probe a false-negative even though the
    // model works fine in real chats.
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(testChatBody(model)),
      signal: AbortSignal.timeout(20000),
    });
    const latencyMs = Date.now() - start;

    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      const error = `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`;
      return NextResponse.json({ ok: false, latencyMs, error, status: res.status });
    }

    // Some providers may return HTTP 200 but not a real completion for invalid models.
    const providerStatus = parsed?.status;
    const providerMsg = parsed?.msg || parsed?.message;
    const hasProviderErrorStatus = providerStatus !== undefined
      && providerStatus !== null
      && String(providerStatus) !== "200"
      && String(providerStatus) !== "0";
    if (hasProviderErrorStatus && providerMsg) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
      });
    }

    if (parsed?.error) {
      const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: String(providerError).slice(0, 240),
      });
    }

    const responsesText = typeof parsed?.output_text === "string"
      ? parsed.output_text
      : textFromResponsesOutput(parsed?.output);
    if (responsesText.trim().length > 0 || Array.isArray(parsed?.output)) {
      return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
    }

    const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
    // Treat any of these as proof the model responded: message content,
    // reasoning content (thinking models can spend the whole budget on reasoning),
    // tool calls, or usage accounting. Requiring non-empty `choices` text alone
    // produced false-negatives for thinking models with a tiny max_tokens.
    const choice = hasChoices ? parsed.choices[0] : null;
    const message = choice?.message || choice?.delta || null;
    const hasVisibleContent = typeof message?.content === "string" && message.content.trim().length > 0;
    const hasReasoning = typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0;
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    const completionTokens = parsed?.usage?.completion_tokens ?? parsed?.usage?.output_tokens ?? 0;
    const hasUsage = completionTokens > 0 || parsed?.status === "completed";
    const looksValid = hasVisibleContent || hasReasoning || hasToolCalls || hasUsage;
    if (!looksValid) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: completionTokens > 0
          ? "Model responded but returned empty text (try higher max_tokens or enable reasoning_effort)"
          : "Provider returned no completion choices for this model",
      });
    }

    return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
