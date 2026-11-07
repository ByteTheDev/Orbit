// The top bar's right side: New agent, then one menu trigger. The secondary views live in the menu,
// which is closed at render time, so they are not in the bar's markup.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  const html = renderToStaticMarkup(<TopBar />)

  it('shows a single menu trigger after New agent', () => {
    const newAgent = html.indexOf('aria-label="New agent"')
    const menu = html.indexOf('aria-label="Menu"')
    expect(newAgent).toBeGreaterThan(-1)
    expect(menu).toBeGreaterThan(newAgent)
    expect(html.match(/aria-label="Menu"/g)).toHaveLength(1)
  })

  it('no longer lists Dashboard, Browser or Settings as top-level buttons', () => {
    expect(html).not.toContain('aria-label="Toggle dashboard"')
    expect(html).not.toContain('aria-label="Browser"')
    expect(html).not.toContain('aria-label="Settings"')
  })

  it('keeps the menu closed and announces that it opens a menu', () => {
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps the activity summary in the bar', () => {
    expect(html).toContain('aria-live="polite"')
  })
})
