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

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_USER_PATH, expandHome } from './discover.ts'
import { runImport } from './import.ts'

/** Parsed argv. */
interface Options {
  target: string
  cwd: string
  force: boolean
  dryRun: boolean
}

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
`

/**
 * Parse argv.
 * @param argv - arguments after the node executable and script.
 * @returns the resolved options.
 * @throws on an unknown flag or a flag missing its value.
 */
export function parseArgs(argv: string[]): Options {
  let target = DEFAULT_USER_PATH
  let cwd = process.cwd()
  let force = false
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') { force = true; continue }
    if (arg === '--dry-run') { dryRun = true; continue }
    if (arg === '--target' || arg === '--cwd') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} requires a path`)
      if (arg === '--target') target = value
      else cwd = value
      index += 1
      continue
    }
    throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  const expanded = expandHome(target)
  return {
    target: isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
    cwd: resolve(cwd),
    force,
    dryRun,
  }
}

/**
 * Run the import and report it.
 * @param argv - arguments after the node executable and script.
 * @returns the process exit code.
 */
export async function main(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE)
    return 0
  }

  let options: Options
  try {
    options = parseArgs(argv)
  } catch (error: unknown) {
    process.stderr.write(`dsh-mcp-json-import: ${(error as Error).message}\n\n${USAGE}`)
    return 2
  }

  const report = await runImport(options)

  for (const failure of report.failures) {
    process.stderr.write(`skipped ${failure.tool} config ${failure.path} — ${failure.failure}\n`)
  }
  for (const decision of report.decisions) {
    process.stdout.write(`${decision.outcome.padEnd(8)} ${decision.name}  (${decision.source})\n`)
  }

  const changes = report.decisions.filter(decision => decision.outcome !== 'kept').length
  const kept = report.decisions.length - changes
  if (report.decisions.length === 0 && report.alreadyOwn > 0) {
    // The expected result of running this twice: the target now defines them.
    process.stdout.write(`nothing to import; ${report.target} already defines all ${report.alreadyOwn} borrowed server(s)\n`)
  } else if (report.decisions.length === 0) {
    process.stdout.write('no servers found in the other tools\' documents\n')
  } else if (report.written) {
    process.stdout.write(`\nwrote ${changes} server(s) to ${report.target}\n`)
  } else if (changes === 0) {
    process.stdout.write(`\n${report.target} already defines every discovered server\n`)
  } else {
    process.stdout.write(`\nwould write ${changes} server(s) to ${report.target}\n`)
  }
  if (kept > 0 && !options.force) {
    process.stdout.write(`${kept} entry(ies) already in the target were kept; --force overwrites them\n`)
  }
  return 0
}

// Guarded so importing this module for its parser does not run an import.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
