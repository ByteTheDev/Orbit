// Pure helpers for the native page view: where it sits, how the address bar reads, and how a
// landed page changes the history. No React and no Wails, so they can be tested directly.

import { canGoBack, canGoForward, currentPage, goBack, goForward, settle, visit, type BrowserHistory } from './browserNav'

export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

export interface PhysicalBounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Converts a CSS-pixel rectangle into the physical pixels the native view needs. Negative sizes
 * collapse to one pixel, so an unmeasured or hidden viewport never sends an invalid size.
 */
export function physicalBounds(rect: ViewportRect, devicePixelRatio: number): PhysicalBounds {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1
  return {
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    w: Math.max(1, Math.round(rect.width * dpr)),
    h: Math.max(1, Math.round(rect.height * dpr)),
  }
}

export interface AddressParts {
  /** Whether the page came over HTTPS. */
  secure: boolean
  /** The scheme, shown dimmed, such as "https://". */
  scheme: string
  /** The host, shown bright. */
  host: string
  /** The path, query and fragment, shown dimmed. */
  rest: string
}

/** Splits an address into the parts the address bar shows in different tones. */
export function addressParts(url: string): AddressParts {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url)
  if (!m) return { secure: false, scheme: '', host: url, rest: '' }
  return { secure: m[1].toLowerCase() === 'https://', scheme: m[1], host: m[2], rest: m[3] }
}

/** What the user did that led to the current landing, so the history can follow it. */
export type Intent = 'navigate' | 'back' | 'forward' | 'page'

/**
 * Folds a landed page into the history. A typed address or a redirect settles the entry that was
 * already added. Back and forward move through the entries they came from. Anything else, such as
 * a link clicked inside the page, opens a new entry.
 */
export function landed(h: BrowserHistory, url: string, intent: Intent): BrowserHistory {
  if (currentPage(h) === url) return h
  if (intent === 'back' && canGoBack(h) && h.entries[h.index - 1] === url) return goBack(h)
  if (intent === 'forward' && canGoForward(h) && h.entries[h.index + 1] === url) return goForward(h)
  if (intent === 'navigate') return settle(h, url)
  return visit(h, url)
}
