// Back and forward history for the built-in browser. Pure, so it can be tested without React.
// Each step returns a new History; nothing is mutated.

export interface BrowserHistory {
  entries: string[]
  /** Index of the page on screen, or -1 when nothing has been visited. */
  index: number
}

export const emptyHistory: BrowserHistory = { entries: [], index: -1 }

/** The page on screen, or null when there is none. */
export function currentPage(h: BrowserHistory): string | null {
  return h.index >= 0 ? h.entries[h.index] : null
}

export function canGoBack(h: BrowserHistory): boolean {
  return h.index > 0
}

export function canGoForward(h: BrowserHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1
}

/** Opens a page after the current one. Forward entries are dropped, as in a normal browser. */
export function visit(h: BrowserHistory, url: string): BrowserHistory {
  if (currentPage(h) === url) return h
  const entries = [...h.entries.slice(0, h.index + 1), url]
  return { entries, index: entries.length - 1 }
}

export function goBack(h: BrowserHistory): BrowserHistory {
  return canGoBack(h) ? { ...h, index: h.index - 1 } : h
}

export function goForward(h: BrowserHistory): BrowserHistory {
  return canGoForward(h) ? { ...h, index: h.index + 1 } : h
}

/** Swaps the page on screen for the address it finally loaded from, after redirects. */
export function settle(h: BrowserHistory, finalUrl: string): BrowserHistory {
  if (h.index < 0 || h.entries[h.index] === finalUrl) return h
  const entries = h.entries.slice()
  entries[h.index] = finalUrl
  return { ...h, entries }
}

/**
 * Turns what the user typed into an address. A bare host such as "example.com" gets https://.
 * Returns null for blank input.
 */
export function withScheme(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
}
