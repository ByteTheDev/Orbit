// Remembers when the user has marked a project's possible conflicts as resolved. The panel
// stays hidden until the set of conflicts changes, so a new conflict still shows up.
// Pure apart from the storage handle, which is injected so the logic can be unit-tested.

export interface ConflictLike {
  path: string
  agents: { id: string; name: string }[]
}

export const RESOLVED_KEY = 'orbit.resolvedConflicts'

/** A stable fingerprint of a conflict set: the paths and the agents writing them, sorted. */
export function conflictSignature(conflicts: ConflictLike[]): string {
  return conflicts
    .map((c) => `${c.path}|${c.agents.map((a) => a.id).sort().join(',')}`)
    .sort()
    .join('\n')
}

export type ResolvedMap = Record<string, string>

export function readResolved(storage: Pick<Storage, 'getItem'> | undefined): ResolvedMap {
  try {
    const raw = storage?.getItem(RESOLVED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as ResolvedMap) : {}
  } catch {
    return {}
  }
}

/** Returns true when this exact conflict set was already marked resolved for the project. */
export function isResolved(storage: Pick<Storage, 'getItem'> | undefined, projectId: string, conflicts: ConflictLike[]): boolean {
  return readResolved(storage)[projectId] === conflictSignature(conflicts)
}

/** Marks the current conflict set for a project as resolved. */
export function markResolved(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, projectId: string, conflicts: ConflictLike[]): void {
  if (!storage) return
  const map = readResolved(storage)
  map[projectId] = conflictSignature(conflicts)
  try {
    storage.setItem(RESOLVED_KEY, JSON.stringify(map))
  } catch {
    // Storage can be full or blocked. The panel then stays visible until the next launch, which is harmless.
  }
}
