import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenAI thinking effort", () => {
  it("preserves native max for GPT 5.6", () => {
    const result = applyThinking(
      FORMATS.OPENAI,
      "gpt-5.6-sol",
      { reasoning_effort: "max" },
      "openai"
    );
    expect(result.reasoning_effort).toBe("max");
  });

  it("clamps max to xhigh for older OpenAI-compatible models", () => {
    const result = applyThinking(
      FORMATS.OPENAI,
      "gpt-5.5",
      { reasoning_effort: "max" },
      "openai"
    );
    expect(result.reasoning_effort).toBe("xhigh");
  });
});