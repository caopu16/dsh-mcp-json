/**
 * Mount one `@deepseek-ai/dsh-mcp-client` instance per server declared in the
 * Claude-style `mcp.json` layers, and keep that set in step with the files.
 *
 * The MCP client is deliberately one instance per server and reads no files;
 * this plugin supplies the configuration discovery it does not do. Mounting is
 * `ctx.plugin()` rather than composition rows, so adding a server means editing
 * JSON instead of the profile's plugin tree.
 *
 * Reconciliation is per server, not per file: a changed document disposes and
 * remounts only the servers whose configuration actually differs, so editing
 * one entry does not interrupt the others' connections or their registered
 * tools. Server identity is the name, which is also the tool-name namespace.
 *
 * @module dsh-mcp-json
 */

import { isAbsolute, resolve } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import type { FSWatcher } from 'chokidar'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_USER_PATH, discover, ensureDocument, expandHome, layerSources } from './discover.ts'
import { isDisabled, McpJsonEntryError, toClientConfig } from './map.ts'

export { DEFAULT_USER_PATH, discover, ensureDocument, expandHome, layerSources, readLayer } from './discover.ts'
export type { Discovery, LayerResult, LayerSource } from './discover.ts'
export { normalizeDocument } from './dialect.ts'
export { isDisabled, McpJsonEntryError, toClientConfig } from './map.ts'
export { parseJsonc, stripJsonExtras } from './parse.ts'
export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-json'

/**
 * The MCP client registers on `ctx.tools`, so this plugin waits for the same
 * service before mounting anything: a child mounted without it would fail on
 * its own rather than wait.
 */
export const inject = ['tools']

/** Quiet period after a file event before re-reading, coalescing editor writes. */
const DEFAULT_DEBOUNCE_MS = 150

/** Plugin config. */
export interface Config {
  /**
   * User-level document, `~` expanded, resolved against `cwd` when relative.
   * Defaults to `~/.dsh/mcp.json`.
   */
  userPath?: string
  /**
   * Project directory the project-level layers resolve against. Defaults to
   * the process working directory.
   */
  cwd?: string
  /**
   * Whether to read the other agent tools' documents (Claude Code, Kiro,
   * OpenCode, Codex) in addition to the harness's own two. `false` restricts
   * discovery to `userPath` and `<cwd>/.dsh/mcp.json`.
   */
  borrow?: boolean
  /**
   * Whether to create `userPath` with an empty `mcpServers` when it is absent,
   * so the document to edit always exists (default true). Only this path is
   * created: the other layers belong to other tools or to a checkout.
   */
  createUserPath?: boolean
  /** Whether to reload when a document changes (default true). */
  watch?: boolean
  /** Quiet period after a file event before re-reading (default 150ms). */
  debounceMs?: number
}

export const Config: z<Config> = z.object({
  userPath: z.string().default(DEFAULT_USER_PATH),
  cwd: z.string(),
  borrow: z.boolean().default(true),
  createUserPath: z.boolean().default(true),
  watch: z.boolean().default(true),
  debounceMs: z.number().min(0).default(DEFAULT_DEBOUNCE_MS),
})

/** One mounted server: its fiber and the config identity that produced it. */
interface Mounted {
  fiber: Fiber
  /** Serialized config, compared to decide whether a remount is required. */
  signature: string
}

export function apply(ctx: Context, config: Config): void {
  const cwd = config.cwd ?? process.cwd()
  const expanded = expandHome(config.userPath ?? DEFAULT_USER_PATH)
  const userPath = isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
  const borrow = config.borrow ?? true
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const mounted = new Map<string, Mounted>()

  /**
   * Bring the mounted set in line with the documents.
   *
   * Each layer's failure is reported once per reconcile rather than thrown: one
   * malformed project file must not take down servers the other layers define,
   * and the user needs the remaining servers to keep working while they fix it.
   */
  const reconcile = async (): Promise<void> => {
    const { layers, servers } = await discover(userPath, cwd, borrow)
    for (const layer of layers) {
      if (layer.failure !== undefined) {
        ctx.logger.warn(`mcp-json: skipping ${layer.tool} config ${layer.path} — ${layer.failure}`)
      }
    }

    const desired = new Map<string, { signature: string; clientConfig: McpClient.Config }>()
    for (const server of servers.values()) {
      if (isDisabled(server)) continue
      try {
        const clientConfig = toClientConfig(server, cwd)
        desired.set(server.name, { signature: JSON.stringify(clientConfig), clientConfig })
      } catch (error: unknown) {
        // One unusable entry is a configuration mistake in that entry alone.
        if (error instanceof McpJsonEntryError) ctx.logger.warn(error.message)
        else throw error
      }
    }

    for (const [serverName, live] of [...mounted]) {
      const next = desired.get(serverName)
      if (next !== undefined && next.signature === live.signature) continue
      // A removed, disabled, or reconfigured server releases its namespace
      // before the replacement claims it: the MCP client refuses a duplicate
      // serverName, so overlapping the two would fail the remount.
      mounted.delete(serverName)
      await live.fiber.dispose()
    }

    for (const [serverName, next] of desired) {
      if (mounted.has(serverName)) continue
      const fiber = ctx.plugin(McpClient, next.clientConfig)
      mounted.set(serverName, { fiber, signature: next.signature })
    }
  }

  /**
   * Single operation chain: file events and disposal never interleave with a
   * reconcile, so two events cannot both decide to mount the same server.
   */
  let operations: Promise<void> = Promise.resolve()
  let closed = false
  const enqueue = (): Promise<void> => {
    operations = operations.then(async () => {
      if (closed) return
      try {
        await reconcile()
      } catch (error: unknown) {
        ctx.logger.error('mcp-json: reconcile failed')
        ctx.logger.error(error)
      }
    })
    return operations
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined
  if (config.watch !== false) {
    watcher = chokidarWatch(layerSources(userPath, cwd, borrow).map(source => source.path), { ignoreInitial: true })
    watcher.on('all', () => {
      // An editor writes a document as several operations; the quiet period
      // keeps that from mounting servers against a half-written file.
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void enqueue()
      }, debounceMs)
    })
    watcher.on('error', (error: unknown) => {
      ctx.logger.warn('mcp-json: watcher error')
      ctx.logger.warn(error)
    })
  }

  ctx.effect(() => () => {
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    void watcher?.close()
    // Child fibers dispose with this one, so the map is only cleared here;
    // disposing them individually would race Cordis doing the same.
    mounted.clear()
  }, 'mcp-json.watch')

  if (config.createUserPath !== false) {
    operations = operations.then(async () => {
      if (closed) return
      try {
        if (await ensureDocument(userPath) !== undefined) {
          ctx.logger.info(`mcp-json: created ${userPath}`)
        }
      } catch (error: unknown) {
        // A home directory that refuses the write still leaves every other
        // layer readable, so discovery continues without this document.
        ctx.logger.warn(`mcp-json: cannot create ${userPath}`)
        ctx.logger.warn(error)
      }
    })
  }

  void enqueue()
}
