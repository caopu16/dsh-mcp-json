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
export declare function stripJsonExtras(text: string): string;
/**
 * Parse one relaxed-JSON document.
 * @param text - the raw document text.
 * @param filename - path reported in the failure message.
 * @returns the parsed value.
 * @throws when the text is not valid JSON even after comments and trailing
 *   commas are removed; the message names the file and the parser's reason.
 */
export declare function parseJsonc(text: string, filename: string): unknown;
