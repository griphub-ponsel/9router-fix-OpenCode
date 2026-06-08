const WRITE_TOOL_NAME = "write";

const FILE_PATH_ALIASES = ["filePath", "filepath", "file_path", "path", "file", "filename"];
const CONTENT_ALIASES = ["content", "contents", "text", "data", "body", "fileContent", "file_content"];

function pickAlias(input, aliases) {
  for (const key of aliases) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function tryParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function escapeControlCharsInJsonStrings(input) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
    } else if (char === '"') {
      output += char;
      inString = false;
    } else if (char === "\n") {
      output += "\\n";
    } else if (char === "\r") {
      output += "\\r";
    } else if (char === "\t") {
      output += "\\t";
    } else {
      output += char;
    }
  }

  return output;
}

function unescapeStructuralQuotes(input) {
  return input
    .replace(/([{[,\s])\\"([^"\\]+)\\"(\s*:)/g, '$1"$2"$3')
    .replace(/(:\s*)\\"/g, '$1"')
    .replace(/\\"(\s*[,}])/g, '"$1');
}

function parseObjectArgument(input) {
  let current = input;

  for (let i = 0; i < 4; i++) {
    const parsed = tryParseJson(current);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    if (typeof parsed === "string" && parsed !== current) {
      current = parsed;
      continue;
    }

    const controlEscaped = escapeControlCharsInJsonStrings(current);
    if (controlEscaped !== current) {
      const repaired = tryParseJson(controlEscaped);
      if (repaired && typeof repaired === "object" && !Array.isArray(repaired)) return repaired;
      if (typeof repaired === "string" && repaired !== current) {
        current = repaired;
        continue;
      }
    }

    const structuralUnescaped = unescapeStructuralQuotes(current);
    if (structuralUnescaped !== current) {
      current = structuralUnescaped;
      continue;
    }

    break;
  }

  return null;
}

function isEndAfterQuote(input, quoteIndex) {
  let i = quoteIndex + 1;
  while (i < input.length && /\s/.test(input[i])) i++;
  return i >= input.length || input[i] === "," || input[i] === "}";
}

function readTolerantString(input, start) {
  let output = "";

  for (let i = start; i < input.length; i++) {
    const char = input[i];

    if (char === '"') {
      if (isEndAfterQuote(input, i)) return output;
      output += char;
      continue;
    }

    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = input[i + 1];
    if (next === undefined) {
      output += char;
      continue;
    }

    if (next === '"' && isEndAfterQuote(input, i + 1)) return output;

    if (next === '"') output += '"';
    else if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 2, i + 6))) {
      output += String.fromCharCode(parseInt(input.slice(i + 2, i + 6), 16));
      i += 4;
    } else {
      output += next;
    }
    i++;
  }

  return undefined;
}

function extractAlias(input, aliases) {
  for (const key of aliases) {
    const match = new RegExp(`\\\\?"${key}\\\\?"\\s*:\\s*\\\\?"`).exec(input);
    if (!match) continue;

    const value = readTolerantString(input, match.index + match[0].length);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function extractWriteInput(input) {
  const filePath = extractAlias(input, FILE_PATH_ALIASES);
  const content = extractAlias(input, CONTENT_ALIASES);
  if (filePath === undefined || content === undefined) return null;
  return { filePath, content };
}

export function normalizeToolInput(toolName, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  if (String(toolName || "").toLowerCase() !== WRITE_TOOL_NAME) return input;

  let normalized = input;
  const filePath = pickAlias(input, FILE_PATH_ALIASES);
  const content = pickAlias(input, CONTENT_ALIASES);

  if (input.filePath === undefined && filePath !== undefined) {
    normalized = { ...normalized, filePath };
  }

  if (input.content === undefined && content !== undefined) {
    normalized = { ...normalized, content };
  }

  return normalized;
}

export function stringifyToolArguments(toolName, input) {
  if (input === undefined) return null;

  if (typeof input === "string") {
    const parsed = parseObjectArgument(input);
    if (parsed) {
      return JSON.stringify(normalizeToolInput(toolName, parsed));
    }

    if (String(toolName || "").toLowerCase() === WRITE_TOOL_NAME) {
      const extracted = extractWriteInput(input);
      if (extracted) return JSON.stringify(extracted);
    }

    return input;
  }

  if (typeof input === "object") {
    return JSON.stringify(normalizeToolInput(toolName, input));
  }

  return null;
}
