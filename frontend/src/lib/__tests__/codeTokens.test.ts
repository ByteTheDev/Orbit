import { describe, expect, it } from 'vitest'
import { tokenizeLines } from '../codeTokens'

const kinds = (code: string, lang: string) => tokenizeLines(code, lang)[0].map((t) => [t.kind, t.text])

describe('tokenizeLines', () => {
  it('colours keywords, strings, numbers, calls and types in JavaScript', () => {
    const toks = kinds('const n = 42; log("hi") + new Map() + Date', 'ts').filter(([k]) => k !== 'plain' && k !== 'punct')
    expect(toks).toEqual([
      ['keyword', 'const'],
      ['number', '42'],
      ['fn', 'log'],
      ['string', '"hi"'],
      ['keyword', 'new'],
      ['fn', 'Map'],
      ['type', 'Date'],
    ])
  })

  it('splits multi-line comments across lines', () => {
    const lines = tokenizeLines('/* one\ntwo */ x', 'js')
    expect(lines.length).toBe(2)
    expect(lines[0]).toEqual([{ kind: 'comment', text: '/* one' }])
    expect(lines[1][0]).toEqual({ kind: 'comment', text: 'two */' })
  })

  it('treats # as a comment in Python but not in JavaScript', () => {
    expect(kinds('# note', 'python')).toEqual([['comment', '# note']])
    expect(kinds('#x', 'js')).not.toEqual([['comment', '#x']])
  })

  it('does not read digits inside identifiers as numbers', () => {
    expect(kinds('v2', 'js')).toEqual([['plain', 'v2']])
  })

  it('colours diff lines by their first character', () => {
    const lines = tokenizeLines('@@ -1 +1 @@\n-old\n+new\n context', 'diff')
    expect(lines.map((l) => l[0].kind)).toEqual(['hunk', 'del', 'add', 'plain'])
  })

  it('keeps unknown languages plain apart from strings and numbers', () => {
    expect(tokenizeLines('anything 1 "x"', 'cobol')[0].map((t) => t.kind)).toEqual(['plain', 'number', 'plain', 'string'])
    expect(tokenizeLines('const x', 'cobol')[0]).toEqual([{ kind: 'plain', text: 'const x' }])
  })

  it('returns one empty line for empty input', () => {
    expect(tokenizeLines('', 'js')).toEqual([[]])
  })

  it('keeps an unterminated string to its own line', () => {
    expect(tokenizeLines('"open\nnext', 'js')[1]).toEqual([{ kind: 'plain', text: 'next' }])
  })
})
