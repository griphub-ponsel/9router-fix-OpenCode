import { describe, expect, it } from "vitest";
import { estimateAnthropicInputTokens } from "../../src/app/api/v1/messages/count_tokens/route.js";

describe("Anthropic count_tokens estimator", () => {
  it("keeps plain text estimation", () => {
    expect(estimateAnthropicInputTokens({
      messages: [{ role: "user", content: "hello world" }],
    })).toBe(3);
  });

  it("counts tools, thinking, system, and tool definitions", () => {
    expect(estimateAnthropicInputTokens({
      system: "You are a coding assistant.",
      tools: [{ name: "Read", input_schema: { type: "object" } }],
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", name: "Read", input: { file_path: "a.js" } },
          { type: "thinking", thinking: "Inspect file first." },
        ] },
        { role: "user", content: [
          { type: "tool_result", content: "file contents" },
        ] },
      ],
    })).toBeGreaterThan(0);
  });
});