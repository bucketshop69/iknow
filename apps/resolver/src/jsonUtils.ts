export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through to extracting an embedded JSON object.
  }

  const start = cleaned.search(/[{[]/);
  if (start === -1) {
    return null;
  }

  const opener = cleaned[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\" && inString) {
      escape = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
    }
    if (depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, index + 1)) as T;
      } catch {
        break;
      }
    }
  }

  return null;
}
