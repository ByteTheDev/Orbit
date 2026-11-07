// Inspector panel width, remembered between launches. Kept apart from the store, like sidebarPrefs,
// so the clamping and the storage fallback can be tested without a browser.

export const INSPECTOR_MIN = 320
/** The "expanded" width. The widest the chat panel goes beside the galaxy; full-width chat is focus mode. */
export const INSPECTOR_MAX = 600
export const INSPECTOR_DEFAULT = 420

const KEY = 'orbit.inspector'

/** Keeps a width inside the allowed range. Non-numbers fall back to the default. */
export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return INSPECTOR_DEFAULT
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(width)))
}

/** The expand button: a panel at or near the maximum collapses to the default, anything narrower expands to the maximum. */
export function toggleInspectorWidth(width: number): number {
  return width >= INSPECTOR_MAX - 8 ? INSPECTOR_DEFAULT : INSPECTOR_MAX
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

/** Reads the saved width. Anything missing or malformed gives the default, never an error. */
export function loadInspectorWidth(storage: KeyValueStore | null = defaultStorage()): number {
  if (!storage) return INSPECTOR_DEFAULT
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return INSPECTOR_DEFAULT
    const parsed = JSON.parse(raw) as { width?: unknown }
    return clampInspectorWidth(typeof parsed.width === 'number' ? parsed.width : INSPECTOR_DEFAULT)
  } catch {
    return INSPECTOR_DEFAULT
  }
}

/** Saves the width. A failed write is ignored: the panel still works, it just forgets on restart. */
export function saveInspectorWidth(width: number, storage: KeyValueStore | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify({ width: clampInspectorWidth(width) }))
  } catch {
    // Quota or access errors are not worth interrupting the user for.
  }
}
