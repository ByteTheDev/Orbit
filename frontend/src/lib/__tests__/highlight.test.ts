import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightLines, languageFor, lineHtml, markChanged, splitHighlighted } from '../highlight'
import { intraline, changedFlags } from '../wordDiff'
import { parsePatch } from '../diff'
import { highlightPatch } from '../highlight'

describe('languageFor', () => {
  it('maps common extensions and ignores case', () => {
    expect(languageFor('src/App.TSX')).toBe('typescript')
    expect(languageFor('main.go')).toBe('go')
    expect(languageFor('config.toml')).toBe('ini')
    expect(languageFor('Makefile')).toBeNull()
    expect(languageFor('notes.unknownext')).toBeNull()
  })
})

describe('splitHighlighted', () => {
  it('splits at newlines and closes and reopens a token that spans lines', () => {
    const html = '<span class="hljs-comment">/* one\ntwo */</span> x'
    expect(splitHighlighted(html)).toEqual(['<span class="hljs-comment">/* one</span>', '<span class="hljs-comment">two */</span> x'])
  })

  it('returns one entry per line, including empty lines', () => {
    expect(splitHighlighted('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitHighlighted('')).toEqual([''])
  })
})

describe('highlightLines', () => {
  it('colours keywords and keeps one entry per line', () => {
    const lines = highlightLines('const a = 1\nreturn a', 'typescript')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('hljs-keyword')
  })

  it('escapes plain text, so code cannot inject markup', () => {
    expect(highlightLines('<b>x</b>', null)).toEqual(['&lt;b&gt;x&lt;/b&gt;'])
    expect(escapeHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;')
  })
})

describe('markChanged', () => {
  it('wraps changed characters and leaves markup intact', () => {
    // The plain text is "abcd"; only the "b" changed.
    const html = '<span class="k">ab</span>cd'
    expect(markChanged(html, [false, true, false, false])).toBe('<span class="k">a<mark class="diff-word">b</mark></span>cd')
  })

  it('counts an entity as one character', () => {
    const out = markChanged('&amp;x', [true, false])
    expect(out).toBe('<mark class="diff-word">&amp;</mark>x')
  })

  it('leaves unchanged lines untouched', () => {
    expect(lineHtml({ kind: 'add', oldNo: null, newNo: 1, text: 'hi', html: 'hi' }, [{ text: 'hi', changed: false }])).toBe('hi')
  })
})

describe('intraline', () => {
  it('marks only the words that differ', () => {
    const { old, new: next } = intraline('return count + 1', 'return count + 2')
    expect(old.filter((s) => s.changed).map((s) => s.text)).toEqual(['1'])
    expect(next.filter((s) => s.changed).map((s) => s.text)).toEqual(['2'])
  })

  it('keeps the text intact when joined back together', () => {
    const { old, new: next } = intraline('a b c', 'a x c d')
    expect(old.map((s) => s.text).join('')).toBe('a b c')
    expect(next.map((s) => s.text).join('')).toBe('a x c d')
  })

  it('marks identical lines as unchanged and empty input as no segments', () => {
    expect(intraline('same', 'same').old.every((s) => !s.changed)).toBe(true)
    expect(changedFlags(intraline('', 'x').new)).toEqual([true])
  })
})

describe('highlightPatch', () => {
  it('gives every line of a hunk its highlighted HTML', () => {
    const patch = parsePatch('@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = "two"')
    highlightPatch(patch, 'x.ts')
    for (const line of patch.hunks[0].lines) expect(typeof line.html).toBe('string')
  })
})
