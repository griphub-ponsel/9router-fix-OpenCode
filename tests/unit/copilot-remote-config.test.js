import { describe, expect, it } from "vitest";
import {
  applyCopilotByokUtilitySettings,
  buildCopilotAuthorizationHeaders,
  buildCopilotManualUtilitySettings,
} from "../../src/app/api/cli-tools/copilot-settings/copilotConfig.mjs";

describe("Copilot remote Custom Endpoint config", () => {
  it("generates an explicit bearer header for remote requests", () => {
    expect(buildCopilotAuthorizationHeaders("secret-key")).toEqual({
      Authorization: "Bearer secret-key",
    });
  });

  it("uses the selected BYOK main agent for utility tasks", () => {
    expect(applyCopilotByokUtilitySettings({
      "chat.utilityModel": "customendpoint/qwen3.7-plus",
      "chat.utilitySmallModel": "customendpoint/minimax-m3",
      "editor.fontSize": 14,
    }, true)).toEqual({
      "chat.byokUtilityModelDefault": "mainAgent",
      "editor.fontSize": 14,
    });
  });

  it("clears every 9Router utility override when disabled", () => {
    expect(applyCopilotByokUtilitySettings({
      "chat.byokUtilityModelDefault": "mainAgent",
      "chat.utilityModel": "customendpoint/stale-model",
    }, false)).toEqual({});
  });

  it("matches the manual settings snippet", () => {
    expect(buildCopilotManualUtilitySettings(true)).toEqual({
      "chat.byokUtilityModelDefault": "mainAgent",
    });
  });
});