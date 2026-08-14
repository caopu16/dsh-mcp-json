import { describe, expect, it } from 'vitest'
import { isDisabled, McpJsonEntryError, toClientConfig } from '../src/map.ts'
import type { DiscoveredServer } from '../src/types.ts'

/** One discovered entry, with the source a diagnostic would name. */
function server(name: string, entry: DiscoveredServer['entry']): DiscoveredServer {
  return { name, entry, source: '/home/u/.dsh/mcp.json' }
}

describe('toClientConfig', () => {
  it('maps an explicit stdio entry', () => {
    const config = toClientConfig(
      server('fetch', { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: { A: '1' }, cwd: '/w' }),
      '/default',
    )
    expect(config).toEqual({
      transport: 'stdio',
      serverName: 'fetch',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      env: { A: '1' },
      cwd: '/w',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('infers stdio when a command entry names no type', () => {
    // The commonest hand-written form omits `type` entirely.
    const config = toClientConfig(server('fetch', { command: 'uvx' }), '/default')
    expect(config).toMatchObject({ transport: 'stdio', command: 'uvx' })
  })

  it('falls back to the project directory when an entry names no cwd', () => {
    const config = toClientConfig(server('fetch', { command: 'uvx' }), '/default')
    expect(config).toMatchObject({ cwd: '/default' })
  })

  it.each(['http', 'streamable-http', 'sse', 'HTTP'])('maps a %s entry to streamable-http', (type) => {
    const config = toClientConfig(server('api', { type, url: 'https://x/mcp' }), '/default')
    expect(config).toMatchObject({ transport: 'streamable-http', url: 'https://x/mcp' })
  })

  it('infers http when an entry names a url and no type', () => {
    const config = toClientConfig(server('api', { url: 'https://x/mcp' }), '/default')
    expect(config).toMatchObject({ transport: 'streamable-http' })
  })

  it('passes http headers through', () => {
    const config = toClientConfig(
      server('api', { type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }),
      '/default',
    )
    expect(config).toMatchObject({ headers: { Authorization: 'Bearer t' } })
  })

  it('defaults absent args, env, and headers to empty', () => {
    expect(toClientConfig(server('a', { command: 'x' }), '/d')).toMatchObject({ args: [], env: {} })
    expect(toClientConfig(server('b', { url: 'u' }), '/d')).toMatchObject({ headers: {} })
  })

  it('names the file when a stdio entry omits its command', () => {
    expect(() => toClientConfig(server('broken', { type: 'stdio' }), '/d'))
      .toThrowError(/server "broken" in \/home\/u\/\.dsh\/mcp\.json declares a stdio transport but names no "command"/)
  })

  it('names the file when an http entry omits its url', () => {
    expect(() => toClientConfig(server('broken', { type: 'http' }), '/d'))
      .toThrowError(/names no "url"/)
  })

  it('refuses an unsupported transport', () => {
    expect(() => toClientConfig(server('broken', { type: 'websocket', url: 'u' }), '/d'))
      .toThrowError(/declares an unsupported transport "websocket"/)
  })

  it.each(['has.a.dot', 'way-too-long-a-name-for-a-tool-namespace-x', '', 'has space'])(
    'refuses the unusable server name %j',
    (name) => {
      expect(() => toClientConfig(server(name, { command: 'x' }), '/d'))
        .toThrowError(McpJsonEntryError)
    },
  )

  it('accepts a name at the 32-character limit', () => {
    const name = 'a'.repeat(32)
    expect(toClientConfig(server(name, { command: 'x' }), '/d')).toMatchObject({ serverName: name })
  })

  it('ignores autoApprove, which the approval capability owns', () => {
    const config = toClientConfig(server('a', { command: 'x', autoApprove: ['read'] }), '/d')
    expect(Object.keys(config)).not.toContain('autoApprove')
  })
})

describe('isDisabled', () => {
  it('reports a disabled entry', () => {
    expect(isDisabled(server('a', { command: 'x', disabled: true }))).toBe(true)
  })

  it.each([undefined, false])('treats disabled %s as enabled', (disabled) => {
    expect(isDisabled(server('a', { command: 'x', ...disabled === undefined ? {} : { disabled } }))).toBe(false)
  })
})
