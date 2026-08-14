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

import type {
  CodexDocument,
  McpDialect,
  McpJsonDocument,
  McpJsonServer,
  OpenCodeDocument,
  OpenCodeServer,
} from './types.ts'

/** Whether a parsed value can carry server entries. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert one OpenCode entry to the Claude vocabulary.
 * @param entry - the entry as written under `mcp`.
 * @returns the same server in Claude field names.
 */
function fromOpenCode(entry: OpenCodeServer): McpJsonServer {
  // OpenCode's `command` is full argv; the harness client wants the executable
  // and its arguments separately.
  const [command, ...args] = entry.command ?? []
  const remote = entry.type === 'remote' || (entry.type === undefined && entry.url !== undefined)
  return {
    type: remote ? 'http' : 'stdio',
    ...command === undefined ? {} : { command },
    ...args.length > 0 ? { args } : {},
    ...entry.environment === undefined ? {} : { env: entry.environment },
    ...entry.url === undefined ? {} : { url: entry.url },
    ...entry.headers === undefined ? {} : { headers: entry.headers },
    // `enabled: false` is the same statement as `disabled: true`; absence means on.
    ...entry.enabled === false ? { disabled: true } : {},
  }
}

/**
 * Extract the server map from one parsed document, whatever dialect it speaks.
 * @param document - the parsed file contents.
 * @param dialect - which dialect this file's path implies.
 * @returns server entries in the Claude vocabulary, or `undefined` when the
 *   document has no server section at all (a valid state for a shared config
 *   file that simply declares no MCP servers).
 * @throws when the document's server section exists but is not a table.
 */
export function normalizeDocument(
  document: unknown,
  dialect: McpDialect,
): Record<string, McpJsonServer> | undefined {
  if (!isRecord(document)) throw new Error('does not contain a JSON object')

  if (dialect === 'opencode') {
    const section = (document as OpenCodeDocument).mcp
    if (section === undefined) return undefined
    if (!isRecord(section)) throw new Error('has an "mcp" section that is not an object')
    return Object.fromEntries(
      Object.entries(section)
        .filter((pair): pair is [string, OpenCodeServer] => isRecord(pair[1]))
        .map(([name, entry]) => [name, fromOpenCode(entry)]),
    )
  }

  const key = dialect === 'codex' ? 'mcp_servers' : 'mcpServers'
  const section = dialect === 'codex'
    ? (document as CodexDocument).mcp_servers
    : (document as McpJsonDocument).mcpServers
  if (section === undefined) return undefined
  if (!isRecord(section)) throw new Error(`has a "${key}" section that is not an object`)
  return Object.fromEntries(
    Object.entries(section).filter((pair): pair is [string, McpJsonServer] => isRecord(pair[1])),
  )
}
