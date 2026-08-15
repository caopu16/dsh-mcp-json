#!/usr/bin/env node
/**
 * `dsh-mcp-json-import`: collect the other agent tools' MCP servers into the
 * harness's own document, once, on request.
 *
 * A separate entry point rather than plugin behaviour, because the file has to
 * be yours afterwards: see the reasoning in `./import.ts`.
 *
 * @module dsh-mcp-json/cli
 */
/** Parsed argv. */
interface Options {
    target: string;
    cwd: string;
    force: boolean;
    dryRun: boolean;
}
/**
 * Parse argv.
 * @param argv - arguments after the node executable and script.
 * @returns the resolved options.
 * @throws on an unknown flag or a flag missing its value.
 */
export declare function parseArgs(argv: string[]): Options;
/**
 * Run the import and report it.
 * @param argv - arguments after the node executable and script.
 * @returns the process exit code.
 */
export declare function main(argv: string[]): Promise<number>;
export {};
