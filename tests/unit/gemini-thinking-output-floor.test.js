import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Gemini thinking output floor", () => {
  it("raises Gemini 3 high output room", () => {
    const body = { request: { generationConfig: { maxOutputTokens: 128 } }, reasoning_effort: "high" };
    const out = applyThinking(FORMATS.GEMINI_CLI, "gemini-3.1-pro-preview", body, "gemini-cli");
    expect(out.request.generationConfig.maxOutputTokens).toBe(65535);
  });

  it("keeps enough output room for Gemini 2.5 budget thinking", () => {
    const body = { request: { generationConfig: { maxOutputTokens: 1024 } }, reasoning_effort: "high" };
    const out = applyThinking(FORMATS.GEMINI_CLI, "gemini-2.5-pro", body, "gemini-cli");
    expect(out.request.generationConfig.maxOutputTokens).toBe(32768);
  });
});