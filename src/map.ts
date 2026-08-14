/**
 * Map a Claude-style `mcp.json` entry onto the harness MCP client's config.
 *
 * The two vocabularies differ in three ways, and each mismatch is resolved
 * here rather than at the connection: the field is `type` versus `transport`,
 * HTTP is spelled `http` versus `streamable-http`, and a stdio entry commonly
 * omits its type entirely. A name the client would refuse is reported with the
 * file that supplied it, because that is the only actionable diagnosis.
 *
 * @module dsh-mcp-json/map
 */

import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { DiscoveredServer } from './types.ts'

/** Server names the MCP client accepts as a tool-name namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** `type` values that select the HTTP transport. */
const HTTP_TYPES = new Set(['http', 'streamable-http', 'sse'])
/** `type` values that select the stdio transport. */
const STDIO_TYPES = new Set(['stdio'])

/** Why one entry cannot be mounted, phrased for the user who wrote the file. */
export class McpJsonEntryError extends Error {
  constructor(server: DiscoveredServer, reason: string) {
    super(`mcp-json: server "${server.name}" in ${server.source} ${reason}`)
    this.name = 'McpJsonEntryError'
  }
}

/**
 * Translate one discovered entry into MCP client configuration.
 * @param server - the discovered entry and its source file.
 * @param defaultCwd - working directory for a stdio entry that names none.
 * @returns configuration ready for `ctx.plugin()`.
 * @throws {@link McpJsonEntryError} when the name is unusable, the transport is
 *   unrecognized, or the entry omits the field its transport requires.
 */
export function toClientConfig(server: DiscoveredServer, defaultCwd: string): McpClientConfig {
  const { name, entry } = server
  if (!SERVER_NAME_PATTERN.test(name)) {
    throw new McpJsonEntryError(
      server,
      `has a name the harness cannot use as a tool namespace; names must match ${String(SERVER_NAME_PATTERN)}`,
    )
  }

  // An entry naming no type but carrying a command is the common stdio form.
  const declared = entry.type?.toLowerCase()
  const transport = declared === undefined
    ? (entry.url !== undefined ? 'http' : 'stdio')
    : declared

  if (HTTP_TYPES.has(transport)) {
    if (entry.url === undefined || entry.url.length === 0) {
      throw new McpJsonEntryError(server, 'declares an HTTP transport but names no "url"')
    }
    return {
      transport: 'streamable-http',
      serverName: name,
      url: entry.url,
      headers: entry.headers ?? {},
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }

  if (STDIO_TYPES.has(transport)) {
    if (entry.command === undefined || entry.command.length === 0) {
      throw new McpJsonEntryError(server, 'declares a stdio transport but names no "command"')
    }
    return {
      transport: 'stdio',
      serverName: name,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env ?? {},
      cwd: entry.cwd ?? defaultCwd,
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
  }

  throw new McpJsonEntryError(
    server,
    `declares an unsupported transport "${entry.type ?? ''}"; use "stdio" or "http"`,
  )
}

/**
 * Whether an entry asks not to be mounted.
 * @param server - the discovered entry.
 * @returns true when the document switched this server off.
 */
export function isDisabled(server: DiscoveredServer): boolean {
  return server.entry.disabled === true
}
