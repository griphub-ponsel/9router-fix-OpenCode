import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom, formatHeadroomLog, resetHeadroomCircuit } from "../../open-sse/rtk/headroom.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetHeadroomCircuit();
});

describe("compressWithHeadroom", () => {
  it("no-ops when disabled", async () => {
    global.fetch = vi.fn();
    const body = { messages: [{ role: "user", content: "hello" }] };

    const stats = await compressWithHeadroom(body, { enabled: false, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.messages[0].content).toBe("hello");
  });

  it("compresses messages in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787/", model: "gpt-4o" });

    expect(body.messages[0].content).toBe("short");
    expect(stats.tokens_saved).toBe(80);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/v1/compress", expect.objectContaining({ method: "POST" }));
  });

  it("compresses responses input in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: "long" }] };

    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(body.input[0].content).toBe("short");
  });

  it("compresses raw Kiro conversation state without changing its structure", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "system", content: "short system" },
        { role: "user", content: "short user" },
      ],
      tokens_saved: 20,
    }), { status: 200 }));
    const body = {
      profileArn: "arn:test",
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            systemInstruction: "long system",
            content: "long user",
            modelId: "claude-sonnet-5",
          },
        },
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-5",
      format: "kiro",
    });

    expect(stats.tokens_saved).toBe(20);
    expect(body.profileArn).toBe("arn:test");
    expect(body.conversationState.currentMessage.userInputMessage).toMatchObject({
      systemInstruction: "short system",
      content: "short user",
      modelId: "claude-sonnet-5",
    });
  });

  it("fails open when Kiro compression changes message order", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "assistant", content: "wrong role" }],
    }), { status: 200 }));
    const body = {
      conversationState: {
        history: [],
        currentMessage: { userInputMessage: { content: "original", modelId: "claude-sonnet-5" } },
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const result = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-5",
      format: "kiro",
      diagnostics,
    });

    expect(result).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toContain("preserve Kiro message order");
  });

  it("fails open on bad response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(body.messages[0].content).toBe("long");
  });

  it("skips unknown shapes", async () => {
    global.fetch = vi.fn();
    const body = { contents: [{ parts: [{ text: "long" }] }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("opens circuit after connection failure and skips subsequent fetches", async () => {
    global.fetch = vi.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
    });
    const body = { messages: [{ role: "user", content: "hello" }] };

    const diag1 = {};
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", diagnostics: diag1 });
    expect(diag1.reason).toContain("request failed");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const diag2 = {};
    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", diagnostics: diag2 });
    expect(stats).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1); // no second fetch
    expect(diag2.reason).toContain("circuit open");
    expect(diag2.circuitOpen).toBe(true);
  });

  it("does not open circuit on HTTP errors", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const body = { messages: [{ role: "user", content: "hello" }] };

    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });
    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(global.fetch).toHaveBeenCalledTimes(2); // circuit stays closed
  });
});

describe("formatHeadroomLog", () => {
  it("formats reported token deltas without implying provider billing savings", () => {
    expect(formatHeadroomLog({ tokens_before: 100, tokens_after: 25, tokens_saved: 75 }))
      .toBe("reported token delta=75 before=100 after=25 (75.0%)");
  });
});
