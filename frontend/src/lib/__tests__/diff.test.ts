import { describe, expect, it } from 'vitest'
import { parseDiff } from '../diff'

describe('parseDiff', () => {
  const sample = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111..2222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -12,3 +12,4 @@ export function f() {',
    '   const x = 1',
    '-  return 0',
    '+  if (ready) return 1',
    '+  return 0',
    '   // end',
  ].join('\n')

  it('counts additions and deletions', () => {
    const d = parseDiff(sample)
    expect(d.additions).toBe(2)
    expect(d.deletions).toBe(1)
  })

  it('numbers context, removed and added lines from the hunk header', () => {
    const rows = parseDiff(sample).rows
    const ctx = rows.filter((r) => r.kind === 'ctx')
    expect(ctx.map((r) => [r.oldNo, r.newNo])).toEqual([
      [12, 12],
      [14, 15],
    ])
    const del = rows.find((r) => r.kind === 'del')!
    expect([del.oldNo, del.newNo]).toEqual([13, null])
    const adds = rows.filter((r) => r.kind === 'add')
    expect(adds.map((r) => [r.oldNo, r.newNo])).toEqual([
      [null, 13],
      [null, 14],
    ])
  })

  it('keeps file headers as metadata and does not count them as changes', () => {
    const rows = parseDiff(sample).rows
    expect(rows.find((r) => r.text === '--- a/src/a.ts')?.kind).toBe('meta')
    expect(rows.find((r) => r.text === '+++ b/src/a.ts')?.kind).toBe('meta')
  })

  it('treats "--" and "++" inside a hunk as content, not headers', () => {
    const text = ['@@ -1,2 +1,2 @@', '--- a comment', '+++ b', ' x'].join('\n')
    const d = parseDiff(text)
    expect(d.deletions).toBe(1)
    expect(d.additions).toBe(1)
    expect(d.rows.find((r) => r.kind === 'del')?.text).toBe('-- a comment')
  })

  it('tolerates empty, malformed and non-string input', () => {
    expect(parseDiff('').rows).toEqual([])
    // An unparseable hunk header never opens a hunk, so its lines are not counted as changes.
    expect(parseDiff('@@ nonsense @@\n+x').additions).toBe(0)
    expect(parseDiff(undefined as unknown as string).rows).toEqual([])
  })
})
