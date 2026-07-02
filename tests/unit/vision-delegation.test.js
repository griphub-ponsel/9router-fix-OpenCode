import { describe, expect, it } from "vitest";

import {
  needsVisionDelegation,
  getVisionSibling,
  findAutoVisionTarget,
  buildAutoVisionFallback,
  isImageUnsupportedError,
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
    expect(delegated).toContain("a red button");
    // First-person framing: must not leak the relay mechanism to the model
    expect(delegated).not.toContain("relay");
    expect(delegated).not.toContain("grok-4.3");
    expect(delegated).toContain("direct visual perception");

    const fallback = formatVisionMarker(null, { count: 2, delegated: false });
    expect(fallback).toContain("2 images");
    expect(fallback).toContain("grok-4.3");
  });

  it("detects upstream image-unsupported errors across providers", () => {
    // xAI
    expect(isImageUnsupportedError(400, 'Invalid request content: Image inputs are not supported by this model.')).toBe(true);
    // OpenRouter-style (the xiaomi-mimo 404)
    expect(isImageUnsupportedError(404, 'data:{"error":{"code":"404","message":"No endpoints found that support image input"')).toBe(true);
    // Generic phrasings
    expect(isImageUnsupportedError(400, "This model does not support image input")).toBe(true);
    expect(isImageUnsupportedError(422, "vision is not supported for this model")).toBe(true);
    expect(isImageUnsupportedError(400, "Unsupported content type: image_url")).toBe(true);
    // Gateways wrap upstream 400s in 5xx envelopes — explicit image wording still matches
    expect(isImageUnsupportedError(502, "image inputs are not supported")).toBe(true);
    // Auth / rate-limit / timeout are never modality errors
    expect(isImageUnsupportedError(429, "image rate limit: not supported plan")).toBe(false);
    expect(isImageUnsupportedError(401, "unauthorized")).toBe(false);
    expect(isImageUnsupportedError(400, "context length exceeded")).toBe(false);
    expect(isImageUnsupportedError(400, "")).toBe(false);
  });

  it("detects generic content-shape rejections only when the request had images", () => {
    // alibaba/DashScope via Vercel gateway (the qwen3.7-max bug) — wrapped in a
    // stream_initialization_failed envelope, no "image" wording at all
    const alibaba = '<400> InternalError.Algo.InvalidParameter: The provided messages input is invalid. The error info is [Unexpected item type in content.].';
    expect(isImageUnsupportedError(400, alibaba, true)).toBe(true);
    // gateways may surface it under a 5xx outer status
    expect(isImageUnsupportedError(500, alibaba, true)).toBe(true);
    // without images in the request, generic shape errors do NOT trigger
    expect(isImageUnsupportedError(400, alibaba, false)).toBe(false);
    // other generic phrasings
    expect(isImageUnsupportedError(400, "unknown content type in message", true)).toBe(true);
    expect(isImageUnsupportedError(422, "invalid message format", true)).toBe(true);
    // named non-image causes never trigger even with images
    expect(isImageUnsupportedError(400, "messages input is invalid: maximum context length exceeded", true)).toBe(false);
    expect(isImageUnsupportedError(400, "invalid message format: tools schema required field missing", true)).toBe(false);
    expect(isImageUnsupportedError(400, "some totally unrelated error", true)).toBe(false);
  });

  it("auto-discovers a vision relay target on the same provider", () => {
    // Hardcoded sibling wins
    expect(findAutoVisionTarget("xai-oauth", "grok-code-fast-1")).toBe("grok-4.3");
    // Never returns the model that just failed
    expect(findAutoVisionTarget("xai-oauth", "grok-4.3")).not.toBe("grok-4.3");
    // Unknown provider → null (no registry models)
    expect(findAutoVisionTarget("nonexistent-provider", "x")).toBe(null);
  });

  it("builds a cross-provider auto fallback list from connected providers", () => {
    const list = buildAutoVisionFallback(["xai-oauth", "nonexistent-provider"], null);
    expect(list).toContain("xai-oauth/grok-4.3");
    expect(list.some((m) => m.startsWith("nonexistent-provider/"))).toBe(false);
    // Excludes the current provider (same-provider is handled separately)
    expect(buildAutoVisionFallback(["xai-oauth"], "xai-oauth")).toEqual([]);
    expect(buildAutoVisionFallback(null, "x")).toEqual([]);
  });
});
