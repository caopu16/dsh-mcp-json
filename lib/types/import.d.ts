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
import type { McpJsonServer } from './types.ts';
/** What became of one server name during a merge. */
export interface ImportDecision {
    name: string;
    /** `added` wrote it, `replaced` overwrote an existing entry, `kept` left one alone. */
    outcome: 'added' | 'replaced' | 'kept';
    /** Absolute path of the file the discovered entry came from. */
    source: string;
}
/** The merged server map and what happened to each name. */
export interface MergeResult {
    servers: Record<string, McpJsonServer>;
    decisions: ImportDecision[];
}
/**
 * Merge discovered servers into an existing server map.
 * @param existing - the target document's current `mcpServers`.
 * @param discovered - borrowed servers by name, each with the file it came from.
 * @param force - whether a discovered entry replaces one already present.
 * @returns the new server map and a decision per discovered name.
 */
export declare function mergeServers(existing: Record<string, McpJsonServer>, discovered: Map<string, {
    entry: McpJsonServer;
    source: string;
}>, force?: boolean): MergeResult;
/** Outcome of an import run, for the caller to report. */
export interface ImportReport extends MergeResult {
    /** Absolute path written, or that would be written on a dry run. */
    target: string;
    /** Layers that existed but could not be read, so the report is honest. */
    failures: {
        path: string;
        tool: string;
        failure: string;
    }[];
    /** Whether the file was actually written. */
    written: boolean;
    /**
     * Servers a borrowed layer declared that the harness's own documents already
     * define, and so were not candidates. This is what a second import run sees:
     * the target now outranks the file each server came from, which is the point
     * of having imported them, not an absence of servers to find.
     */
    alreadyOwn: number;
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
export declare function runImport(options: {
    target: string;
    cwd: string;
    force?: boolean;
    dryRun?: boolean;
}): Promise<ImportReport>;
