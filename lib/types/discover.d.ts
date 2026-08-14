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
import type { DiscoveredServer, McpDialect } from './types.ts';
/** One configuration location: where to look and which dialect to expect. */
export interface LayerSource {
    /** Absolute path of the document. */
    path: string;
    /** Dialect the file speaks. */
    dialect: McpDialect;
    /** Tool whose convention this path follows, named in diagnostics. */
    tool: string;
}
/** The harness's own user-level document, which outranks every borrowed one. */
export declare const DEFAULT_USER_PATH = "~/.dsh/mcp.json";
/** One layer's outcome: its servers, or the reason the file was refused. */
export interface LayerResult extends LayerSource {
    /** Servers the file declared, empty when the file is absent. */
    servers: DiscoveredServer[];
    /** Why the file was skipped, when it existed but could not be used. */
    failure?: string;
}
/**
 * Read and parse one layer.
 * @param source - the path and dialect to read.
 * @returns the layer's servers, or a failure describing why it was skipped.
 */
export declare function readLayer(source: LayerSource): Promise<LayerResult>;
/** Expand a leading `~` against the user's home directory. */
export declare function expandHome(path: string): string;
/**
 * Resolve every layer to read, least specific first.
 * @param userPath - the harness's own user document, absolute, `~`-prefixed, or
 *   relative to `cwd`.
 * @param cwd - the project directory the project layers resolve against.
 * @param borrow - whether to read the other tools' documents; `false` restricts
 *   discovery to the harness's own two files.
 * @returns the ordered layer sources.
 */
export declare function layerSources(userPath: string, cwd: string, borrow?: boolean): LayerSource[];
/** Every layer's outcome plus the merged server set. */
export interface Discovery {
    /** Per-layer results in application order, for diagnostics. */
    layers: LayerResult[];
    /** Merged servers by name; the most specific layer's entry wins. */
    servers: Map<string, DiscoveredServer>;
}
/**
 * Read every layer and merge them.
 * @param userPath - the harness's own user document path.
 * @param cwd - the project directory.
 * @param borrow - whether to read the other tools' documents.
 * @returns each layer's outcome and the merged server map.
 */
export declare function discover(userPath: string, cwd: string, borrow?: boolean): Promise<Discovery>;
