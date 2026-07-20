const CUSTOM_VALUE = "__custom__";

const normalizeUrl = (url) => String(url || "").trim().replace(/\/+$/, "");

export function resolveConfiguredApiBaseUrl(url) {
  return normalizeUrl(url).replace(/\/chat\/completions$/, "");
}

export function resolveInitialEndpointSelection(options, persistedValue) {
  const persisted = normalizeUrl(persistedValue);
  if (persisted) {
    const matched = options.find((option) => normalizeUrl(option.url) === persisted);
    if (matched) return { mode: matched.value, url: matched.url, customInput: "" };
    return { mode: CUSTOM_VALUE, url: String(persistedValue).trim(), customInput: String(persistedValue).trim() };
  }

  const first = options.find((option) => option.value !== CUSTOM_VALUE);
  if (first) return { mode: first.value, url: first.url, customInput: "" };
  return { mode: CUSTOM_VALUE, url: "", customInput: "" };
}
