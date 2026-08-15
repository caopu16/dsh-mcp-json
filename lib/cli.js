#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parse } from "smol-toml";

//#region lib/types/dialect.js
/**
* Normalize each supported agent tool's MCP configuration dialect onto the
* Claude field vocabulary, so discovery and mapping speak one shape.
*
* Three dialects describe the same servers. Claude and Kiro write
* `mcpServers` with a `command` string plus `args`. OpenCode writes `mcp` with
* one argv array, `environment` instead of `env`, `local`/`remote` instead of
* `stdio`/`http`, and `enabled` instead of `disabled`. Codex writes TOML tables
* under `mcp_servers` whose fields already match the Claude names.
*
* @module dsh-mcp-json/dialect
*/
/** Whether a parsed value can carry server entries. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Convert one OpenCode entry to the Claude vocabulary.
* @param entry - the entry as written under `mcp`.
* @returns the same server in Claude field names.
*/
function fromOpenCode(entry) {
	const [command, ...args] = entry.command ?? [];
	return {
		type: entry.type === "remote" || entry.type === void 0 && entry.url !== void 0 ? "http" : "stdio",
		...command === void 0 ? {} : { command },
		...args.length > 0 ? { args } : {},
		...entry.environment === void 0 ? {} : { env: entry.environment },
		...entry.url === void 0 ? {} : { url: entry.url },
		...entry.headers === void 0 ? {} : { headers: entry.headers },
		...entry.enabled === false ? { disabled: true } : {}
	};
}
/**
* Extract the server map from one parsed document, whatever dialect it speaks.
* @param document - the parsed file contents.
* @param dialect - which dialect this file's path implies.
* @returns server entries in the Claude vocabulary, or `undefined` when the
*   document has no server section at all (a valid state for a shared config
*   file that simply declares no MCP servers).
* @throws when the document's server section exists but is not a table.
*/
function normalizeDocument(document, dialect) {
	if (!isRecord(document)) throw new Error("does not contain a JSON object");
	if (dialect === "opencode") {
		const section$1 = document.mcp;
		if (section$1 === void 0) return void 0;
		if (!isRecord(section$1)) throw new Error("has an \"mcp\" section that is not an object");
		return Object.fromEntries(Object.entries(section$1).filter((pair) => isRecord(pair[1])).map(([name, entry]) => [name, fromOpenCode(entry)]));
	}
	const key = dialect === "codex" ? "mcp_servers" : "mcpServers";
	const section = dialect === "codex" ? document.mcp_servers : document.mcpServers;
	if (section === void 0) return void 0;
	if (!isRecord(section)) throw new Error(`has a "${key}" section that is not an object`);
	return Object.fromEntries(Object.entries(section).filter((pair) => isRecord(pair[1])));
}

