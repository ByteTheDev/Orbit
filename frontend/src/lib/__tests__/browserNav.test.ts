import { describe, expect, it } from 'vitest'
import { canGoBack, canGoForward, currentPage, emptyHistory, goBack, goForward, settle, visit, withScheme } from '../browserNav'

describe('browser history', () => {
  it('starts empty with nothing to go back or forward to', () => {
    expect(currentPage(emptyHistory)).toBeNull()
    expect(canGoBack(emptyHistory)).toBe(false)
    expect(canGoForward(emptyHistory)).toBe(false)
  })

  it('moves back and forward through visited pages', () => {
    let h = visit(emptyHistory, 'https://a.test')
    h = visit(h, 'https://b.test')
    h = visit(h, 'https://c.test')
    expect(currentPage(goBack(h))).toBe('https://b.test')
    expect(currentPage(goBack(goBack(h)))).toBe('https://a.test')
    expect(goBack(goBack(goBack(h))).index).toBe(0)
  })

  it('drops forward entries when a new page is opened after going back', () => {
    let h = visit(emptyHistory, 'https://a.test')
    h = visit(h, 'https://b.test')
    h = goBack(h)
    h = visit(h, 'https://c.test')
    expect(h.entries).toEqual(['https://a.test', 'https://c.test'])
    expect(canGoForward(h)).toBe(false)
  })

  it('does not add the same page twice in a row', () => {
    const h = visit(emptyHistory, 'https://a.test')
    expect(visit(h, 'https://a.test')).toBe(h)
  })

  it('replaces the current entry with the final address after a redirect', () => {
    const h = settle(visit(emptyHistory, 'https://short.test'), 'https://long.test/page')
    expect(currentPage(h)).toBe('https://long.test/page')
    expect(settle(h, 'https://long.test/page')).toBe(h)
  })

  it('does not move past either end', () => {
    const h = visit(emptyHistory, 'https://a.test')
    expect(goBack(h)).toBe(h)
    expect(goForward(h)).toBe(h)
  })
})

describe('withScheme', () => {
  it('adds https:// to a bare host and keeps an address that has a scheme', () => {
    expect(withScheme('example.com/docs')).toBe('https://example.com/docs')
    expect(withScheme('  http://localhost:3000 ')).toBe('http://localhost:3000')
    expect(withScheme('HTTPS://Example.com')).toBe('HTTPS://Example.com')
  })

  it('returns null for blank input', () => {
    expect(withScheme('   ')).toBeNull()
  })
})
