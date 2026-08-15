import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/index.ts'

describe('resolveConfig', () => {
  it('applies every default, so an empty section is a working configuration', () => {
    const resolved = resolveConfig({ cwd: '/proj' })
    expect(resolved.userPath).toBe(join(homedir(), '.dsh/mcp.json'))
    expect(resolved.borrow).toBe(true)
    expect(resolved.createUserPath).toBe(true)
    expect(resolved.watch).toBe(true)
    expect(resolved.debounceMs).toBe(150)
  })

  it('resolves a relative userPath against cwd rather than the process directory', () => {
    expect(resolveConfig({ cwd: '/proj', userPath: 'local.json' }).userPath).toBe('/proj/local.json')
  })

  it('narrows the watched set to the harness documents when borrowing is off', () => {
    expect(resolveConfig({ cwd: '/proj', borrow: false }).paths)
      .toEqual([join(homedir(), '.dsh/mcp.json'), '/proj/.dsh/mcp.json'])
  })

  // The settings layer merges over the composed entry, so a section that
  // restates a default arrives as an explicit field. Reloading on that would
  // disconnect every server for no change; the resolved form must compare equal.
  it('resolves a restated default to the same facts as an absent field', () => {
    expect(resolveConfig({ cwd: '/proj', borrow: true, watch: true, debounceMs: 150 }))
      .toEqual(resolveConfig({ cwd: '/proj' }))
  })

  it('changes the watched set when the project directory moves', () => {
    expect(resolveConfig({ cwd: '/a' }).paths).not.toEqual(resolveConfig({ cwd: '/b' }).paths)
  })
})
