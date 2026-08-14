/**
 * Normalize each supported agent tool's MCP configuration dialect onto the
 * Claude field vocabulary, so discovery and mapping speak one shape.
 *
 * Three dialects describe the same servers. Claude and Kiro write
 * `mcpServers` with a `command` string plus `args`. OpenCode writes `mcp` with
 * one argv array, `environment` instead of `env`, `local`/`remote` instead of
 * `stdio`/`http`, and `enabled` instead of `disabled`. Codex writes TOML tables
 * under `mcp_servers` whose fields already match the Claude names.
 *
 * @module dsh-mcp-json/dialect
 */
import type { McpDialect, McpJsonServer } from './types.ts';
/**
 * Extract the server map from one parsed document, whatever dialect it speaks.
 * @param document - the parsed file contents.
 * @param dialect - which dialect this file's path implies.
 * @returns server entries in the Claude vocabulary, or `undefined` when the
 *   document has no server section at all (a valid state for a shared config
 *   file that simply declares no MCP servers).
 * @throws when the document's server section exists but is not a table.
 */
export declare function normalizeDocument(document: unknown, dialect: McpDialect): Record<string, McpJsonServer> | undefined;
