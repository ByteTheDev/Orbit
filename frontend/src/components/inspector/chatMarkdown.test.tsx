// What a reply renders to. Static markup, so no DOM is needed.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdownish } from './ChatMarkdown'
import { ToolDiff } from './ToolDiff'

const html = (text: string) => renderToStaticMarkup(<Markdownish text={text} />)

describe('Markdownish rendering', () => {
  it('renders a table with header cells and alignment classes', () => {
    const out = html('| A | B |\n| :-- | --: |\n| 1 | 2 |')
    expect(out).toContain('<table')
    expect(out).toContain('<th')
    expect(out).toMatch(/<th[^>]*text-right[^>]*>B<\/th>/)
    expect(out).toContain('>2<')
  })

  it('renders only http and https links, opened by a handler rather than navigation', () => {
    expect(html('[ok](https://example.com)')).toContain('href="https://example.com"')
    const bad = html('[x](javascript:alert(1))')
    expect(bad).not.toContain('<a ')
    expect(bad).toContain('[x](javascript:alert(1))')
  })

  it('escapes markup in replies instead of injecting it', () => {
    const out = html('<img src=x onerror=alert(1)> and `<b>`')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('shows a code block with its language label and a copy button', () => {
    const out = html('```ts\nconst a = 1\n```')
    expect(out).toContain('ts')
    expect(out).toContain('1 line')
    expect(out).toContain('aria-label="Copy code"')
    expect(out).toContain('text-[#c4a7ff]')
  })

  it('collapses a long code block behind a toggle', () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
    const out = html('```\n' + body + '\n```')
    expect(out).toContain('Show all 30 lines')
    expect(out).not.toContain('line29')
  })
})

describe('ToolDiff', () => {
  it('shows removed and added lines with their file name', () => {
    const out = renderToStaticMarkup(
      <ToolDiff preview={{ path: 'src/app/main.ts', hunks: [{ before: 'old line', after: 'new line' }] }} />,
    )
    expect(out).toContain('main.ts')
    expect(out).toContain('old line')
    expect(out).toContain('new line')
  })
})
