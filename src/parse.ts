/**
 * Parse the relaxed JSON that editors write in practice.
 *
 * Claude Desktop, VS Code, and Kiro all accept `//` and block comments plus
 * trailing commas in their `mcp.json`, and real files carry them — a strict
 * `JSON.parse` refuses configuration those tools consider valid. This module
 * removes exactly those three deviations and then parses strictly, so nothing
 * else about the document is reinterpreted.
 *
 * @module dsh-mcp-json/parse
 */

/**
 * Strip comments and trailing commas from JSON text.
 *
 * Scanning is character-wise with string state, because the sequences being
 * removed are legal *inside* a string: a URL's `//` and a comma before a
 * closing brace in a message must both survive.
 * @param text - the raw document text.
 * @returns text containing only strict JSON tokens, with removed spans
 *   replaced by spaces so byte offsets in parse errors still point at the
 *   original line and column.
 */
export function stripJsonExtras(text: string): string {
  let out = ''
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      out += char
      // A backslash escapes the next character, including a quote, so the
      // pair must be copied together or `\"` would end the string here.
      if (char === '\\' && index + 1 < text.length) {
        out += text[index + 1]
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') {
        // Preserve the line's length so later error positions stay accurate.
        out += ' '
        index += 1
      }
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      const stop = end === -1 ? text.length : end + 2
      for (; index < stop; index += 1) {
        // Newlines inside the comment must survive so line numbers hold.
        out += text[index] === '\n' ? '\n' : ' '
      }
      continue
    }
    if (char === ',') {
      // A comma is trailing when the next token closes its container.
      let lookahead = index + 1
      while (lookahead < text.length && /\s/.test(text[lookahead] ?? '')) lookahead += 1
      const next = text[lookahead]
      if (next === '}' || next === ']') {
        out += ' '
        index += 1
        continue
      }
    }
    out += char
    index += 1
  }
  return out
}

/**
 * Parse one relaxed-JSON document.
 * @param text - the raw document text.
 * @param filename - path reported in the failure message.
 * @returns the parsed value.
 * @throws when the text is not valid JSON even after comments and trailing
 *   commas are removed; the message names the file and the parser's reason.
 */
export function parseJsonc(text: string, filename: string): unknown {
  try {
    return JSON.parse(stripJsonExtras(text))
  } catch (error: unknown) {
    throw new Error(
      `mcp-json: ${filename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
