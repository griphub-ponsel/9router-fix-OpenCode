import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenAI thinking effort", () => {
  it("clamps max to xhigh", () => {
    const result = applyThinking(
      FORMATS.OPENAI,
      "gpt-5.6-sol",
      { reasoning_effort: "max" },
      "openai"
    );
    expect(result.reasoning_effort).toBe("xhigh");
  });
});