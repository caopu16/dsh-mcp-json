/**
 * The Claude-style `mcp.json` document as it appears on disk, plus the two
 * other dialects that describe the same servers differently.
 *
 * @module dsh-mcp-json/types
 */

/** One server entry, with every field optional because the file is user-authored. */
export interface McpJsonServer {
  /**
   * Transport selector as the Claude-family tools spell it. Absent means
   * stdio, which is how a `command` entry with no `type` is written in practice.
   */
  type?: string
  /** Executable for a stdio server. */
  command?: string
  /** Arguments passed to {@link command} without shell interpolation. */
  args?: string[]
  /** Extra environment variables for a stdio child. */
  env?: Record<string, string>
  /** Working directory for a stdio child. */
  cwd?: string
  /** Endpoint URL for an HTTP server. */
  url?: string
  /** Additional headers for an HTTP server. */
  headers?: Record<string, string>
  /** Whether this entry is switched off; a disabled server is not mounted. */
  disabled?: boolean
  /**
   * Tool names the authoring editor pre-approves. Recorded here for
   * documentation only: tool approval in the harness belongs to the approval
   * capability, which this plugin does not speak for.
   */
  autoApprove?: string[]
}

/** The Claude / Kiro document: one map of server name to entry. */
export interface McpJsonDocument {
  mcpServers?: Record<string, McpJsonServer>
}

/**
 * The OpenCode dialect. Servers live under `mcp`, the transport tag is
 * `local`/`remote`, `command` is one argv array rather than a command plus
 * args, and the on/off field is `enabled` rather than `disabled`.
 */
export interface OpenCodeServer {
  type?: string
  /** Full argv: the executable followed by its arguments. */
  command?: string[]
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  /** Whether this server is switched on; absent means on. */
  enabled?: boolean
}

/** An OpenCode configuration document; only its `mcp` section is read. */
export interface OpenCodeDocument {
  mcp?: Record<string, OpenCodeServer>
}

/**
 * The Codex dialect: TOML with an `[mcp_servers.<name>]` table per server.
 * Field names match the Claude form once parsed, so only the container and the
 * file format differ.
 */
export interface CodexDocument {
  mcp_servers?: Record<string, McpJsonServer>
}

/** Which dialect a discovered file speaks. */
export type McpDialect = 'claude' | 'opencode' | 'codex'

/** One discovered server, carrying the layer it came from for diagnostics. */
export interface DiscoveredServer {
  /** Server name as written in the document, used as the tool-name namespace. */
  name: string
  /** The entry normalized to the Claude field vocabulary. */
  entry: McpJsonServer
  /** Absolute path of the file that supplied this entry. */
  source: string
}
