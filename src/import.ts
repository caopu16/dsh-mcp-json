/**
 * Collect the servers the other agent tools declare into the harness's own
 * document, as one explicit action.
 *
 * This is deliberately not something the plugin does on its own. A document
 * that is rewritten from the other tools on every start cannot also be a
 * document you edit: your additions would be overwritten, and a borrowed
 * server you deleted would come back on the next reconcile. Importing once,
 * when you ask for it, leaves the file yours afterwards — set `borrow: false`
 * and the other tools' files stop being read at all.
 *
 * A name already present in the target is kept rather than replaced, because
 * the entry you wrote is the more specific statement about that server. `force`
 * inverts that for the case where you do want the tools' current version back.
 *
 * @module dsh-mcp-json/import
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { discover, layerSources } from './discover.ts'
import { parseJsonc } from './parse.ts'
import type { McpJsonDocument, McpJsonServer } from './types.ts'

/** What became of one server name during a merge. */
export interface ImportDecision {
  name: string
  /** `added` wrote it, `replaced` overwrote an existing entry, `kept` left one alone. */
  outcome: 'added' | 'replaced' | 'kept'
  /** Absolute path of the file the discovered entry came from. */
  source: string
}

/** The merged server map and what happened to each name. */
export interface MergeResult {
  servers: Record<string, McpJsonServer>
  decisions: ImportDecision[]
}

/**
 * Merge discovered servers into an existing server map.
 * @param existing - the target document's current `mcpServers`.
 * @param discovered - borrowed servers by name, each with the file it came from.
 * @param force - whether a discovered entry replaces one already present.
 * @returns the new server map and a decision per discovered name.
 */
export function mergeServers(
  existing: Record<string, McpJsonServer>,
  discovered: Map<string, { entry: McpJsonServer; source: string }>,
  force = false,
): MergeResult {
  const servers: Record<string, McpJsonServer> = { ...existing }
  const decisions: ImportDecision[] = []
  for (const [name, { entry, source }] of discovered) {
    const present = Object.hasOwn(servers, name)
    if (present && !force) {
      decisions.push({ name, outcome: 'kept', source })
      continue
    }
    servers[name] = entry
    decisions.push({ name, outcome: present ? 'replaced' : 'added', source })
  }
  return { servers, decisions }
}

/** Outcome of an import run, for the caller to report. */
export interface ImportReport extends MergeResult {
  /** Absolute path written, or that would be written on a dry run. */
  target: string
  /** Layers that existed but could not be read, so the report is honest. */
  failures: { path: string; tool: string; failure: string }[]
  /** Whether the file was actually written. */
  written: boolean
  /**
   * Servers a borrowed layer declared that the harness's own documents already
   * define, and so were not candidates. This is what a second import run sees:
   * the target now outranks the file each server came from, which is the point
   * of having imported them, not an absence of servers to find.
   */
  alreadyOwn: number
}

/**
 * Read every borrowed layer and merge it into the harness's own document.
 *
 * Servers already defined in one of the harness's own two documents are not
 * imported: they are the destination, not a source, and copying one back would
 * make the file appear to have gained an entry it always had.
 * @param options - target path, project directory, and merge behaviour.
 * @returns what was found, what was decided, and whether the write happened.
 */
export async function runImport(options: {
  target: string
  cwd: string
  force?: boolean
  dryRun?: boolean
}): Promise<ImportReport> {
  const { target, cwd } = options
  const own = new Set(
    layerSources(target, cwd).filter(source => source.tool === 'dsh').map(source => source.path),
  )
  const { layers, servers } = await discover(target, cwd)

  // Every name a borrowed layer declared, whether or not it won the merge, so a
  // server the target has since taken over can be told from one nobody declares.
  const borrowedNames = new Set(
    layers.filter(layer => !own.has(layer.path)).flatMap(layer => layer.servers.map(server => server.name)),
  )

  const discovered = new Map<string, { entry: McpJsonServer; source: string }>()
  let alreadyOwn = 0
  for (const server of servers.values()) {
    if (own.has(server.source)) {
      // Named by a borrowed layer too, but the harness's own document is what
      // defines it now — the normal state of every previously imported server.
      if (borrowedNames.has(server.name)) alreadyOwn += 1
      continue
    }
    discovered.set(server.name, { entry: server.entry, source: server.source })
  }

  let document: McpJsonDocument = {}
  try {
    const text = await readFile(target, 'utf8')
    const parsed = parseJsonc(text, target)
    // A target that is not an object would be silently replaced otherwise, and
    // whatever it held is more likely a mistake to look at than to overwrite.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`mcp-json: ${target} does not contain a JSON object`)
    }
    document = parsed as McpJsonDocument
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const { servers: merged, decisions } = mergeServers(document.mcpServers ?? {}, discovered, options.force)
  const changed = decisions.some(decision => decision.outcome !== 'kept')
  const written = changed && options.dryRun !== true
  if (written) {
    // The target's directory need not exist yet: importing is often the first
    // thing done on a fresh machine, before the plugin has ever run.
    await mkdir(dirname(target), { recursive: true })
    // Other top-level keys survive: this document is the user's, and the import
    // only claims the `mcpServers` section.
    await writeFile(target, `${JSON.stringify({ ...document, mcpServers: merged }, undefined, 2)}\n`)
  }

  return {
    target,
    servers: merged,
    decisions,
    alreadyOwn,
    failures: layers
      .filter(layer => layer.failure !== undefined)
      .map(layer => ({ path: layer.path, tool: layer.tool, failure: layer.failure ?? '' })),
    written,
  }
}
