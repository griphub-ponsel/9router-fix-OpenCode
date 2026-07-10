import { describe, expect, it } from "vitest";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

describe("GPT 5.6 pricing", () => {
  it("keeps exact Luna, Terra, and Sol rates", () => {
    expect(MODEL_PRICING["gpt-5.6-luna"]).toMatchObject({ input: 1, output: 6 });
    expect(MODEL_PRICING["gpt-5.6-terra"]).toMatchObject({ input: 2.5, output: 15 });
    expect(MODEL_PRICING["gpt-5.6-sol"]).toMatchObject({ input: 5, output: 30 });
  });
});