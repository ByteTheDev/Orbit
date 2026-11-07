// Keeps the Files and Git sidebars current without polling. One watcher event stream feeds both views:
// file changes reload the folders that changed, and git status is re-read at most once per burst. Git
// reads are coalesced per project, so several agents finishing at once cause one status read, not many.
import { useEffect, useRef, useState } from 'react'
import { useStore, getState, setState } from './store'
import { api, errorText, onProjectFiles } from './bridge'
import type { AgentSummary, GitStatus, ProjectFilesChange } from '../types'

/** How long a burst of changes waits before the views re-read. Long enough to merge a save, short enough to feel live. */
export const REFRESH_DEBOUNCE_MS = 250

// ---- file-change stream ------------------------------------------------------------

type FsListener = (change: ProjectFilesChange) => void
const fsListeners = new Set<FsListener>()
let subscribed = false
let unsubscribe: (() => void) | undefined

/**
 * Subscribes a view to file-change batches. The first subscriber opens the backend stream; the last
 * one to leave closes it. Returns a function that unsubscribes.
 */
export function listenFileChanges(listener: FsListener): () => void {
  fsListeners.add(listener)
  if (!subscribed) {
    subscribed = true
    unsubscribe = onProjectFiles((change) => {
      for (const l of [...fsListeners]) l(change)
    })
  }
  return () => {
    fsListeners.delete(listener)
    if (fsListeners.size === 0 && subscribed) {
      subscribed = false
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}

// ---- git status ----------------------------------------------------------------------

const inflight = new Map<string, Promise<GitStatus>>()
const queued = new Set<string>()

/**
 * Reads a project's git status and stores it. A read that is already running absorbs the request, and
 * one more read follows it if the request arrived in the meantime. Rejects with a readable message.
 */
export function refreshRepo(projectId: string): Promise<GitStatus> {
  const running = inflight.get(projectId)
  if (running) {
    queued.add(projectId)
    return running
  }
  const p = api
    .getGitStatus(projectId)
    .then((status) => {
      setState((s) => ({ repoStatus: { ...s.repoStatus, [projectId]: status } }))
      return status
    })
    .finally(() => {
      inflight.delete(projectId)
      if (queued.delete(projectId)) void refreshRepo(projectId).catch(() => {})
    })
  inflight.set(projectId, p)
  return p
}

// ---- hooks -----------------------------------------------------------------------------

/**
 * A signature of what agents are writing in a project right now. It changes when an agent starts or
 * stops writing a file, so the Git view can refresh while work is happening, not only when a turn ends.
 */
function writeSignature(agents: Record<string, AgentSummary>, order: string[], projectId: string): string {
  const parts: string[] = []
  for (const id of order) {
    const a = agents[id]
    if (!a || a.projectId !== projectId) continue
    for (const f of a.recentFiles ?? []) if (f.state === 'writing') parts.push(`${id}|${f.path}|${f.lastAt}`)
  }
  return parts.sort().join('\n')
}

/**
 * The git status of the project and the means to keep it current while a view is open. Returns the
 * last status (or null before the first read), any error from the most recent read, and a refresh.
 */
export function useRepoStatus(projectId: string): { status: GitStatus | null; error: string | null; refresh: () => void } {
  const status = useStore((s) => s.repoStatus[projectId] ?? null)
  const writes = useStore((s) => writeSignature(s.agents, s.agentOrder, projectId))
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(true)

  const refresh = () => {
    refreshRepo(projectId)
      .then(() => mounted.current && setError(null))
      .catch((err) => mounted.current && setError(errorText(err)))
  }

  // Every change under the project, and every window focus, schedules one debounced read.
  const schedule = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS)
  }

  useEffect(() => {
    mounted.current = true
    refresh()
    const off = listenFileChanges((change) => {
      if (change.projectId === projectId) schedule()
    })
    const onFocus = () => schedule()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.clearTimeout(timer.current)
      window.removeEventListener('focus', onFocus)
      off()
    }
    // refresh and schedule read only projectId; the closures they use are stable for this project.
  }, [projectId])

  // Agents writing files change the git picture before any turn ends.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    schedule()
  }, [writes])

  return { status, error, refresh }
}

/** Returns the current status without subscribing, for actions that need the latest branch. */
export function currentStatus(projectId: string): GitStatus | null {
  return getState().repoStatus[projectId] ?? null
}

/**
 * Tells the backend which folders to watch for the active project: its root and git metadata always,
 * and the folders the Files view has open. Changes are debounced, so expanding several folders at once
 * sends one request.
 */
export function useWatchProject(projectId: string | null, dirs: string[]): void {
  const key = projectId ? `${projectId}\n${[...dirs].sort().join('\n')}` : ''
  useEffect(() => {
    if (!projectId) {
      void api.watchProjectFiles('', []).catch(() => {})
      return
    }
    const t = window.setTimeout(() => {
      api.watchProjectFiles(projectId, dirs).catch(() => {})
    }, 150)
    return () => window.clearTimeout(t)
    // key captures projectId and dirs by value, so the effect re-runs exactly when they change.
  }, [key])
}
