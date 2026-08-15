/**
 * Discover MCP servers across every supported agent tool's configuration
 * location, nearest file winning.
 *
 * Layers stack in increasing specificity: the user-level documents of each
 * supported tool, then the project-level ones. A server name present in more
 * than one layer is defined by the most specific file, so a checkout can
 * redirect one server without restating the rest, and one machine's tools can
 * disagree without either configuration being edited.
 *
 * A missing file is not an error — that is the normal state of every tool a
 * given machine does not use. An unreadable or malformed file IS reported,
 * because silently ignoring it would present a configuration the user did not
 * write.
 *
 * @module dsh-mcp-json/discover
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { normalizeDocument } from './dialect.ts'
import { parseJsonc } from './parse.ts'
import type { DiscoveredServer, McpDialect } from './types.ts'

/** One configuration location: where to look and which dialect to expect. */
export interface LayerSource {
  /** Absolute path of the document. */
  path: string
  /** Dialect the file speaks. */
  dialect: McpDialect
  /** Tool whose convention this path follows, named in diagnostics. */
  tool: string
}

/**
 * User-level locations, relative to the home directory. Order within this
 * group decides which tool wins when two of them name the same server; the
 * harness's own document is last so it can override a borrowed configuration.
 */
const USER_SOURCES: readonly { readonly relative: string; readonly dialect: McpDialect; readonly tool: string }[] = [
  { relative: '.claude.json', dialect: 'claude', tool: 'claude-code' },
  { relative: '.codex/config.toml', dialect: 'codex', tool: 'codex' },
  { relative: '.kiro/settings/mcp.json', dialect: 'claude', tool: 'kiro' },
  { relative: '.config/opencode/opencode.json', dialect: 'opencode', tool: 'opencode' },
  { relative: '.config/opencode/opencode.jsonc', dialect: 'opencode', tool: 'opencode' },
]

/** Project-level locations, relative to the project directory. */
const PROJECT_SOURCES: readonly { readonly relative: string; readonly dialect: McpDialect; readonly tool: string }[] = [
  { relative: '.mcp.json', dialect: 'claude', tool: 'claude-code' },
  { relative: '.kiro/settings/mcp.json', dialect: 'claude', tool: 'kiro' },
  { relative: '.opencode/opencode.json', dialect: 'opencode', tool: 'opencode' },
  { relative: '.opencode/opencode.jsonc', dialect: 'opencode', tool: 'opencode' },
  { relative: '.codex/config.toml', dialect: 'codex', tool: 'codex' },
]

/** The harness's own user-level document, which outranks every borrowed one. */
export const DEFAULT_USER_PATH = '~/.dsh/mcp.json'
/** The harness's own project-level document, the most specific layer of all. */
const PROJECT_DSH_PATH = '.dsh/mcp.json'

/** One layer's outcome: its servers, or the reason the file was refused. */
export interface LayerResult extends LayerSource {
  /** Servers the file declared, empty when the file is absent. */
  servers: DiscoveredServer[]
  /** Why the file was skipped, when it existed but could not be used. */
  failure?: string
}

/**
 * Read and parse one layer.
 * @param source - the path and dialect to read.
 * @returns the layer's servers, or a failure describing why it was skipped.
 */
export async function readLayer(source: LayerSource): Promise<LayerResult> {
  let text: string
  try {
    text = await readFile(source.path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...source, servers: [] }
    return { ...source, servers: [], failure: `cannot be read: ${(error as Error).message}` }
  }
  let document: unknown
  try {
    document = source.dialect === 'codex' ? parseToml(text) : parseJsonc(text, source.path)
  } catch (error: unknown) {
    return { ...source, servers: [], failure: (error as Error).message }
  }
  let entries: Record<string, import('./types.ts').McpJsonServer> | undefined
  try {
    entries = normalizeDocument(document, source.dialect)
  } catch (error: unknown) {
    return { ...source, servers: [], failure: `mcp-json: ${source.path} ${(error as Error).message}` }
  }
  if (entries === undefined) return { ...source, servers: [] }
  return {
    ...source,
    servers: Object.entries(entries).map(([name, entry]) => ({ name, entry, source: source.path })),
  }
}

/** Contents written for a document that does not exist yet. */
const EMPTY_DOCUMENT = '{\n  "mcpServers": {}\n}\n'

/**
 * Create the harness's own user-level document when it is absent, so the file
 * to edit is always on disk.
 *
 * Written with `wx`: an existing document is never rewritten, and the check and
 * the write are one operation, so a concurrently started process cannot clobber
 * servers the other just wrote.
 * @param path - absolute path of the document to create.
 * @returns the path when this call created it, `undefined` when it already existed.
 */
export async function ensureDocument(path: string): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, EMPTY_DOCUMENT, { flag: 'wx' })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined
    throw error
  }
  return path
}

/** Expand a leading `~` against the user's home directory. */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve every layer to read, least specific first.
 * @param userPath - the harness's own user document, absolute, `~`-prefixed, or
 *   relative to `cwd`.
 * @param cwd - the project directory the project layers resolve against.
 * @param borrow - whether to read the other tools' documents; `false` restricts
 *   discovery to the harness's own two files.
 * @returns the ordered layer sources.
 */
export function layerSources(userPath: string, cwd: string, borrow = true): LayerSource[] {
  const home = homedir()
  const expanded = expandHome(userPath)
  const sources: LayerSource[] = []
  if (borrow) {
    for (const entry of USER_SOURCES) {
      sources.push({ path: join(home, entry.relative), dialect: entry.dialect, tool: entry.tool })
    }
  }
  sources.push({
    path: isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
    dialect: 'claude',
    tool: 'dsh',
  })
  if (borrow) {
    for (const entry of PROJECT_SOURCES) {
      sources.push({ path: resolve(cwd, entry.relative), dialect: entry.dialect, tool: entry.tool })
    }
  }
  sources.push({ path: resolve(cwd, PROJECT_DSH_PATH), dialect: 'claude', tool: 'dsh' })
  return sources
}

/** Every layer's outcome plus the merged server set. */
export interface Discovery {
  /** Per-layer results in application order, for diagnostics. */
  layers: LayerResult[]
  /** Merged servers by name; the most specific layer's entry wins. */
  servers: Map<string, DiscoveredServer>
}

/**
 * Read every layer and merge them.
 * @param userPath - the harness's own user document path.
 * @param cwd - the project directory.
 * @param borrow - whether to read the other tools' documents.
 * @returns each layer's outcome and the merged server map.
 */
export async function discover(userPath: string, cwd: string, borrow = true): Promise<Discovery> {
  const sources = layerSources(userPath, cwd, borrow)
  // A duplicate path appears when one tool's project and user locations
  // coincide (a checkout opened at the home directory); reading it once keeps
  // its servers from being attributed to two layers.
  const seen = new Set<string>()
  const unique = sources.filter(source => !seen.has(source.path) && seen.add(source.path))
  const layers = await Promise.all(unique.map(readLayer))
  const servers = new Map<string, DiscoveredServer>()
  for (const layer of layers) {
    // Later layers overwrite by name: the list is in application order, so the
    // last writer is the most specific file that named this server.
    for (const server of layer.servers) servers.set(server.name, server)
  }
  return { layers, servers }
}
