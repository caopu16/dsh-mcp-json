import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeServers, runImport } from '../src/import.ts'
import { parseArgs } from '../src/cli.ts'

let root: string
let home: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-mcp-json-import-'))
  // Discovery reads the user-level layers through `os.homedir()`, which honours
  // HOME on POSIX. Pointing it at the temporary root keeps these cases from
  // reading — or reporting — the MCP configuration of the machine running them.
  home = process.env.HOME
  process.env.HOME = join(root, 'home')
})

afterEach(() => {
  if (home === undefined) delete process.env.HOME
  else process.env.HOME = home
  rmSync(root, { recursive: true, force: true })
})

/** Write one document under the temporary root, creating parents. */
function write(relative: string, value: unknown): string {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
  return path
}

/** Read the target document back. */
function read(relative: string): { mcpServers?: Record<string, unknown> } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

describe('mergeServers', () => {
  it('keeps an entry the target already defines, because that one is more specific', () => {
    const { servers, decisions } = mergeServers(
      { git: { command: 'mine' } },
      new Map([['git', { entry: { command: 'theirs' }, source: '/borrowed.json' }]]),
    )
    expect(servers.git).toEqual({ command: 'mine' })
    expect(decisions).toEqual([{ name: 'git', outcome: 'kept', source: '/borrowed.json' }])
  })

  it('overwrites a present entry only when forced', () => {
    const { servers, decisions } = mergeServers(
      { git: { command: 'mine' } },
      new Map([['git', { entry: { command: 'theirs' }, source: '/borrowed.json' }]]),
      true,
    )
    expect(servers.git).toEqual({ command: 'theirs' })
    expect(decisions[0]?.outcome).toBe('replaced')
  })

  it('leaves entries the discovery did not mention untouched', () => {
    const { servers } = mergeServers(
      { local: { command: 'keep' } },
      new Map([['added', { entry: { command: 'new' }, source: '/borrowed.json' }]]),
    )
    expect(Object.keys(servers).sort()).toEqual(['added', 'local'])
  })
})

describe('runImport', () => {
  it('collects a project layer into a target that does not exist yet', async () => {
    write('.mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    const report = await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(report.written).toBe(true)
    expect(read('.dsh/mcp.json').mcpServers).toEqual({ git: { command: 'git-mcp' } })
  })

  it('translates a borrowed dialect, so the written document is Claude-shaped', async () => {
    write('.opencode/opencode.json', { mcp: { fs: { type: 'local', command: ['npx', 'fs'], environment: { A: '1' } } } })
    await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(read('.dsh/mcp.json').mcpServers).toEqual({
      fs: { type: 'stdio', command: 'npx', args: ['fs'], env: { A: '1' } },
    })
  })

  // The harness's own documents are the destination. Copying one back would
  // report an entry as newly imported when the file always had it.
  it('does not import a server the target itself declared', async () => {
    write('.dsh/mcp.json', { mcpServers: { own: { command: 'mine' } } })
    const report = await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(report.decisions).toEqual([])
    expect(report.written).toBe(false)
  })

  it('preserves other top-level keys, since the document is the user\'s', async () => {
    write('.dsh/mcp.json', { $schema: 'https://example/schema.json', mcpServers: {} })
    write('.mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(read('.dsh/mcp.json').$schema).toBe('https://example/schema.json')
  })

  it('reports without writing on a dry run', async () => {
    write('.mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    const target = join(root, '.dsh/mcp.json')
    const report = await runImport({ target, cwd: root, dryRun: true })
    expect(report.decisions).toEqual([{ name: 'git', outcome: 'added', source: join(root, '.mcp.json') }])
    expect(report.written).toBe(false)
    expect(() => readFileSync(target)).toThrow()
  })

  it('does not rewrite the file when every discovered server is already present', async () => {
    write('.mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    write('.dsh/mcp.json', { mcpServers: { git: { command: 'mine' } } })
    const report = await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(report.written).toBe(false)
    expect(read('.dsh/mcp.json').mcpServers).toEqual({ git: { command: 'mine' } })
  })

  // Running the import twice is the case that would otherwise look like the
  // tools' documents had gone empty, rather than like the import had worked.
  // The borrowed layer here is a user-level one: a project `.mcp.json` outranks
  // the user document even after an import, which is the next case down.
  it('counts a server the target took over separately from finding nothing', async () => {
    write('home/.kiro/settings/mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    const target = join(root, 'home/.dsh/mcp.json')
    await runImport({ target, cwd: root })
    const second = await runImport({ target, cwd: root })
    expect(second.decisions).toEqual([])
    expect(second.alreadyOwn).toBe(1)
  })

  // Importing copies the entries in; it does not change which layer wins. A
  // project document is more specific than the user one either way, so this is
  // why turning `borrow` off is the second half of the instruction.
  it('still sees a project layer as a source after it was imported', async () => {
    write('.mcp.json', { mcpServers: { git: { command: 'git-mcp' } } })
    const target = join(root, 'home/.dsh/mcp.json')
    await runImport({ target, cwd: root })
    const second = await runImport({ target, cwd: root })
    expect(second.decisions).toEqual([{ name: 'git', outcome: 'kept', source: join(root, '.mcp.json') }])
  })

  it('counts nothing as already own when no borrowed layer declares a server', async () => {
    write('.dsh/mcp.json', { mcpServers: { own: { command: 'mine' } } })
    const report = await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(report.alreadyOwn).toBe(0)
  })

  it('reports an unreadable layer instead of failing the whole import', async () => {
    write('.mcp.json', '{ this is not json')
    write('.kiro/settings/mcp.json', { mcpServers: { ok: { command: 'fine' } } })
    const report = await runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })
    expect(report.failures).toHaveLength(1)
    expect(read('.dsh/mcp.json').mcpServers).toEqual({ ok: { command: 'fine' } })
  })

  it('refuses a target that is not a JSON object rather than replacing it', async () => {
    write('.dsh/mcp.json', '[]')
    await expect(runImport({ target: join(root, '.dsh/mcp.json'), cwd: root })).rejects.toThrow(/JSON object/)
  })
})

describe('parseArgs', () => {
  it('resolves a relative target against the given cwd', () => {
    expect(parseArgs(['--cwd', '/proj', '--target', 'out.json']).target).toBe('/proj/out.json')
  })

  it('rejects a flag whose value is missing', () => {
    expect(() => parseArgs(['--target'])).toThrow(/requires a path/)
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/)
  })
})
