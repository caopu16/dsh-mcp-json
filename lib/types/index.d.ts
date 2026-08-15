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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { DEFAULT_USER_PATH, discover, ensureDocument, expandHome, layerSources, readLayer } from './discover.ts';
export type { Discovery, LayerResult, LayerSource } from './discover.ts';
export { normalizeDocument } from './dialect.ts';
export { mergeServers, runImport } from './import.ts';
export type { ImportDecision, ImportReport, MergeResult } from './import.ts';
export { isDisabled, McpJsonEntryError, toClientConfig } from './map.ts';
export { parseJsonc, stripJsonExtras } from './parse.ts';
export type * from './types.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "mcp-json";
/**
 * Settings namespace carrying this plugin's user layer.
 *
 * A patch layer replaces the loader row's whole `config`, so overriding one
 * field there silently drops the rest back to schema defaults. The settings
 * section merges over the composed entry instead, and reloads without a
 * restart, which makes it the better place for a user to set these.
 */
export declare const MCP_JSON_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/**
 * The MCP client registers on `ctx.tools`, so this plugin waits for the same
 * service before mounting anything: a child mounted without it would fail on
 * its own rather than wait.
 */
export declare const inject: string[];
/** Plugin config. */
export interface Config {
    /**
     * User-level document, `~` expanded, resolved against `cwd` when relative.
     * Defaults to `~/.dsh/mcp.json`.
     */
    userPath?: string;
    /**
     * Project directory the project-level layers resolve against. Defaults to
     * the process working directory.
     */
    cwd?: string;
    /**
     * Whether to read the other agent tools' documents (Claude Code, Kiro,
     * OpenCode, Codex) in addition to the harness's own two. `false` restricts
     * discovery to `userPath` and `<cwd>/.dsh/mcp.json`.
     */
    borrow?: boolean;
    /**
     * Whether to create `userPath` with an empty `mcpServers` when it is absent,
     * so the document to edit always exists (default true). Only this path is
     * created: the other layers belong to other tools or to a checkout.
     */
    createUserPath?: boolean;
    /** Whether to reload when a document changes (default true). */
    watch?: boolean;
    /** Quiet period after a file event before re-reading (default 150ms). */
    debounceMs?: number;
}
export declare const Config: z<Config>;
/** The config projected onto the facts this plugin acts on. */
export interface Resolved {
    /** Absolute path of the harness's own user document. */
    userPath: string;
    /** Absolute project directory the project layers resolve against. */
    cwd: string;
    borrow: boolean;
    createUserPath: boolean;
    watch: boolean;
    debounceMs: number;
    /** Every document to watch, in discovery order. */
    paths: string[];
}
/**
 * Project a config onto the resolved facts, so a settings change is compared
 * as what this plugin actually does rather than as raw fields.
 * @param config - composed entry merged with the user's settings section.
 * @returns the absolute paths and switches discovery and watching need.
 */
export declare function resolveConfig(config: Config): Resolved;
export declare function apply(ctx: Context, config: Config): void;
