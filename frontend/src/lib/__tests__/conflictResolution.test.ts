import { describe, expect, it } from 'vitest'
import { conflictSignature, isResolved, markResolved, readResolved, RESOLVED_KEY, type ConflictLike } from '../conflictResolution'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  } as Storage
}

const a: ConflictLike[] = [{ path: 'src/a.ts', agents: [{ id: '1', name: 'Claude' }, { id: '2', name: 'Codex' }] }]

describe('conflictSignature', () => {
  it('ignores the order of paths and agents', () => {
    const reordered: ConflictLike[] = [{ path: 'src/a.ts', agents: [{ id: '2', name: 'Codex' }, { id: '1', name: 'Claude' }] }]
    expect(conflictSignature(a)).toBe(conflictSignature(reordered))
  })

  it('changes when a new file or agent joins the conflict', () => {
    const more: ConflictLike[] = [...a, { path: 'src/b.ts', agents: [{ id: '1', name: 'Claude' }] }]
    expect(conflictSignature(more)).not.toBe(conflictSignature(a))
  })
})

describe('resolved state', () => {
  it('is false until marked, then true for the same conflicts', () => {
    const s = memoryStorage()
    expect(isResolved(s, 'p1', a)).toBe(false)
    markResolved(s, 'p1', a)
    expect(isResolved(s, 'p1', a)).toBe(true)
  })

  it('reappears when the conflict set changes', () => {
    const s = memoryStorage()
    markResolved(s, 'p1', a)
    const changed: ConflictLike[] = [{ path: 'src/c.ts', agents: [{ id: '1', name: 'Claude' }, { id: '2', name: 'Codex' }] }]
    expect(isResolved(s, 'p1', changed)).toBe(false)
  })

  it('is per project', () => {
    const s = memoryStorage()
    markResolved(s, 'p1', a)
    expect(isResolved(s, 'p2', a)).toBe(false)
  })

  it('treats broken stored data as empty', () => {
    const s = memoryStorage()
    s.setItem(RESOLVED_KEY, '{not json')
    expect(readResolved(s)).toEqual({})
    expect(isResolved(undefined, 'p1', a)).toBe(false)
  })
})
