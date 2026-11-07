import { useEffect, useState } from 'react'
import { api } from '../../lib/bridge'
import { identityFor } from '../../lib/projectIdentity'

/** Uploaded icons as data URLs, keyed by project and revision. Revisions change on upload, so entries never go stale. */
const urlCache = new Map<string, string>()

/** The uploaded icon for a project, or null when there is none (or it has not loaded yet). */
function useUploadedIcon(projectId: string, rev: number): string | null {
  const key = `${projectId}:${rev}`
  const [url, setUrl] = useState<string | null>(() => urlCache.get(key) ?? null)

  useEffect(() => {
    if (!rev) return
    const hit = urlCache.get(key)
    if (hit) {
      setUrl(hit)
      return
    }
    let alive = true
    api
      .getProjectIcon(projectId)
      .then((data) => {
        if (!data) return
        // Older revisions of this project are dead weight once a newer one has loaded.
        for (const k of urlCache.keys()) if (k.startsWith(`${projectId}:`)) urlCache.delete(k)
        urlCache.set(key, data)
        if (alive) setUrl(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectId, rev, key])

  return rev ? url : null
}

interface Props {
  project: { id: string; icon?: string; iconRev?: number }
  /** Tile edge in CSS pixels. Glyphs and letters scale with it. */
  size?: number
}

/**
 * A project's mark: its uploaded icon, or its custom letter. Renders nothing otherwise, so the
 * name stands alone. Decorative: the row it sits in carries the name.
 */
export function ProjectMark({ project, size = 28 }: Props) {
  const identity = identityFor(project.id)
  const uploaded = useUploadedIcon(project.id, project.iconRev ?? 0)
  const tile = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    background: `${identity.accent}1a`,
    boxShadow: `inset 0 0 0 1px ${identity.accent}33`,
  }

  if (uploaded) {
    return (
      <span className="inline-flex shrink-0 overflow-hidden" style={tile} aria-hidden="true">
        <img src={uploaded} alt="" className="h-full w-full object-cover" />
      </span>
    )
  }

  const letter = project.icon?.trim()
  if (letter) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center font-semibold leading-none"
        style={{ ...tile, color: identity.accent, fontSize: Math.round(size * (letter.length > 1 ? 0.36 : 0.44)) }}
        aria-hidden="true"
      >
        {letter}
      </span>
    )
  }

  // No generated fallback: a project with no uploaded icon or letter shows only its name.
  return null
}