//#endregion
//#region lib/types/parse.js
/**
* Parse the relaxed JSON that editors write in practice.
*
* Claude Desktop, VS Code, and Kiro all accept `//` and block comments plus
* trailing commas in their `mcp.json`, and real files carry them — a strict
* `JSON.parse` refuses configuration those tools consider valid. This module
* removes exactly those three deviations and then parses strictly, so nothing
* else about the document is reinterpreted.
*
* @module dsh-mcp-json/parse
*/
/**
* Strip comments and trailing commas from JSON text.
*
* Scanning is character-wise with string state, because the sequences being
* removed are legal *inside* a string: a URL's `//` and a comma before a
* closing brace in a message must both survive.
* @param text - the raw document text.
* @returns text containing only strict JSON tokens, with removed spans
*   replaced by spaces so byte offsets in parse errors still point at the
*   original line and column.
*/
function stripJsonExtras(text) {
	let out = "";
	let index = 0;
	let inString = false;
	while (index < text.length) {
		const char = text[index];
		if (inString) {
			out += char;
			if (char === "\\" && index + 1 < text.length) {
				out += text[index + 1];
				index += 2;
				continue;
			}
			if (char === "\"") inString = false;
			index += 1;
			continue;
		}
		if (char === "\"") {
			inString = true;
			out += char;
			index += 1;
			continue;
		}
		if (char === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") {
				out += " ";
				index += 1;
			}
			continue;
		}
		if (char === "/" && text[index + 1] === "*") {
			const end = text.indexOf("*/", index + 2);
			const stop = end === -1 ? text.length : end + 2;
			for (; index < stop; index += 1) out += text[index] === "\n" ? "\n" : " ";
			continue;
		}
		if (char === ",") {
			let lookahead = index + 1;
			while (lookahead < text.length && /\s/.test(text[lookahead] ?? "")) lookahead += 1;
			const next = text[lookahead];
			if (next === "}" || next === "]") {
				out += " ";
				index += 1;
				continue;
			}
		}
		out += char;
		index += 1;
	}
	return out;
}
/**
* Parse one relaxed-JSON document.
* @param text - the raw document text.
* @param filename - path reported in the failure message.
* @returns the parsed value.
* @throws when the text is not valid JSON even after comments and trailing
*   commas are removed; the message names the file and the parser's reason.
*/
function parseJsonc(text, filename) {
	try {
		return JSON.parse(stripJsonExtras(text));
	} catch (error) {
		throw new Error(`mcp-json: ${filename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}

//#endregion
//#region lib/types/discover.js
/**
* User-level locations, relative to the home directory. Order within this
* group decides which tool wins when two of them name the same server; the
* harness's own document is last so it can override a borrowed configuration.
*/
const USER_SOURCES = [
	{
		relative: ".claude.json",
		dialect: "claude",
		tool: "claude-code"
	},
	{
		relative: ".codex/config.toml",
		dialect: "codex",
		tool: "codex"
	},
	{
		relative: ".kiro/settings/mcp.json",
		dialect: "claude",
		tool: "kiro"
	},
	{
		relative: ".config/opencode/opencode.json",
		dialect: "opencode",
		tool: "opencode"
	},
	{
		relative: ".config/opencode/opencode.jsonc",
		dialect: "opencode",
		tool: "opencode"
	}
];
/** Project-level locations, relative to the project directory. */
const PROJECT_SOURCES = [
	{
		relative: ".mcp.json",
		dialect: "claude",
		tool: "claude-code"
	},
	{
		relative: ".kiro/settings/mcp.json",
		dialect: "claude",
		tool: "kiro"
	},
	{
		relative: ".opencode/opencode.json",
		dialect: "opencode",
		tool: "opencode"
	},
	{
		relative: ".opencode/opencode.jsonc",
		dialect: "opencode",
		tool: "opencode"
	},
	{
		relative: ".codex/config.toml",
		dialect: "codex",
		tool: "codex"
	}
];
/** The harness's own user-level document, which outranks every borrowed one. */
const DEFAULT_USER_PATH = "~/.dsh/mcp.json";
/** The harness's own project-level document, the most specific layer of all. */
const PROJECT_DSH_PATH = ".dsh/mcp.json";
/**
* Read and parse one layer.
* @param source - the path and dialect to read.
* @returns the layer's servers, or a failure describing why it was skipped.
*/
async function readLayer(source) {
	let text;
	try {
		text = await readFile(source.path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return {
			...source,
			servers: []
		};
		return {
			...source,
			servers: [],
			failure: `cannot be read: ${error.message}`
		};
	}
	let document;
	try {
		document = source.dialect === "codex" ? parse(text) : parseJsonc(text, source.path);
	} catch (error) {
		return {
			...source,
			servers: [],
			failure: error.message
		};
	}
	let entries;
	try {
		entries = normalizeDocument(document, source.dialect);
	} catch (error) {
		return {
			...source,
			servers: [],
			failure: `mcp-json: ${source.path} ${error.message}`
		};
	}
	if (entries === void 0) return {
		...source,
		servers: []
	};
	return {
		...source,
		servers: Object.entries(entries).map(([name, entry]) => ({
			name,
			entry,
			source: source.path
		}))
	};
}
/** Expand a leading `~` against the user's home directory. */
function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
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
function layerSources(userPath, cwd, borrow = true) {
	const home = homedir();
	const expanded = expandHome(userPath);
	const sources = [];
	if (borrow) for (const entry of USER_SOURCES) sources.push({
		path: join(home, entry.relative),
		dialect: entry.dialect,
		tool: entry.tool
	});
	sources.push({
		path: isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
		dialect: "claude",
		tool: "dsh"
	});
	if (borrow) for (const entry of PROJECT_SOURCES) sources.push({
		path: resolve(cwd, entry.relative),
		dialect: entry.dialect,
		tool: entry.tool
	});
	sources.push({
		path: resolve(cwd, PROJECT_DSH_PATH),
		dialect: "claude",
		tool: "dsh"
	});
	return sources;
}
/**
* Read every layer and merge them.
* @param userPath - the harness's own user document path.
* @param cwd - the project directory.
* @param borrow - whether to read the other tools' documents.
* @returns each layer's outcome and the merged server map.
*/
async function discover(userPath, cwd, borrow = true) {
	const sources = layerSources(userPath, cwd, borrow);
	const seen = /* @__PURE__ */ new Set();
	const unique = sources.filter((source) => !seen.has(source.path) && seen.add(source.path));
	const layers = await Promise.all(unique.map(readLayer));
	const servers = /* @__PURE__ */ new Map();
	for (const layer of layers) for (const server of layer.servers) servers.set(server.name, server);
	return {
		layers,
		servers
	};
}

//#endregion
//#region lib/types/import.js
/**
* Merge discovered servers into an existing server map.
* @param existing - the target document's current `mcpServers`.
* @param discovered - borrowed servers by name, each with the file it came from.
* @param force - whether a discovered entry replaces one already present.
* @returns the new server map and a decision per discovered name.
*/
function mergeServers(existing, discovered, force = false) {
	const servers = { ...existing };
	const decisions = [];
	for (const [name, { entry, source }] of discovered) {
		const present = Object.hasOwn(servers, name);
		if (present && !force) {
			decisions.push({
				name,
				outcome: "kept",
				source
			});
			continue;
		}
		servers[name] = entry;
		decisions.push({
			name,
			outcome: present ? "replaced" : "added",
			source
		});
	}
	return {
		servers,
		decisions
	};
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
async function runImport(options) {
	const { target, cwd } = options;
	const own = new Set(layerSources(target, cwd).filter((source) => source.tool === "dsh").map((source) => source.path));
	const { layers, servers } = await discover(target, cwd);
	const borrowedNames = new Set(layers.filter((layer) => !own.has(layer.path)).flatMap((layer) => layer.servers.map((server) => server.name)));
	const discovered = /* @__PURE__ */ new Map();
	let alreadyOwn = 0;
	for (const server of servers.values()) {
		if (own.has(server.source)) {
			if (borrowedNames.has(server.name)) alreadyOwn += 1;
			continue;
		}
		discovered.set(server.name, {
			entry: server.entry,
			source: server.source
		});
	}
	let document = {};
	try {
		const parsed = parseJsonc(await readFile(target, "utf8"), target);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`mcp-json: ${target} does not contain a JSON object`);
		document = parsed;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const { servers: merged, decisions } = mergeServers(document.mcpServers ?? {}, discovered, options.force);
	const written = decisions.some((decision) => decision.outcome !== "kept") && options.dryRun !== true;
	if (written) {
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, `${JSON.stringify({
			...document,
			mcpServers: merged
		}, void 0, 2)}\n`);
	}
	return {
		target,
		servers: merged,
		decisions,
		alreadyOwn,
		failures: layers.filter((layer) => layer.failure !== void 0).map((layer) => ({
			path: layer.path,
			tool: layer.tool,
			failure: layer.failure ?? ""
		})),
		written
	};
}

//#endregion
//#region lib/types/cli.js
const USAGE = `Usage: dsh-mcp-json-import [options]

Collect the MCP servers declared by Claude Code, Kiro, OpenCode, and Codex
into the harness's own document, so it can be read on its own afterwards.

Options:
  --target <path>  document to write (default ${DEFAULT_USER_PATH})
  --cwd <path>     project directory the project layers resolve against
  --force          overwrite entries the target already defines
  --dry-run        report what would change without writing
  -h, --help       show this message

Set \`borrow: false\` in the \`mcp-json\` section of ~/.dsh/settings.yaml after
importing, so the other tools' files stop being read.
`;
/**
* Parse argv.
* @param argv - arguments after the node executable and script.
* @returns the resolved options.
* @throws on an unknown flag or a flag missing its value.
*/
function parseArgs(argv) {
	let target = DEFAULT_USER_PATH;
	let cwd = process.cwd();
	let force = false;
	let dryRun = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--target" || arg === "--cwd") {
			const value = argv[index + 1];
			if (value === void 0 || value.startsWith("-")) throw new Error(`${arg} requires a path`);
			if (arg === "--target") target = value;
			else cwd = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument ${JSON.stringify(arg)}`);
	}
	const expanded = expandHome(target);
	return {
		target: isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
		cwd: resolve(cwd),
		force,
		dryRun
	};
}
/**
* Run the import and report it.
* @param argv - arguments after the node executable and script.
* @returns the process exit code.
*/
async function main(argv) {
	if (argv.includes("-h") || argv.includes("--help")) {
		process.stdout.write(USAGE);
		return 0;
	}
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`dsh-mcp-json-import: ${error.message}\n\n${USAGE}`);
		return 2;
	}
	const report = await runImport(options);
	for (const failure of report.failures) process.stderr.write(`skipped ${failure.tool} config ${failure.path} — ${failure.failure}\n`);
	for (const decision of report.decisions) process.stdout.write(`${decision.outcome.padEnd(8)} ${decision.name}  (${decision.source})\n`);
	const changes = report.decisions.filter((decision) => decision.outcome !== "kept").length;
	const kept = report.decisions.length - changes;
	if (report.decisions.length === 0 && report.alreadyOwn > 0) process.stdout.write(`nothing to import; ${report.target} already defines all ${report.alreadyOwn} borrowed server(s)\n`);
	else if (report.decisions.length === 0) process.stdout.write("no servers found in the other tools' documents\n");
	else if (report.written) process.stdout.write(`\nwrote ${changes} server(s) to ${report.target}\n`);
	else if (changes === 0) process.stdout.write(`\n${report.target} already defines every discovered server\n`);
	else process.stdout.write(`\nwould write ${changes} server(s) to ${report.target}\n`);
	if (kept > 0 && !options.force) process.stdout.write(`${kept} entry(ies) already in the target were kept; --force overwrites them\n`);
	return 0;
}
if (process.argv[1] !== void 0 && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

//#endregion
export { main, parseArgs };