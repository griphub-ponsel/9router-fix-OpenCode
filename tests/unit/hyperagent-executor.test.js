import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HyperagentExecutor,
  extractHyperagentPrompt,
  parseHyperagentSse,
} from "../../open-sse/executors/hyperagent.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { testApiKeyConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe("HyperagentExecutor", () => {
  it("is registered as a specialized web-cookie provider", () => {
    expect(hasSpecializedExecutor("hyperagent")).toBe(true);
    expect(getExecutor("hyperagent")).toBeInstanceOf(HyperagentExecutor);
    expect(REGISTRY.find((entry) => entry.id === "hyperagent")).toMatchObject({
      alias: "ha",
      category: "webCookie",
      authType: "cookie",
    });
  });

  it("tests the saved session through auth/me without consuming inference credit", async () => {
    global.fetch = vi.fn(async (url, init = {}) => {
      expect(url).toBe("https://hyperagent.com/api/auth/me");
      expect(init.headers.Cookie).toBe("__Host-hyperagent_session=cookie-secret");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(testApiKeyConnection({
      provider: "hyperagent",
      apiKey: "__Host-hyperagent_session=cookie-secret",
    })).resolves.toEqual({ valid: true, error: null });
  });

  it("rejects an expired saved session without hanging", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    await expect(testApiKeyConnection({ provider: "hyperagent", apiKey: "expired" }))
      .resolves.toEqual({ valid: false, error: "Hyperagent session expired — import a fresh cookie" });
  });

  it("flattens OpenAI messages into a prompt without losing roles", () => {
    expect(extractHyperagentPrompt([
      { role: "system", content: "Be terse" },
      { role: "user", content: "Ping" },
      { role: "assistant", content: "Pong" },
      { role: "user", content: [{ type: "text", text: "Again" }] },
    ])).toBe("System: Be terse\n\nUser: Ping\n\nAssistant: Pong\n\nUser: Again");
  });

  it("parses text deltas and completion from Hyperagent SSE", () => {
    const events = parseHyperagentSse([
      'data: {"type":"text","content":"WO"}',
      'data: {"type":"text","content":"RK"}',
      'data: {"type":"session_end","content":"Completed"}',
      "data: [DONE]",
    ].join("\n\n"));
    expect(events).toEqual({ text: "WORK", done: true });
  });

  it("creates a thread then posts chat with the opaque session cookie", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/threads")) return new Response(JSON.stringify({ id: "thread-1" }), { status: 200 });
      if (url.endsWith("/api/threads/thread-1/chat")) return new Response([
        'data: {"type":"text","content":"PONG"}',
        'data: {"type":"done"}',
        "data: [DONE]",
      ].join("\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      throw new Error(`unexpected ${url}`);
    });

    const result = await new HyperagentExecutor().execute({
      model: "claude-opus-4-8",
      body: { messages: [{ role: "user", content: "Ping" }] },
      stream: false,
      credentials: { apiKey: "cookie-secret" },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers.Cookie).toBe("__Host-hyperagent_session=cookie-secret");
    expect(result.headers.Cookie).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("cookie-secret");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ modelId: "claude-opus-4-8", source: "9router" });
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ content: "User: Ping", unifiedStream: true });
    const json = await result.response.json();
    expect(json.choices[0].message.content).toBe("PONG");
  });
});
