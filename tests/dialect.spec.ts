import { describe, expect, it } from 'vitest'
import { normalizeDocument } from '../src/dialect.ts'

describe('normalizeDocument — claude / kiro', () => {
  it('reads mcpServers verbatim', () => {
    const entries = normalizeDocument({ mcpServers: { a: { command: 'x', args: ['y'] } } }, 'claude')
    expect(entries).toEqual({ a: { command: 'x', args: ['y'] } })
  })

  it('accepts a document with no server section', () => {
    expect(normalizeDocument({ other: 1 }, 'claude')).toBeUndefined()
  })

  it('refuses a non-object server section', () => {
    expect(() => normalizeDocument({ mcpServers: [] }, 'claude'))
      .toThrowError(/has a "mcpServers" section that is not an object/)
  })

  it('refuses a document that is not an object', () => {
    expect(() => normalizeDocument([], 'claude')).toThrowError(/does not contain a JSON object/)
  })

  it('skips a non-object entry', () => {
    expect(normalizeDocument({ mcpServers: { good: { command: 'x' }, bad: 'nope' } }, 'claude'))
      .toEqual({ good: { command: 'x' } })
  })
})

describe('normalizeDocument — opencode', () => {
  it('splits the argv array into command and args', () => {
    // OpenCode writes one argv array; the harness client wants them separate.
    const entries = normalizeDocument({
      mcp: { codegraph: { type: 'local', command: ['pnpm', 'exec', 'codegraph', 'serve', '--mcp'] } },
    }, 'opencode')
    expect(entries?.codegraph).toEqual({
      type: 'stdio',
      command: 'pnpm',
      args: ['exec', 'codegraph', 'serve', '--mcp'],
    })
  })

  it('maps remote to http and keeps the url', () => {
    const entries = normalizeDocument({
      mcp: { api: { type: 'remote', url: 'http://h/mcp' } },
    }, 'opencode')
    expect(entries?.api).toEqual({ type: 'http', url: 'http://h/mcp' })
  })

  it('renames environment to env', () => {
    const entries = normalizeDocument({
      mcp: { a: { type: 'local', command: ['x'], environment: { K: 'v' } } },
    }, 'opencode')
    expect(entries?.a).toMatchObject({ env: { K: 'v' } })
  })

  it('translates enabled false into disabled true', () => {
    const entries = normalizeDocument({ mcp: { a: { command: ['x'], enabled: false } } }, 'opencode')
    expect(entries?.a).toMatchObject({ disabled: true })
  })

  it('treats an absent enabled as on', () => {
    const entries = normalizeDocument({ mcp: { a: { command: ['x'] } } }, 'opencode')
    expect(entries?.a.disabled).toBeUndefined()
  })

  it('infers http from a url when no type is given', () => {
    const entries = normalizeDocument({ mcp: { a: { url: 'http://h/mcp' } } }, 'opencode')
    expect(entries?.a).toMatchObject({ type: 'http' })
  })

  it('omits args when the argv array holds only the executable', () => {
    const entries = normalizeDocument({ mcp: { a: { command: ['x'] } } }, 'opencode')
    expect(entries?.a.args).toBeUndefined()
  })

  it('ignores every section but mcp', () => {
    expect(normalizeDocument({ plugin: [], lsp: {}, formatter: {} }, 'opencode')).toBeUndefined()
  })

  it('refuses a non-object mcp section', () => {
    expect(() => normalizeDocument({ mcp: 'nope' }, 'opencode'))
      .toThrowError(/has an "mcp" section that is not an object/)
  })
})

describe('normalizeDocument — codex', () => {
  it('reads mcp_servers, whose fields already match', () => {
    const entries = normalizeDocument({
      mcp_servers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'], env: { K: 'v' } } },
    }, 'codex')
    expect(entries?.fetch).toEqual({ command: 'uvx', args: ['mcp-server-fetch'], env: { K: 'v' } })
  })

  it('accepts a config file that declares no servers', () => {
    // ~/.codex/config.toml carries unrelated settings on most machines.
    expect(normalizeDocument({ model: 'gpt-5', approval_policy: 'on-request' }, 'codex')).toBeUndefined()
  })

  it('refuses a non-object mcp_servers', () => {
    expect(() => normalizeDocument({ mcp_servers: 1 }, 'codex'))
      .toThrowError(/has a "mcp_servers" section that is not an object/)
  })
})
