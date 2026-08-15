# dsh-mcp-json

English | [中文](README.zh.md)

Mount MCP servers in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) from the configuration files your agent tools already have. It reads the `mcp.json` of Claude Code, Kiro, OpenCode, and Codex, merges them, and keeps the running server set in step with the files.

The harness MCP client is deliberately one plugin instance per server and reads no files. This package supplies the configuration discovery it does not do: adding a server becomes editing JSON instead of editing the profile's plugin tree.

## Requirements

- A working `dsh` install (this package is a plugin, not a standalone tool).
- At least one MCP configuration file. Any of the locations below counts — an existing Claude Code or Kiro setup works with no new file and no entry config.

## Install

```sh
dsh plugin --profile web add github:caopu16/dsh-mcp-json
```

The package declares its own patch layer, so installing it mounts the loader. Built `lib/` is committed so a git-sourced install runs no build script.

### Without the `dsh` command

`dsh` on PATH comes from an installed `@deepseek-ai/dsh`. From a harness source checkout, run the CLI from that checkout instead:

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add github:caopu16/dsh-mcp-json
pnpm dsh --profile web
```

### Developing this plugin

`lib/` is committed, so a change to `src/` reaches consumers only after it is rebuilt and committed too:

```sh
npm install
npm run build
npm test
```

## Where it looks

Layers apply from least to most specific, and a server name present in more than one layer is defined by the **last** file that named it. User-level files come first, then the project-level ones, so a checkout can redirect one server without restating the rest.

| Order | Path | Tool | Dialect |
|---|---|---|---|
| 1 | `~/.claude.json` | Claude Code | `mcpServers` |
| 2 | `~/.codex/config.toml` | Codex | TOML `[mcp_servers.*]` |
| 3 | `~/.kiro/settings/mcp.json` | Kiro | `mcpServers` |
| 4 | `~/.config/opencode/opencode.json[c]` | OpenCode | `mcp` |
| 5 | `~/.dsh/mcp.json` | this harness | `mcpServers` |
| 6 | `<cwd>/.mcp.json` | Claude Code | `mcpServers` |
| 7 | `<cwd>/.kiro/settings/mcp.json` | Kiro | `mcpServers` |
| 8 | `<cwd>/.opencode/opencode.json[c]` | OpenCode | `mcp` |
| 9 | `<cwd>/.codex/config.toml` | Codex | TOML |
| 10 | `<cwd>/.dsh/mcp.json` | this harness | `mcpServers` |

The harness's own document sits at the end of each group, so it can override a borrowed configuration without editing the other tool's file. A missing file is normal and silent; a file that exists but cannot be parsed is reported and skipped, leaving the other layers working.

Relaxed JSON is accepted — `//` and `/* */` comments and trailing commas — because every tool in the table writes it and real files carry it.

## Collecting the borrowed servers into one document

If you would rather own your MCP configuration outright than keep reading four other tools' files, import once and stop borrowing:

```sh
dsh-mcp-json-import --dry-run   # see what would be written
dsh-mcp-json-import             # write ~/.dsh/mcp.json
```

Then set `borrow: false` in the `mcp-json` section of `~/.dsh/settings.yaml`. Discovery narrows to `~/.dsh/mcp.json` and `<cwd>/.dsh/mcp.json`, the file is yours, and nothing rewrites it.

| Flag | Meaning |
|---|---|
| `--target <path>` | Document to write, default `~/.dsh/mcp.json`. |
| `--cwd <path>` | Project directory the project-level layers resolve against. |
| `--force` | Overwrite entries the target already defines. Without it, yours are kept. |
| `--dry-run` | Report what would change and write nothing. |

Entries are translated to the Claude vocabulary on the way in, so an OpenCode or Codex server arrives as `command` plus `args`. Names the target already defines are kept rather than replaced, because the entry you wrote is the more specific statement about that server. Other top-level keys in the target survive: only the `mcpServers` section is claimed.

This is a command you run, not something the plugin does on its own, and that is the whole design. A document rewritten from the other tools on every start cannot also be a document you edit — your additions would be overwritten, and a borrowed server you deleted would reappear on the next reconcile. Importing once leaves the file yours afterwards.

