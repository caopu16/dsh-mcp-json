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
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client';
import type { DiscoveredServer } from './types.ts';
/** Why one entry cannot be mounted, phrased for the user who wrote the file. */
export declare class McpJsonEntryError extends Error {
    constructor(server: DiscoveredServer, reason: string);
}
/**
 * Translate one discovered entry into MCP client configuration.
 * @param server - the discovered entry and its source file.
 * @param defaultCwd - working directory for a stdio entry that names none.
 * @returns configuration ready for `ctx.plugin()`.
 * @throws {@link McpJsonEntryError} when the name is unusable, the transport is
 *   unrecognized, or the entry omits the field its transport requires.
 */
export declare function toClientConfig(server: DiscoveredServer, defaultCwd: string): McpClientConfig;
/**
 * Whether an entry asks not to be mounted.
 * @param server - the discovered entry.
 * @returns true when the document switched this server off.
 */
export declare function isDisabled(server: DiscoveredServer): boolean;
