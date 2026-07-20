import { describe, expect, it } from "vitest";
import { resolveConfiguredApiBaseUrl, resolveInitialEndpointSelection } from "../../src/app/(dashboard)/dashboard/cli-tools/components/baseUrlSelection.js";

const options = [
  { value: "local", url: "http://127.0.0.1:20128/v1" },
  { value: "tailscale", url: "https://macs-mac-mini.tail59be96.ts.net/v1" },
  { value: "__custom__", url: "" },
];

describe("configured API base URL", () => {
  it("strips the chat-completions suffix read from chatLanguageModels.json", () => {
    expect(resolveConfiguredApiBaseUrl("https://macs-mac-mini.tail59be96.ts.net/v1/chat/completions")).toBe(
      "https://macs-mac-mini.tail59be96.ts.net/v1",
    );
  });
});

describe("BaseUrlSelect initial endpoint", () => {
  it("restores the persisted Tailscale endpoint instead of resetting to local", () => {
    expect(resolveInitialEndpointSelection(options, "https://macs-mac-mini.tail59be96.ts.net/v1")).toEqual({
      mode: "tailscale",
      url: "https://macs-mac-mini.tail59be96.ts.net/v1",
      customInput: "",
    });
  });

  it("uses local only when no endpoint was persisted", () => {
    expect(resolveInitialEndpointSelection(options, "")).toEqual({
      mode: "local",
      url: "http://127.0.0.1:20128/v1",
      customInput: "",
    });
  });

  it("restores an unknown persisted endpoint as a custom URL", () => {
    expect(resolveInitialEndpointSelection(options, "https://example.com/v1")).toEqual({
      mode: "__custom__",
      url: "https://example.com/v1",
      customInput: "https://example.com/v1",
    });
  });
});