Note that importing copies entries; it does not change which layer wins. A project `.mcp.json` still outranks `~/.dsh/mcp.json`, which is why turning `borrow` off is the second half of the instruction rather than optional polish.

## Dialects

The three vocabularies describe the same servers with different field names, and this plugin translates them rather than asking you to rewrite anything:

| | Claude / Kiro | OpenCode | Codex |
|---|---|---|---|
| Section | `mcpServers` | `mcp` | `mcp_servers` |
| Format | JSON(C) | JSON(C) | TOML |
| Command | `command` + `args` | `command` as one argv array | `command` + `args` |
| Environment | `env` | `environment` | `env` |
| Transport tag | `stdio` / `http` | `local` / `remote` | `stdio` / `http` |
| Switched off | `disabled: true` | `enabled: false` | — |

An entry that names no transport is inferred: a `url` means HTTP, otherwise stdio.

`disabled: true` (or OpenCode's `enabled: false`) keeps a server unmounted. `autoApprove` is recognized and ignored — tool approval belongs to the harness approval capability, which this plugin does not speak for.

## Config

Every field is optional, and the defaults need no configuration at all.

To change one, write the `mcp-json` section of `~/.dsh/settings.yaml`:

```yaml
mcp-json:
  borrow: false
```

This is the place to put it. The section merges over whatever the profile composed, so setting one field leaves the rest alone, and an edit takes effect without a restart.

A patch layer works too, targeting the row by id in `~/.dsh/profiles/<name>/cordis.patch.yml`:

```yaml
- id: mcp-json
  config:
    borrow: false
```

Two things to know about the patch route. A patch replaces the row's whole `config` rather than merging into it, so a patch that sets one field drops every other field back to its schema default. And do not wrap the entry in an `insert:` list — this package's own patch layer already inserts `mcp-json`, and a second insert of the same id fails the whole profile at boot with `duplicate loader entry id: mcp-json`.

| Field | Default | Meaning |
|---|---|---|
| `userPath` | `~/.dsh/mcp.json` | This harness's own user-level document. |
| `cwd` | the process working directory | Directory the project-level layers resolve against. |
| `borrow` | `true` | Whether to read the other tools' files. `false` restricts discovery to `userPath` and `<cwd>/.dsh/mcp.json`. |
| `createUserPath` | `true` | Create `userPath` with an empty `mcpServers` when absent, so the document to edit always exists. An existing file is never rewritten. |
| `watch` | `true` | Reload when any layer changes. |
| `debounceMs` | `150` | Quiet period after a file event before re-reading. |

## Live reload

A changed file is reconciled **per server**, not by remounting everything: a server whose resolved configuration is unchanged keeps its connection and its registered tools while its neighbours change. Adding an entry mounts one server, removing or disabling one unmounts it, and editing one replaces just that server.

An editor writes a document as several operations, so events are coalesced over `debounceMs` before the files are re-read.

Editing the `mcp-json` settings section reconciles the same way: the config is compared as the paths and switches it resolves to, so a change that moves `cwd` or turns `borrow` off re-reads the new layer set, while a section that only restates a default disturbs nothing.

## Tool names

Each server's tools reach the model as `mcp__<serverName>__<toolName>`, which is the harness MCP client's own convention. The server name is therefore a namespace, and the client requires it to match `[A-Za-z0-9_-]{1,32}`. A name outside that set is reported with the file that supplied it and skipped, rather than failing the whole load.

## Known Limitations and Deferred Work

- **Trae is not supported.** No verifiable MCP configuration path was found for it; adding a guessed path would ship a location that never matches.
- **Cursor and VS Code are not read.** Same reason — their locations were not verified on a real installation.
- **Timeouts are not read from the source file.** OpenCode's per-server `timeout` and any other tool-specific tuning are ignored; every server gets the harness client's 60-second tool-call timeout.
- **`autoApprove` has no effect.** Tool approval is the approval capability's decision, so a pre-approved list in another tool's file does not carry over.
- **A watched file that never existed is only noticed on a full reconcile.** Chokidar watches the paths, so creating a previously absent layer does fire, but a path whose parent directory is also absent may not be observed until another layer changes.
- **One `cwd` per plugin instance.** The project layers resolve against the configured directory, not per-session working directories.

## License

MIT
