import { describe, expect, it } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { find } from "../../open-sse/rtk/filters/find.js";

describe("RTK Windows find output", () => {
  const input = [
    "C:\\Users\\me\\src\\a.js",
    "C:\\Users\\me\\src\\b.js",
    "C:\\Users\\me\\src\\c.js",
  ].join("\n");

  it("detects and groups drive-letter paths", () => {
    expect(autoDetectFilter(input)).toBe(find);
    expect(find(input)).toContain("C:/Users/me/src/");
  });
});