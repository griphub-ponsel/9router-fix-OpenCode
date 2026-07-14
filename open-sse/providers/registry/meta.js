const metaProvider = {
  id: "meta",
  priority: 35,
  alias: "meta",
  aliases: ["meta-ai", "muse"],
  uiAlias: "meta",
  display: {
    name: "Meta Model API",
    icon: "all_inclusive",
    color: "#0866FF",
    textIcon: "ME",
    logo: "/providers/meta.svg",
    website: "https://dev.meta.ai",
    notice: {
      text: "Official Meta Model API. OpenAI-compatible chat, streaming, multimodal input, reasoning, and tool calling.",
      apiKeyUrl: "https://dev.meta.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  thinkingConfig: {
    options: ["auto", "minimal", "low", "medium", "high", "xhigh"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    {
      id: "muse-spark-1.1",
      name: "Muse Spark 1.1",
      contextTokens: 1048576,
      maxOutputTokens: 131072,
      capabilities: ["text", "image", "video", "pdf", "tools", "reasoning"],
    },
  ],
  modelsFetcher: {
    url: "https://api.meta.ai/v1/models",
    type: "openai",
  },
  passthroughModels: true,
};

export default metaProvider;
