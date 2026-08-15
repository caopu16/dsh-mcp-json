import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discover, ensureDocument, layerSources, readLayer } from '../src/discover.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-mcp-json-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Write one document, creating parents. */
function write(relative: string, value: unknown): string {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
  return path
}

describe('layerSources', () => {
  it('puts the harness project document last, so it wins', () => {
    const sources = layerSources('/home/u/.dsh/mcp.json', '/proj')
    expect(sources.at(-1)).toEqual({ path: '/proj/.dsh/mcp.json', dialect: 'claude', tool: 'dsh' })
  })

  it('orders the harness user document after every borrowed user document', () => {
    const sources = layerSources('/home/u/.dsh/mcp.json', '/proj')
    const own = sources.findIndex(s => s.path === '/home/u/.dsh/mcp.json')
    const borrowedUser = sources.findIndex(s => s.tool !== 'dsh')
    expect(borrowedUser).toBeLessThan(own)
  })

  it('reads only the harness documents when borrowing is off', () => {
    const sources = layerSources('/home/u/.dsh/mcp.json', '/proj', false)
    expect(sources.map(s => s.path)).toEqual(['/home/u/.dsh/mcp.json', '/proj/.dsh/mcp.json'])
  })

  it('covers every supported tool', () => {
    const tools = new Set(layerSources('/home/u/.dsh/mcp.json', '/proj').map(s => s.tool))
    expect([...tools].sort()).toEqual(['claude-code', 'codex', 'dsh', 'kiro', 'opencode'])
  })

  it('resolves a relative user path against the project directory', () => {
    const sources = layerSources('custom.json', '/proj', false)
    expect(sources[0]?.path).toBe('/proj/custom.json')
  })
})

describe('ensureDocument', () => {
  it('creates a parsable empty document, parents included', async () => {
    const path = join(root, 'nested/.dsh/mcp.json')
    expect(await ensureDocument(path)).toBe(path)
    const result = await readLayer({ path, dialect: 'claude', tool: 'dsh' })
    expect(result.servers).toEqual([])
    expect(result.failure).toBeUndefined()
  })

  it('leaves an existing document untouched', async () => {
    const path = write('mcp.json', { mcpServers: { a: { command: 'x' } } })
    expect(await ensureDocument(path)).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
  })
})

describe('readLayer', () => {
  it('reports an absent file as empty without a failure', async () => {
    const result = await readLayer({ path: join(root, 'missing.json'), dialect: 'claude', tool: 'dsh' })
    expect(result.servers).toEqual([])
    expect(result.failure).toBeUndefined()
  })

  it('reads servers and records their source', async () => {
    const path = write('mcp.json', { mcpServers: { a: { command: 'x' } } })
    const result = await readLayer({ path, dialect: 'claude', tool: 'dsh' })
    expect(result.servers).toEqual([{ name: 'a', entry: { command: 'x' }, source: path }])
  })

  it('reports malformed JSON as a failure instead of throwing', async () => {
    // A broken project file must not take down the servers other layers define.
    const path = write('mcp.json', '{"mcpServers": }')
    const result = await readLayer({ path, dialect: 'claude', tool: 'dsh' })
    expect(result.servers).toEqual([])
    expect(result.failure).toMatch(/is not valid JSON/)
  })

  it('reports a document that is not an object', async () => {
    const path = write('mcp.json', '[]')
    expect((await readLayer({ path, dialect: 'claude', tool: 'dsh' })).failure).toMatch(/does not contain a JSON object/)
  })

  it('reports an mcpServers that is not an object', async () => {
    const path = write('mcp.json', { mcpServers: [] })
    expect((await readLayer({ path, dialect: 'claude', tool: 'dsh' })).failure).toMatch(/has a "mcpServers" section that is not an object/)
  })

  it('accepts a document with no mcpServers key', async () => {
    const path = write('mcp.json', { other: 1 })
    const result = await readLayer({ path, dialect: 'claude', tool: 'dsh' })
    expect(result.servers).toEqual([])
    expect(result.failure).toBeUndefined()
  })

  it('skips a non-object server entry', async () => {
    const path = write('mcp.json', { mcpServers: { good: { command: 'x' }, bad: 'nope' } })
    expect((await readLayer({ path, dialect: 'claude', tool: 'dsh' })).servers.map(s => s.name)).toEqual(['good'])
  })
})

describe('discover', () => {
  it('merges the layers with the most specific winning', async () => {
    write('home/mcp.json', { mcpServers: { shared: { command: 'user' }, userOnly: { command: 'u' } } })
    write('.dsh/mcp.json', { mcpServers: { shared: { command: 'dsh' }, projectOnly: { command: 'p' } } })

    const { servers } = await discover(join(root, 'home/mcp.json'), root, false)
    expect([...servers.keys()].sort()).toEqual(['projectOnly', 'shared', 'userOnly'])
    // .dsh/mcp.json is the most specific layer, so it defines `shared`.
    expect(servers.get('shared')?.entry.command).toBe('dsh')
    expect(servers.get('shared')?.source).toBe(join(root, '.dsh/mcp.json'))
  })

  it('returns every layer for diagnostics, in application order', async () => {
    const { layers } = await discover(join(root, 'home/mcp.json'), root, false)
    expect(layers.map(layer => layer.path)).toEqual([
      join(root, 'home/mcp.json'),
      join(root, '.dsh/mcp.json'),
    ])
  })

  it('keeps usable layers when another is malformed', async () => {
    write('home/mcp.json', { mcpServers: { good: { command: 'x' } } })
    write('.dsh/mcp.json', '{ broken')
    const { layers, servers } = await discover(join(root, 'home/mcp.json'), root, false)
    expect([...servers.keys()]).toEqual(['good'])
    expect(layers[1]?.failure).toMatch(/is not valid JSON/)
  })

  it('finds nothing when no layer exists', async () => {
    const { servers } = await discover(join(root, 'home/mcp.json'), root, false)
    expect(servers.size).toBe(0)
  })
})
