import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../lib/store'
import { commitChanges, setAutoCommit, stagePaths } from '../../lib/actions'
import { api, errorText } from '../../lib/bridge'
import { changeLabel, groupChanges, rowKey, type ChangeSide } from '../../lib/gitChanges'
import { baseName, dirName, timeAgo } from '../../lib/format'
import type { GitChange, GitCommit, GitStatus } from '../../types'
import { Button, Spinner } from '../ui'
import { DiffView } from '../dialogs/Dialogs'
import { IconBranch, IconCommit } from './inspectorIcons'

/**
 * The Changes tab: the project's repository as git sees it. Stage and unstage files, read
 * their diffs, commit, and turn on auto-commit so each finished agent turn is committed.
 */
export function GitTab({ projectId, agentStatus }: { projectId: string; agentStatus: string }) {
  const autoCommit = useStore((s) => !!s.projects[projectId]?.autoCommit)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<{ side: ChangeSide; change: GitChange } | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const [next, commits] = await Promise.all([api.getGitStatus(projectId), api.getGitLog(projectId)])
      setStatus(next)
      setLog(commits)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [projectId])

  // Reload when the project changes, and when the agent's status changes (a turn finished,
  // which is when auto-commit runs).
  useEffect(() => {
    void load()
  }, [load, agentStatus])

  useEffect(() => {
    if (!selected) {
      setDiff(null)
      setDiffError(null)
      return
    }
    let cancelled = false
    setDiff(null)
    setDiffError(null)
    const untracked = selected.side === 'unstaged' && selected.change.untracked
    api
      .getGitDiff(projectId, selected.change.path, selected.side === 'staged', untracked)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setDiffError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [projectId, selected])

  const groups = useMemo(() => groupChanges(status?.changes ?? []), [status])

  if (!status) {
    return error ? (
      <div className="space-y-3 p-4">
        <p className="text-caption text-danger-soft">{error}</p>
        <Button size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    ) : (
      <Spinner label="Reading the repository…" />
    )
  }

  // Runs a git write, then reloads so the lists match what git now holds.
  const write = async (action: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await action()
    setBusy(false)
    if (ok) {
      setSelected(null)
      await load()
    }
    return ok
  }

  const stageRows = (paths: string[], on: boolean) => write(() => stagePaths(projectId, paths, on))

  const commit = async () => {
    // An empty path list commits everything that is staged.
    const ok = await write(async () => (await commitChanges(projectId, message, [])) !== null)
    if (ok) setMessage('')
  }

  const stagedPaths = groups.staged.map((c) => c.path)
  const unstagedPaths = [...new Set(groups.unstaged.map((c) => c.path))]
  const canCommit = !busy && stagedPaths.length > 0 && message.trim() !== ''

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-4 px-4 py-3">
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <IconBranch size={13} className="shrink-0 text-muted" />
          <span className="min-w-0 truncate font-mono text-caption text-ink" title={status.branch || 'Detached HEAD'}>
            {status.branch || 'Detached HEAD'}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-caption" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
        </div>

        {error && <p className="text-caption text-danger-soft">{error}</p>}

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span id="auto-commit-label" className="block text-caption font-medium text-ink">
              Auto-commit agent turns
            </span>
            <span className="block text-label leading-relaxed text-faint">
              When a turn finishes cleanly, commit the files the agent wrote. Other staged work is left alone.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoCommit}
            aria-labelledby="auto-commit-label"
            onClick={() => void setAutoCommit(projectId, !autoCommit)}
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ${autoCommit ? 'bg-ok' : 'bg-white/[0.12]'}`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-canvas transition-transform duration-150 motion-reduce:transition-none ${autoCommit ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        {status.changes.length === 0 && <p className="text-caption text-faint">The working tree is clean.</p>}

        <Section
          title={`Staged (${stagedPaths.length})`}
          action={
            stagedPaths.length > 0 && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void stageRows(stagedPaths, false)}>
                Unstage all
              </Button>
            )
          }
        >
          {groups.staged.map((c) => (
            <ChangeRow
              key={rowKey(c, 'staged')}
              change={c}
              side="staged"
              active={selected !== null && rowKey(selected.change, selected.side) === rowKey(c, 'staged')}
              busy={busy}
              onSelect={() => setSelected({ side: 'staged', change: c })}
              onAction={() => void stageRows([c.path], false)}
              actionLabel="Unstage"
            />
          ))}
        </Section>

        <Section
          title={`Changes (${unstagedPaths.length})`}
          action={
            unstagedPaths.length > 0 && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void stageRows(unstagedPaths, true)}>
                Stage all
              </Button>
            )
          }
        >
          {groups.unstaged.map((c) => (
            <ChangeRow
              key={rowKey(c, 'unstaged')}
              change={c}
              side="unstaged"
              active={selected !== null && rowKey(selected.change, selected.side) === rowKey(c, 'unstaged')}
              busy={busy}
              onSelect={() => setSelected({ side: 'unstaged', change: c })}
              onAction={() => void stageRows([c.path], true)}
              actionLabel="Stage"
            />
          ))}
        </Section>

        {selected && (
          <div>
            <p className="mb-2 truncate font-mono text-label text-muted" title={selected.change.path}>
              {selected.change.path}
            </p>
            {diffError && <p className="text-caption text-danger-soft">{diffError}</p>}
            {!diffError && diff === null && <Spinner label="Loading diff…" />}
            {diff !== null &&
              (diff.trim() ? <DiffView text={diff} /> : <p className="text-caption text-faint">No textual changes to show.</p>)}
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-4">
          <label htmlFor="git-commit-message" className="text-caption font-medium text-ink">
            Commit message
          </label>
          <textarea
            id="git-commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={stagedPaths.length ? 'Describe the staged changes' : 'Stage some changes to commit'}
            className="w-full resize-y rounded-md border border-line bg-canvas px-2.5 py-2 text-caption text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-faint">{stagedPaths.length} staged</span>
            <Button variant="primary" size="sm" disabled={!canCommit} onClick={() => void commit()}>
              <IconCommit size={12} />
              Commit staged
            </Button>
          </div>
        </div>

        {log.length > 0 && (
          <div className="space-y-1.5 border-t border-line pt-4">
            <p className="text-caption font-medium text-muted">Recent commits</p>
            <ul className="space-y-1">
              {log.map((c) => (
                <li key={c.hash} className="flex items-baseline gap-2 text-caption">
                  <span className="shrink-0 font-mono text-label text-muted">{c.short}</span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={c.subject}>
                    {c.subject}
                  </span>
                  <span className="shrink-0 text-label text-faint">{timeAgo(c.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2">
        <p className="text-caption font-medium text-muted">{title}</p>
        <div className="ml-auto">{action}</div>
      </div>
      {hasRows ? <ul className="space-y-px">{children}</ul> : <p className="px-2 text-caption text-faint">Nothing here.</p>}
    </section>
  )
}

/** Status colour for a change label. Colour is the only signal, so every label is also written out in text. */
function changeTone(label: string): string {
  if (label === 'Conflict') return 'var(--color-warn)'
  if (label === 'Added' || label === 'New') return 'var(--color-ok)'
  if (label === 'Deleted') return 'var(--color-danger)'
  if (label === 'Modified') return 'var(--color-status-writing)'
  return 'var(--color-faint)'
}

function ChangeRow({
  change,
  side,
  active,
  busy,
  onSelect,
  onAction,
  actionLabel,
}: {
  change: GitChange
  side: ChangeSide
  active: boolean
  busy: boolean
  onSelect: () => void
  onAction: () => void
  actionLabel: string
}) {
  const label = changeLabel(change, side)
  return (
    <li
      className={`group flex items-center gap-2 rounded-md py-1 pl-2 pr-1 transition-colors duration-150 ${active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
    >
      <button type="button" onClick={onSelect} aria-pressed={active} title={change.path} className="flex min-w-0 flex-1 items-center gap-2.5 py-0.5 text-left">
        <span className="flex w-[84px] shrink-0 items-center gap-1.5 text-label text-muted">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: changeTone(label) }} aria-hidden="true" />
          {label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption text-ink">{baseName(change.path)}</span>
          {dirName(change.path) && <span className="block truncate font-mono text-label text-faint">{dirName(change.path)}</span>}
        </span>
      </button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onAction} aria-label={`${actionLabel} ${change.path}`} className="h-6 shrink-0 px-2 text-caption opacity-70 group-hover:opacity-100 focus-visible:opacity-100">
        {actionLabel}
      </Button>
    </li>
  )
}
