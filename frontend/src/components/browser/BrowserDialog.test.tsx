// Static-markup check for the browser dialog. It renders the first frame (no page loaded yet), so
// it catches crashes and broken wiring. Loading and navigation are covered by browserNav.test.ts.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowserDialog } from './BrowserDialog'

describe('BrowserDialog', () => {
  it('renders the empty state with toolbar and address field', () => {
    const html = renderToStaticMarkup(<BrowserDialog onClose={() => {}} />)
    expect(html).toContain('Enter an address')
    expect(html).toContain('aria-label="Web address"')
    expect(html).toContain('Open in browser')
  })

  it('renders without crashing when started with an address', () => {
    const html = renderToStaticMarkup(<BrowserDialog initialUrl="https://example.com" onClose={() => {}} />)
    expect(html).toContain('Browser')
  })
})
