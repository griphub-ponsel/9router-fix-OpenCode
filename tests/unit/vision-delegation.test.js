import { describe, expect, it } from "vitest";

import {
  needsVisionDelegation,
  getVisionSibling,
  pickVisionFallback,
  bodyHasImages,
  collectImageParts,
  replaceImagesWithText,
  buildVisionProbeBody,
  formatVisionMarker,
} from "../../open-sse/services/visionDelegation.js";

describe("vision delegation", () => {
  it("flags xAI coding models (Composer/Build) but not Grok 4.x", () => {
    expect(needsVisionDelegation("xai-oauth", "grok-composer-2.5-fast")).toBe(true);
    expect(needsVisionDelegation("xai-oauth", "grok-build-0.1")).toBe(true);
    expect(needsVisionDelegation("xai-oauth", "grok-code-fast-1")).toBe(true);
    expect(needsVisionDelegation("xai-oauth", "grok-4.3")).toBe(false);
    expect(needsVisionDelegation("xai-oauth", "grok-4.20-0309-reasoning")).toBe(false);
    expect(needsVisionDelegation("openai", "gpt-5.5")).toBe(false);
  });

  it("resolves the vision sibling for xai-oauth", () => {
    expect(getVisionSibling("xai-oauth")).toBe("grok-4.3");
    expect(getVisionSibling("openai")).toBe(null);
  });

  it("picks a vision fallback from a configured list (or null when empty)", () => {
    expect(pickVisionFallback(null)).toBe(null);
    expect(pickVisionFallback([])).toBe(null);
    expect(pickVisionFallback(["  ", ""])).toBe(null);
    expect(pickVisionFallback(["xog/grok-4.3"])).toBe("xog/grok-4.3");
    // trims whitespace on the chosen entry
    expect(pickVisionFallback(["  xog/grok-4.3  "])).toBe("xog/grok-4.3");
    // always returns one of the configured entries
    const list = ["xog/grok-4.3", "gh/gpt-5", "cc/claude-opus-4.8"];
    for (let i = 0; i < 50; i++) {
      expect(list).toContain(pickVisionFallback(list));
    }
  });

  it("collects images from chat and responses shapes", () => {
    const chatBody = {
      messages: [
        { role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA", detail: "high" } },
        ] },
      ],
    };
    expect(bodyHasImages(chatBody)).toBe(true);
    const imgs = collectImageParts(chatBody);
    expect(imgs).toEqual([{ url: "data:image/png;base64,AAA", detail: "high" }]);

    const respBody = {
      input: [
        { type: "message", role: "user", content: [
          { type: "input_text", text: "hi" },
          { type: "input_image", image_url: "data:image/png;base64,BBB" },
        ] },
      ],
    };
    expect(collectImageParts(respBody)).toEqual([{ url: "data:image/png;base64,BBB", detail: "auto" }]);
  });

  it("replaces image parts with a text marker, preserving text", () => {
    const body = {
      messages: [
        { role: "user", content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        ] },
      ],
    };
    replaceImagesWithText(body, "[desc]");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[desc]" },
    ]);
    expect(JSON.stringify(body)).not.toContain("image_url");
  });

  it("uses input_text shape when the surrounding content is Responses-style", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,AAA" },
        ] },
      ],
    };
    replaceImagesWithText(body, "[desc]");
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "look" },
      { type: "input_text", text: "[desc]" },
    ]);
  });

  it("builds a vision probe body for the sibling", () => {
    const probe = buildVisionProbeBody("grok-4.3", [{ url: "data:image/png;base64,AAA", detail: "auto" }]);
    expect(probe.model).toBe("grok-4.3");
    expect(probe.stream).toBe(false);
    const content = probe.messages[0].content;
    expect(content.some((c) => c.type === "image_url")).toBe(true);
    expect(content[0].type).toBe("text");
  });

  it("formats delegated vs fallback markers", () => {
    const delegated = formatVisionMarker("a red button", { count: 1, delegated: true, sibling: "grok-4.3" });
    expect(delegated).toContain("grok-4.3");
    expect(delegated).toContain("a red button");

    const fallback = formatVisionMarker(null, { count: 2, delegated: false });
    expect(fallback).toContain("2 images");
    expect(fallback).toContain("grok-4.3");
  });
});
