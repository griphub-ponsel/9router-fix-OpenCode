import { describe, expect, it } from "vitest";

import { getEffectiveModelStrip, modelSupportsImageInput } from "../../open-sse/config/providerModels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("image strip fallback", () => {
  it("auto-strips stale images for GPT-5 text models", () => {
    const stripList = getEffectiveModelStrip("cx", "gpt-5.5");
    expect(modelSupportsImageInput("cx", "gpt-5.5")).toBe(false);
    expect(stripList).toContain("image");
    expect(getEffectiveModelStrip("qw", "vision-model")).not.toContain("image");

    const body = {
      model: "gpt-5.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "continue" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.5",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "codex",
      null,
      stripList,
    );

    expect(result.messages[0].content).toEqual([{ type: "text", text: "continue" }]);
    expect(JSON.stringify(result)).not.toContain("data:image/png");
  });

  it("strips Responses API input_image blocks before translation", () => {
    const body = {
      model: "gpt-5.5",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "continue" },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.5",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "codex",
      null,
      ["image"],
    );

    expect(result.input[0].content).toEqual([{ type: "input_text", text: "continue" }]);
    expect(JSON.stringify(result)).not.toContain("input_image");
  });
});
