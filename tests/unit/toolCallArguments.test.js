import { describe, expect, it } from "vitest";
import { normalizeToolInput, stringifyToolArguments } from "../../open-sse/utils/toolCallArguments.js";

describe("tool call argument normalization", () => {
  it("maps common OpenCode write aliases to filePath/content", () => {
    expect(normalizeToolInput("write", { path: "src/a.js", text: "hello" })).toEqual({
      path: "src/a.js",
      text: "hello",
      filePath: "src/a.js",
      content: "hello",
    });
  });

  it("normalizes JSON-string arguments for write", () => {
    expect(stringifyToolArguments("write", '{"file":"a.txt","contents":"x"}')).toBe(
      '{"file":"a.txt","contents":"x","filePath":"a.txt","content":"x"}'
    );
  });

  it("repairs nested JSON strings for write", () => {
    expect(stringifyToolArguments("write", '"{\\"file\\":\\"a.txt\\",\\"contents\\":\\"x\\"}"')).toBe(
      '{"file":"a.txt","contents":"x","filePath":"a.txt","content":"x"}'
    );
  });

  it("repairs raw newlines inside JSON-string write content", () => {
    expect(stringifyToolArguments("write", '{"file":"a.txt","content":"a\nb"}')).toBe(
      '{"file":"a.txt","content":"a\\nb","filePath":"a.txt"}'
    );
  });

  it("repairs over-escaped structural quotes from Kiro write input", () => {
    expect(stringifyToolArguments("write", '{\\"file\\":\\"a.txt\\",\\"text\\":\\"x\\"}')).toBe(
      '{"file":"a.txt","text":"x","filePath":"a.txt","content":"x"}'
    );
  });

  it("leaves non-write tools unchanged", () => {
    expect(normalizeToolInput("read", { path: "src/a.js", text: "hello" })).toEqual({
      path: "src/a.js",
      text: "hello",
    });
  });
});
