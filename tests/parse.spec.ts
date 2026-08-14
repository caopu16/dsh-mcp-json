import { describe, expect, it } from 'vitest'
import { parseJsonc, stripJsonExtras } from '../src/parse.ts'

describe('stripJsonExtras', () => {
  it('leaves strict JSON untouched', () => {
    const text = '{"a":1,"b":[2,3]}'
    expect(stripJsonExtras(text)).toBe(text)
  })

  it('removes line comments', () => {
    expect(JSON.parse(stripJsonExtras('{ // note\n "a": 1 }'))).toEqual({ a: 1 })
  })

  it('removes block comments', () => {
    expect(JSON.parse(stripJsonExtras('{ /* note */ "a": 1 }'))).toEqual({ a: 1 })
  })

  it('removes a trailing comma before a closing brace', () => {
    expect(JSON.parse(stripJsonExtras('{"a":1,}'))).toEqual({ a: 1 })
  })

  it('removes a trailing comma before a closing bracket', () => {
    expect(JSON.parse(stripJsonExtras('{"a":[1,2,]}'))).toEqual({ a: [1, 2] })
  })

  it('removes a trailing comma separated from its brace by whitespace', () => {
    expect(JSON.parse(stripJsonExtras('{"a":1,\n  \n}'))).toEqual({ a: 1 })
  })

  it('keeps a double slash inside a string', () => {
    // A URL is the common case; treating this as a comment would truncate it.
    const parsed = JSON.parse(stripJsonExtras('{"url":"http://example.com/x"}'))
    expect(parsed).toEqual({ url: 'http://example.com/x' })
  })

  it('keeps a block-comment opener inside a string', () => {
    expect(JSON.parse(stripJsonExtras('{"s":"a /* b */ c"}'))).toEqual({ s: 'a /* b */ c' })
  })

  it('keeps a comma inside a string', () => {
    expect(JSON.parse(stripJsonExtras('{"s":"a, }"}'))).toEqual({ s: 'a, }' })
  })

  it('keeps an escaped quote from ending the string', () => {
    // Without escape handling, `\"` would close the string and the following
    // `//` would be stripped as a comment.
    expect(JSON.parse(stripJsonExtras('{"s":"a\\"//b"}'))).toEqual({ s: 'a"//b' })
  })

  it('preserves line numbers so parse errors still point at the source line', () => {
    const text = '{\n// comment\n"a": nope\n}'
    const stripped = stripJsonExtras(text)
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length)
  })

  it('tolerates an unterminated block comment', () => {
    expect(stripJsonExtras('{"a":1} /* trailing').trimEnd()).toBe('{"a":1}')
  })
})

describe('parseJsonc', () => {
  it('parses a relaxed document', () => {
    const text = '{\n // servers\n "mcpServers": { "a": { "command": "x" } },\n}'
    expect(parseJsonc(text, 'f.json')).toEqual({ mcpServers: { a: { command: 'x' } } })
  })

  it('names the file and the reason when the text is not JSON', () => {
    expect(() => parseJsonc('{"a": }', '/tmp/mcp.json'))
      .toThrowError(/mcp-json: \/tmp\/mcp\.json is not valid JSON/)
  })

  it('parses the trailing-comma shape real editors write', () => {
    // This is the exact deviation found in a live ~/.kiro/settings/mcp.json.
    const text = '{"mcpServers":{"a":{"command":"x","args":["y"]},}}'
    expect(parseJsonc(text, 'f.json')).toEqual({ mcpServers: { a: { command: 'x', args: ['y'] } } })
  })
})
