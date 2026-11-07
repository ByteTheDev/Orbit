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

describe('tables, rules, links and strikethrough', () => {
  it('reads a pipe table with alignment and escaped pipes', () => {
    expect(parseBlocks('| Name | Size |\n| :--- | ---: |\n| a \\| b | 3 |\n| c | 4 |')).toEqual([
      {
        kind: 'table',
        header: ['Name', 'Size'],
        align: ['left', 'right'],
        rows: [
          ['a | b', '3'],
          ['c', '4'],
        ],
      },
    ])
  })

  it('keeps a pipe line as text when the separator does not match the columns', () => {
    expect(parseBlocks('a | b | c\n--- | ---')).toEqual([{ kind: 'paragraph', lines: ['a | b | c', '--- | ---'] }])
  })

  it('accepts one-dash separator cells, as GFM does', () => {
    expect(parseBlocks('| A | B |\n| :-- | --: |\n| 1 | 2 |')).toEqual([
      { kind: 'table', header: ['A', 'B'], align: ['left', 'right'], rows: [['1', '2']] },
    ])
  })

  it('reads a horizontal rule but not a list item', () => {
    expect(parseBlocks('---')).toEqual([{ kind: 'rule' }])
    expect(parseBlocks('- item')).toEqual([{ kind: 'list', ordered: false, items: ['item'] }])
  })

  it('reads http and https links, and leaves other schemes as text', () => {
    expect(parseInline('see [docs](https://example.com/a_b) now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com/a_b' },
      { kind: 'text', text: ' now' },
    ])
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ kind: 'text', text: '[x](javascript:alert(1))' }])
  })

  it('reads strikethrough', () => {
    expect(parseInline('~~old~~ new')).toEqual([
      { kind: 'strike', text: 'old' },
      { kind: 'text', text: ' new' },
    ])
  })

  it('never stalls on a stray pipe line followed by other text', () => {
    expect(parseBlocks('x | y\nplain line')).toEqual([{ kind: 'paragraph', lines: ['x | y', 'plain line'] }])
  })
})
