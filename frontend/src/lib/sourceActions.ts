// User actions for the Files and Git sidebars. Each one calls the backend, reports a failure as a toast
// (the convention in actions.ts), and re-reads git status when something on disk or in git moved.
import { api, errorText } from './bridge'
import { refreshRepo } from './repoState'
import { toast } from './store'
import type { GitChange, GitDiscardTarget } from '../types'

/** Runs a backend call. Success is silent unless a message is given; failure becomes an error toast. */
async function attempt<T>(call: () => Promise<T>, failure: string, success?: (value: T) => string | undefined): Promise<T | null> {
  try {
    const value = await call()
    const message = success?.(value)
    if (message) toast(message, 'success')
    return value
  } catch (err) {
    toast(`${failure} ${errorText(err)}`, 'error')
    return null
  }
}

/** Re-reads git status without reporting its failure twice. */
function reread(projectId: string): void {
  refreshRepo(projectId).catch(() => {})
}

// ---- remote ------------------------------------------------------------------------

export async function fetchRemote(projectId: string): Promise<boolean> {
  const out = await attempt(() => api.gitFetch(projectId), 'Fetch failed.', (s) => (s ? `Fetched. ${s}` : 'Fetched.'))
  reread(projectId)
  return out !== null
}

export async function pullRemote(projectId: string): Promise<boolean> {
  const out = await attempt(() => api.gitPull(projectId), 'Pull failed.', (s) => `Pulled. ${s}`)
  reread(projectId)
  return out !== null
}

export async function pushRemote(projectId: string): Promise<boolean> {
  const out = await attempt(() => api.gitPush(projectId), 'Push failed.', (s) => `Pushed. ${s}`)
  reread(projectId)
  return out !== null
}

// ---- branches -------------------------------------------------------------------------

export async function switchBranch(projectId: string, name: string): Promise<boolean> {
  const ok = await attempt(() => api.gitSwitchBranch(projectId, name), 'Could not switch branch.', () => `On ${name}.`)
  reread(projectId)
  return ok !== null
}

export async function createBranch(projectId: string, name: string): Promise<boolean> {
  const ok = await attempt(() => api.gitCreateBranch(projectId, name), 'Could not create the branch.', () => `Created and switched to ${name}.`)
  reread(projectId)
  return ok !== null
}

// ---- changes -----------------------------------------------------------------------------

/** Turns a change into the shape the backend discards. */
export function discardTarget(c: GitChange): GitDiscardTarget {
  return { path: c.path, oldPath: c.oldPath, index: c.index, worktree: c.worktree, untracked: c.untracked }
}

/** Throws away the given changes. The caller has already asked the user to confirm. */
export async function discardChanges(projectId: string, changes: GitChange[]): Promise<boolean> {
  const ok = await attempt(
    () => api.gitDiscardChanges(projectId, changes.map(discardTarget)),
    'Could not discard those changes.',
    () => (changes.length === 1 ? `Discarded changes to ${changes[0].path}.` : `Discarded ${changes.length} changes.`),
  )
  reread(projectId)
  return ok !== null
}

// ---- files --------------------------------------------------------------------------------

export async function createEntry(projectId: string, dir: string, name: string, isDir: boolean): Promise<string | null> {
  return attempt(() => api.createProjectEntry(projectId, dir, name, isDir), isDir ? 'Could not create the folder.' : 'Could not create the file.')
}

export async function renameEntry(projectId: string, rel: string, newName: string): Promise<string | null> {
  return attempt(() => api.renameProjectEntry(projectId, rel, newName), 'Could not rename it.')
}

export async function deleteEntries(projectId: string, rels: string[]): Promise<boolean> {
  const ok = await attempt(
    () => api.deleteProjectEntries(projectId, rels),
    'Could not delete it.',
    () => (rels.length === 1 ? 'Deleted.' : `Deleted ${rels.length} items.`),
  )
  reread(projectId)
  return ok !== null
}

export async function openEntry(projectId: string, rel: string): Promise<void> {
  await attempt(() => api.openProjectEntry(projectId, rel), 'Could not open it.')
}

export async function revealEntry(projectId: string, rel: string): Promise<void> {
  await attempt(() => api.revealProjectEntry(projectId, rel), 'Could not show it in the file manager.')
}

/** Copies text to the clipboard and says so. */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what} copied.`, 'success')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}
