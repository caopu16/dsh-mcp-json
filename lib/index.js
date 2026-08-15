import { dirname, isAbsolute, join, resolve } from "node:path";
import { watch } from "chokidar";
import z from "@deepseek-ai/schemastery";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
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
		return Object.fromEntries(Object.entries(section$1).filter((pair) => isRecord(pair[1])).map(([name$1, entry]) => [name$1, fromOpenCode(entry)]));
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
		servers: Object.entries(entries).map(([name$1, entry]) => ({
			name: name$1,
			entry,
			source: source.path
		}))
	};
}
/** Contents written for a document that does not exist yet. */
const EMPTY_DOCUMENT = "{\n  \"mcpServers\": {}\n}\n";
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
async function ensureDocument(path) {
	await mkdir(dirname(path), { recursive: true });
	try {
		await writeFile(path, EMPTY_DOCUMENT, { flag: "wx" });
	} catch (error) {
		if (error.code === "EEXIST") return void 0;
		throw error;
	}
	return path;
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
//#region lib/types/map.js
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
/** Server names the MCP client accepts as a tool-name namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** `type` values that select the HTTP transport. */
const HTTP_TYPES = new Set([
	"http",
	"streamable-http",
	"sse"
]);
/** `type` values that select the stdio transport. */
const STDIO_TYPES = new Set(["stdio"]);
/** Why one entry cannot be mounted, phrased for the user who wrote the file. */
var McpJsonEntryError = class extends Error {
	constructor(server, reason) {
		super(`mcp-json: server "${server.name}" in ${server.source} ${reason}`);
		this.name = "McpJsonEntryError";
	}
};
/**
* Translate one discovered entry into MCP client configuration.
* @param server - the discovered entry and its source file.
* @param defaultCwd - working directory for a stdio entry that names none.
* @returns configuration ready for `ctx.plugin()`.
* @throws {@link McpJsonEntryError} when the name is unusable, the transport is
*   unrecognized, or the entry omits the field its transport requires.
*/
function toClientConfig(server, defaultCwd) {
	const { name: name$1, entry } = server;
	if (!SERVER_NAME_PATTERN.test(name$1)) throw new McpJsonEntryError(server, `has a name the harness cannot use as a tool namespace; names must match ${String(SERVER_NAME_PATTERN)}`);
	const declared = entry.type?.toLowerCase();
	const transport = declared === void 0 ? entry.url !== void 0 ? "http" : "stdio" : declared;
	if (HTTP_TYPES.has(transport)) {
		if (entry.url === void 0 || entry.url.length === 0) throw new McpJsonEntryError(server, "declares an HTTP transport but names no \"url\"");
		return {
			transport: "streamable-http",
			serverName: name$1,
			url: entry.url,
			headers: entry.headers ?? {},
			toolCallTimeoutMs: 6e4,
			failOnStartupError: false
		};
	}
	if (STDIO_TYPES.has(transport)) {
		if (entry.command === void 0 || entry.command.length === 0) throw new McpJsonEntryError(server, "declares a stdio transport but names no \"command\"");
		return {
			transport: "stdio",
			serverName: name$1,
			command: entry.command,
			args: entry.args ?? [],
			env: entry.env ?? {},
			cwd: entry.cwd ?? defaultCwd,
			toolCallTimeoutMs: 6e4,
			failOnStartupError: false
		};
	}
	throw new McpJsonEntryError(server, `declares an unsupported transport "${entry.type ?? ""}"; use "stdio" or "http"`);
}
/**
* Whether an entry asks not to be mounted.
* @param server - the discovered entry.
* @returns true when the document switched this server off.
*/
function isDisabled(server) {
	return server.entry.disabled === true;
}

//#endregion
//#region lib/types/index.js
/** Cordis plugin name used by loader diagnostics. */
const name = "mcp-json";
/**
* The MCP client registers on `ctx.tools`, so this plugin waits for the same
* service before mounting anything: a child mounted without it would fail on
* its own rather than wait.
*/
const inject = ["tools"];
/** Quiet period after a file event before re-reading, coalescing editor writes. */
const DEFAULT_DEBOUNCE_MS = 150;
const Config = z.object({
	userPath: z.string().default(DEFAULT_USER_PATH),
	cwd: z.string(),
	borrow: z.boolean().default(true),
	createUserPath: z.boolean().default(true),
	watch: z.boolean().default(true),
	debounceMs: z.number().min(0).default(DEFAULT_DEBOUNCE_MS)
});
function apply(ctx, config) {
	const cwd = config.cwd ?? process.cwd();
	const expanded = expandHome(config.userPath ?? DEFAULT_USER_PATH);
	const userPath = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	const borrow = config.borrow ?? true;
	const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const mounted = /* @__PURE__ */ new Map();
	/**
	* Bring the mounted set in line with the documents.
	*
	* Each layer's failure is reported once per reconcile rather than thrown: one
	* malformed project file must not take down servers the other layers define,
	* and the user needs the remaining servers to keep working while they fix it.
	*/
	const reconcile = async () => {
		const { layers, servers } = await discover(userPath, cwd, borrow);
		for (const layer of layers) if (layer.failure !== void 0) ctx.logger.warn(`mcp-json: skipping ${layer.tool} config ${layer.path} — ${layer.failure}`);
		const desired = /* @__PURE__ */ new Map();
		for (const server of servers.values()) {
			if (isDisabled(server)) continue;
			try {
				const clientConfig = toClientConfig(server, cwd);
				desired.set(server.name, {
					signature: JSON.stringify(clientConfig),
					clientConfig
				});
			} catch (error) {
				if (error instanceof McpJsonEntryError) ctx.logger.warn(error.message);
				else throw error;
			}
		}
		for (const [serverName, live] of [...mounted]) {
			const next = desired.get(serverName);
			if (next !== void 0 && next.signature === live.signature) continue;
			mounted.delete(serverName);
			await live.fiber.dispose();
		}
		for (const [serverName, next] of desired) {
			if (mounted.has(serverName)) continue;
			const fiber = ctx.plugin(McpClient, next.clientConfig);
			mounted.set(serverName, {
				fiber,
				signature: next.signature
			});
		}
	};
	/**
	* Single operation chain: file events and disposal never interleave with a
	* reconcile, so two events cannot both decide to mount the same server.
	*/
	let operations = Promise.resolve();
	let closed = false;
	const enqueue = () => {
		operations = operations.then(async () => {
			if (closed) return;
			try {
				await reconcile();
			} catch (error) {
				ctx.logger.error("mcp-json: reconcile failed");
				ctx.logger.error(error);
			}
		});
		return operations;
	};
	let timer;
	let watcher;
	if (config.watch !== false) {
		watcher = watch(layerSources(userPath, cwd, borrow).map((source) => source.path), { ignoreInitial: true });
		watcher.on("all", () => {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				enqueue();
			}, debounceMs);
		});
		watcher.on("error", (error) => {
			ctx.logger.warn("mcp-json: watcher error");
			ctx.logger.warn(error);
		});
	}
	ctx.effect(() => () => {
		closed = true;
		if (timer !== void 0) clearTimeout(timer);
		watcher?.close();
		mounted.clear();
	}, "mcp-json.watch");
	if (config.createUserPath !== false) operations = operations.then(async () => {
		if (closed) return;
		try {
			if (await ensureDocument(userPath) !== void 0) ctx.logger.info(`mcp-json: created ${userPath}`);
		} catch (error) {
			ctx.logger.warn(`mcp-json: cannot create ${userPath}`);
			ctx.logger.warn(error);
		}
	});
	enqueue();
}

//#endregion
export { Config, DEFAULT_USER_PATH, McpJsonEntryError, apply, discover, ensureDocument, expandHome, inject, isDisabled, layerSources, name, normalizeDocument, parseJsonc, readLayer, stripJsonExtras, toClientConfig };