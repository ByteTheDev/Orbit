import { describe, expect, it } from 'vitest'
import { parsePatch } from '../diff'
import { buildLayout } from '../diffLayout'

describe('parsePatch without text hunks', () => {
  it('reads a binary change as git with no hunks, not as an agent edit', () => {
    const p = parsePatch('diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n')
    expect(p.git).toBe(true)
    expect(p.hunks).toEqual([])
    expect(p.header).toContain('Binary files a/logo.png and b/logo.png differ')
  })

  it('reads a pure rename the same way', () => {
    const p = parsePatch('diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n')
    expect(p.git).toBe(true)
    expect(p.hunks).toHaveLength(0)
  })
})

describe('buildLayout on large diffs', () => {
  it('stays within the word-diff budget and still lists every changed line', () => {
    // 400 pairs of long lines: word diffing all of them would cost far more than the budget allows.
    const long = 'token '.repeat(300)
    const body: string[] = []
    for (let i = 0; i < 400; i++) {
      body.push('-' + long + i)
      body.push('+' + long + (i + 1))
    }
    const started = Date.now()
    const layout = buildLayout(parsePatch(['@@ -1,800 +1,800 @@', ...body].join('\n')), { split: true, expanded: new Set(), fold: true })
    const elapsed = Date.now() - started
    expect(layout.rows.filter((r) => r.type === 'pair').length).toBe(400)
    // Generous bound: the point is that the budget keeps this from running for seconds.
    expect(elapsed).toBeLessThan(3000)
  })
})
