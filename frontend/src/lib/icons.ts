// Uploaded project icons, decoded once per revision for the canvas. The renderer asks
// synchronously and gets null until the image has loaded; when it arrives, the listener
// (the universe's redraw) is called so the sun appears on the next frame.
import { api } from './bridge'

interface Entry {
  img: HTMLImageElement | null
  status: 'loading' | 'ready' | 'failed'
}

const cache = new Map<string, Entry>()
let onReady: (() => void) | null = null

/** Registers the callback that redraws the canvas when an icon finishes loading. */
export function setIconListener(fn: (() => void) | null): void {
  onReady = fn
}

/** The decoded icon for a project at a revision, or null while loading, if none exists, or on failure. */
export function projectIconImage(projectId: string, rev: number): HTMLImageElement | null {
  if (!rev) return null
  const key = `${projectId}:${rev}`
  const hit = cache.get(key)
  if (hit) return hit.status === 'ready' ? hit.img : null

  const entry: Entry = { img: null, status: 'loading' }
  cache.set(key, entry)
  // Revisions are replaced, never reused, so older entries for this project are dead weight.
  for (const k of cache.keys()) if (k.startsWith(`${projectId}:`) && k !== key) cache.delete(k)

  api
    .getProjectIcon(projectId)
    .then((url) => {
      if (!url) throw new Error('no icon')
      const img = new Image()
      img.onload = () => {
        entry.img = img
        entry.status = 'ready'
        onReady?.()
      }
      img.onerror = () => {
        entry.status = 'failed'
        onReady?.()
      }
      img.src = url
    })
    .catch(() => {
      entry.status = 'failed'
    })
  return null
}
