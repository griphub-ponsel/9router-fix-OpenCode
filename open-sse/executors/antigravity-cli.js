import { GeminiCLIExecutor } from "./gemini-cli.js";
import { PROVIDERS } from "../config/providers.js";

export class AntigravityCLIExecutor extends GeminiCLIExecutor {
  constructor() {
    // Call BaseExecutor constructor directly via super chain
    // GeminiCLIExecutor calls super("gemini-cli", PROVIDERS["gemini-cli"])
    // We need to override provider and config after construction
    super();
    this.provider = "antigravity-cli";
    this.config = PROVIDERS["antigravity-cli"];
  }

  async refreshCredentials(credentials, log) {
    const result = await super.refreshCredentials(credentials, log);
    if (result) {
      log?.info?.("TOKEN", "Antigravity CLI refreshed");
    }
    return result;
  }
}

export default AntigravityCLIExecutor;
