import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from '../markdown'

describe('parseBlocks', () => {
  it('splits paragraphs on blank lines and keeps soft line breaks inside one', () => {
    expect(parseBlocks('one\ntwo\n\nthree')).toEqual([
      { kind: 'paragraph', lines: ['one', 'two'] },
      { kind: 'paragraph', lines: ['three'] },
    ])
  })

  it('reads bullet and numbered lists as single blocks', () => {
    expect(parseBlocks('- a\n- b\n* c')).toEqual([{ kind: 'list', ordered: false, items: ['a', 'b', 'c'] }])
    expect(parseBlocks('1. first\n2) second')).toEqual([{ kind: 'list', ordered: true, items: ['first', 'second'] }])
  })

  it('reads headings and quotes', () => {
    expect(parseBlocks('## Title')).toEqual([{ kind: 'heading', level: 2, text: 'Title' }])
    expect(parseBlocks('> a\n> b')).toEqual([{ kind: 'quote', lines: ['a', 'b'] }])
  })

  it('keeps fenced code verbatim, including markdown inside it', () => {
    expect(parseBlocks('```ts\n- not a list\n**x**\n```')).toEqual([{ kind: 'code', lang: 'ts', text: '- not a list\n**x**' }])
  })

  it('treats an unterminated fence as running to the end (streaming)', () => {
    expect(parseBlocks('```\npartial')).toEqual([{ kind: 'code', lang: '', text: 'partial' }])
  })

  it('ends a paragraph when a list starts without a blank line', () => {
    expect(parseBlocks('intro\n- item')).toEqual([
      { kind: 'paragraph', lines: ['intro'] },
      { kind: 'list', ordered: false, items: ['item'] },
    ])
  })

  it('handles CRLF line endings and empty input', () => {
    expect(parseBlocks('a\r\nb')).toEqual([{ kind: 'paragraph', lines: ['a', 'b'] }])
    expect(parseBlocks('')).toEqual([])
  })
})

describe('parseInline', () => {
  it('finds code, bold and italic runs', () => {
    expect(parseInline('use `npm test` and **bold** or *em*')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' or ' },
      { kind: 'italic', text: 'em' },
    ])
  })

  it('does not style inside code', () => {
    expect(parseInline('`**x**`')).toEqual([{ kind: 'code', text: '**x**' }])
  })

  it('leaves unmatched markers and spaced asterisks as text', () => {
    expect(parseInline('2 * 3 * 4 and a **b')).toEqual([{ kind: 'text', text: '2 * 3 * 4 and a **b' }])
  })
})
