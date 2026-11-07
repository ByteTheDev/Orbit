// Sidebar width and collapsed state, remembered between launches. Kept apart from the store so the
// clamping and the storage fallback can be tested without a browser.

export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 560
export const SIDEBAR_DEFAULT = 300
/** Width of the collapsed rail: room for project marks and their status dots. */
export const SIDEBAR_RAIL = 56

const KEY = 'orbit.sidebar'

export interface SidebarPrefs {
  width: number
  collapsed: boolean
}

export const DEFAULT_SIDEBAR: SidebarPrefs = { width: SIDEBAR_DEFAULT, collapsed: false }

/** Keeps a width inside the allowed range. Non-numbers fall back to the default. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    // Some embedded browsers throw on access when storage is disabled.
    return null
  }
}

/** Reads saved prefs. Anything missing or malformed gives the defaults, never an error. */
export function loadSidebarPrefs(storage: KeyValueStore | null = defaultStorage()): SidebarPrefs {
  if (!storage) return { ...DEFAULT_SIDEBAR }
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SIDEBAR }
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>
    return {
      width: clampSidebarWidth(typeof parsed.width === 'number' ? parsed.width : SIDEBAR_DEFAULT),
      collapsed: parsed.collapsed === true,
    }
  } catch {
    return { ...DEFAULT_SIDEBAR }
  }
}

/** Saves prefs. A failed write is ignored: the sidebar still works, it just forgets on restart. */
export function saveSidebarPrefs(prefs: SidebarPrefs, storage: KeyValueStore | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Quota or access errors are not worth interrupting the user for.
  }
}
