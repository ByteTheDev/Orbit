import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { api, errorText } from '../../lib/bridge'
import { refreshRepo, useRepoStatus } from '../../lib/repoState'
import { commitChanges, stagePaths } from '../../lib/actions'
import { createBranch, discardChanges, fetchRemote, pullRemote, pushRemote, switchBranch } from '../../lib/sourceActions'
import { toast, useStore } from '../../lib/store'
import { markFor, TONE_COLOR, writerLabel, writersByPath, type Writer } from '../../lib/sourceView'
import { baseName, dirName, timeAgo } from '../../lib/format'
import type { AgentSummary, BranchInfo, GitChange, GitCommit, GitCommitDetail, GitCommitFile } from '../../types'
import { Button, Dialog, EmptyState, Spinner } from '../ui'
import { FileIcon } from '../ui/FileIcon'
import { OutlinedIcon } from '../ui/OutlinedIcon'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { Tooltip } from '../navigation/Tooltip'
import { FileEditor } from '../files/FileEditor'
import { openFileEditor } from '../../lib/store'
import { PatchView, type PatchMode } from './PatchView'

const HISTORY_PAGE = 30

/** Which change is open in the diff pane. */
interface Picked {
  change: GitChange
  staged: boolean
}

/** Which commit is open, and the file inside it that is being read. */
interface OpenCommit {
  hash: string
  file?: GitCommitFile
}

/**
 * The Git sidebar: the repository as git sees it. The branch, fetch, pull and push sit at the top.
 * Below are conflicts, staged and unstaged changes with a diff pane, the commit box, and the history.
 * A commit opens its changed files and their diffs. Everything re-reads when files or git change.
 */
export function GitView({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId])
  const agents = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)
  const fileEditor = useStore((s) => s.fileEditor)
  const { status, error, refresh } = useRepoStatus(projectId)

  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  // The diff belongs to one file. diffKey says which, so a refresh keeps the text on screen until the new one arrives.
  const [diff, setDiff] = useState<string | null>(null)
  const [diffKey, setDiffKey] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [mode, setMode] = useState<PatchMode>('inline')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<GitCommit[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyMore, setHistoryMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [openCommit, setOpenCommit] = useState<OpenCommit | null>(null)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [commitDiff, setCommitDiff] = useState<string | null>(null)
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; info: BranchInfo | null } | null>(null)
  const [newBranch, setNewBranch] = useState<string | null>(null)
  const [newBranchError, setNewBranchError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<GitChange[] | null>(null)

  const branchRef = useRef<HTMLButtonElement>(null)

  const writers = useMemo(() => {
    const list = agentOrder.map((id) => agents[id]).filter((a): a is AgentSummary => !!a && a.projectId === projectId)
    return writersByPath(list)
  }, [agents, agentOrder, projectId])

  // ---- history ---------------------------------------------------------------------------

  // The history changes with HEAD, the branch and the upstream, not with every save.
  const historyKey = status ? `${status.branch}|${status.upstream}|${status.ahead}|${status.behind}|${status.hasCommits}` : ''

  const loadHistory = useCallback(async () => {
    try {
      const page = await api.getGitHistory(projectId, 0, HISTORY_PAGE)
      setHistory(page)
      setHistoryMore(page.length === HISTORY_PAGE)
      setHistoryError(null)
    } catch (err) {
      setHistoryError(errorText(err))
    }
  }, [projectId])

  useEffect(() => {
    if (status) void loadHistory()
    // Reload only when the branch or its remote position moves; the status object changes far more often.
  }, [historyKey, loadHistory])

  const showMore = async () => {
    if (!history || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.getGitHistory(projectId, history.length, HISTORY_PAGE)
      setHistory((h) => [...(h ?? []), ...page])
      setHistoryMore(page.length === HISTORY_PAGE)
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  // ---- open commit ---------------------------------------------------------------------------

  useEffect(() => {
    if (!openCommit) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailError(null)
    api
      .getGitCommit(projectId, openCommit.hash)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setDetailError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [projectId, openCommit?.hash])

  useEffect(() => {
    if (!openCommit?.file) {
      setCommitDiff(null)
      return
    }
    let cancelled = false
    setCommitDiff(null)
    const f = openCommit.file
    api
      .getGitCommitDiff(projectId, openCommit.hash, f.path, f.oldPath ?? '')
      .then((d) => !cancelled && setCommitDiff(d))
      .catch((err) => !cancelled && setCommitDiff(`ERROR:${errorText(err)}`))
    return () => {
      cancelled = true
    }
  }, [projectId, openCommit?.hash, openCommit?.file?.path])

  // ---- open change diff -----------------------------------------------------------------------

  const pickedKey = picked ? `${picked.staged ? 's' : 'u'}:${picked.change.path}` : null
  useEffect(() => {
    if (!picked || !pickedKey) {
      setDiff(null)
      setDiffKey(null)
      setDiffError(null)
      return
    }
    let cancelled = false
    if (diffKey !== pickedKey) {
      // A different file: drop the old text now, so it is never shown under the new name.
      setDiff(null)
      setDiffKey(null)
    }
    setDiffError(null)
    const untracked = !picked.staged && picked.change.untracked
    api
      .getGitDiff(projectId, picked.change.path, picked.staged, untracked)
      .then((d) => {
        if (cancelled) return
        setDiff(d)
        setDiffKey(pickedKey)
      })
      .catch((err) => !cancelled && setDiffError(errorText(err)))
    return () => {
      cancelled = true
    }
    // Re-reads when the picked file or the repository state changes. diffKey only decides what to clear.
  }, [projectId, pickedKey, status])

  // ---- actions ---------------------------------------------------------------------------------

  // Runs one action with the busy state set. after runs only when the action reports success; the
  // action itself has already shown any failure as a toast.
  const run = async (label: string, action: () => Promise<boolean>, after?: () => void) => {
    setBusy(label)
    try {
      const ok = await action()
      if (ok && after) after()
    } finally {
      setBusy(null)
    }
  }

  const stageRows = (changes: GitChange[], stage: boolean) => {
    const paths = [...new Set(changes.map((c) => c.path))]
    if (!paths.length) return
    void run('stage', () => stagePaths(projectId, paths, stage), () => {
      refreshRepo(projectId).catch(() => {})
      setPicked(null)
    })
  }

  const commit = () => {
    if (!message.trim() || !status) return
    if (!status.changes.some((c) => c.staged && !c.conflicted)) return
    void run(
      'commit',
      async () => (await commitChanges(projectId, message, [])) !== null,
      () => {
        setMessage('')
        setPicked(null)
        refreshRepo(projectId).catch(() => {})
        void loadHistory()
      },
    )
  }

  const remote = (label: string, fn: () => Promise<boolean>) => {
    void run(label, fn, () => void loadHistory())
  }

  const openBranchMenu = async (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setBranchMenu({ x: r.left, y: r.bottom + 4, info: null })
    try {
      const info = await api.projectBranches(projectId)
      setBranchMenu((m) => (m ? { ...m, info } : m))
    } catch (err) {
      toast(errorText(err), 'error')
      setBranchMenu(null)
    }
  }

  const branchItems = (info: BranchInfo | null): MenuItem[] => {
    if (!info) return []
    const current = status?.branch ?? info.current
    const items: MenuItem[] = info.branches.map((b) => ({
      label: b,
      active: b === current,
      icon: b === current ? <OutlinedIcon name="check" size={14} /> : <OutlinedIcon name="call_split" size={14} />,
      onSelect: () => {
        if (b !== current) void run('switch', () => switchBranch(projectId, b), () => setBranchMenu(null))
      },
    }))
    items.push({
      label: 'New branch…',
      icon: <OutlinedIcon name="add" size={14} />,
      onSelect: () => {
        setNewBranch('')
        setNewBranchError(null)
      },
    })
    return items
  }

  const submitNewBranch = () => {
    const name = (newBranch ?? '').trim()
    if (!name) {
      setNewBranchError('Name the new branch.')
      return
    }
    void run('branch', () => createBranch(projectId, name), () => setNewBranch(null))
  }

  const discard = () => {
    const changes = confirmDiscard
    if (!changes) return
    setConfirmDiscard(null)
    void run('discard', () => discardChanges(projectId, changes), () => setPicked(null))
  }

  const writingLabel = (path: string): string | null => {
    const w: Writer[] | undefined = writers.get(path)
    return w && w.length ? `${writerLabel(w)} ${w.length === 1 ? 'is' : 'are'} writing this file` : null
  }

  // ---- render -------------------------------------------------------------------------------------

  if (!project) return <EmptyState title="No project selected" body="Choose a project to see its source control." />

  if (error && !status) {
    return (
      <div className="space-y-3 px-4 py-6">
        {/not a git repository/i.test(error) ? (
          <EmptyState title="Not a git repository" body="This project folder is not under git. Run git init in it to start tracking changes." />
        ) : (
          <>
            <p className="text-caption text-danger-soft">{error}</p>
            <Button size="sm" onClick={refresh}>
              Try again
            </Button>
          </>
        )}
      </div>
    )
  }
  if (!status) return <Spinner label="Reading the repository…" />

  const staged = status.changes.filter((c) => c.staged && !c.conflicted)
  const conflicts = status.changes.filter((c) => c.conflicted)
  const changes = status.changes.filter((c) => c.unstaged && !c.conflicted)
  const canCommit = !busy && staged.length > 0 && message.trim() !== ''
  const hasUpstream = !!status.upstream

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Branch and remote */}
      <div className="space-y-2 border-b border-line px-3 pb-3">
        <div className="flex items-center gap-1.5">
          <button
            ref={branchRef}
            type="button"
            onClick={openBranchMenu}
            disabled={!!busy}
            aria-haspopup="menu"
            aria-label={`Branch ${status.branch || 'detached'}. Switch branch`}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-tint/[0.06] disabled:opacity-60"
          >
            <OutlinedIcon name="call_split" size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 truncate font-mono text-caption text-ink">{status.branch || 'Detached HEAD'}</span>
            <OutlinedIcon name="expand_more" size={14} className="shrink-0 text-faint" />
          </button>
          {status.ahead > 0 && <Count icon="arrow_upward" n={status.ahead} label="ahead" />}
          {status.behind > 0 && <Count icon="arrow_downward" n={status.behind} label="behind" />}
          <span className="ml-auto flex items-center gap-0.5">
            <IconAction icon="sync" label="Fetch from remote" busy={busy === 'fetch'} disabled={!!busy || !status.remote} onClick={() => remote('fetch', () => fetchRemote(projectId))} />
            <IconAction icon="arrow_downward" label="Pull" busy={busy === 'pull'} disabled={!!busy || !status.remote || !hasUpstream} onClick={() => remote('pull', () => pullRemote(projectId))} />
            <IconAction icon="arrow_upward" label="Push" busy={busy === 'push'} disabled={!!busy || !status.remote || !status.branch} onClick={() => remote('push', () => pushRemote(projectId))} />
            <IconAction icon="refresh" label="Refresh" busy={false} disabled={!!busy} onClick={refresh} />
          </span>
        </div>
        {!status.remote && <p className="text-label text-faint">No remote is set up, so fetch, pull and push are off. Add one with git remote add.</p>}
        {status.remote && !hasUpstream && status.branch && <p className="text-label text-faint">Push sets {status.branch} to track the remote the first time.</p>}
        {newBranch !== null && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              submitNewBranch()
            }}
          >
            <input
              autoFocus
              value={newBranch}
              onChange={(e) => {
                setNewBranch(e.target.value)
                setNewBranchError(null)
              }}
              onKeyDown={(e) => e.key === 'Escape' && setNewBranch(null)}
              placeholder="new-branch-name"
              aria-label="New branch name"
              aria-invalid={!!newBranchError}
              className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2 font-mono text-caption text-ink focus:outline-none"
            />
            <Button size="sm" type="submit" variant="secondary" disabled={!!busy}>
              Create
            </Button>
          </form>
        )}
        {newBranchError && <p className="text-label text-danger-soft">{newBranchError}</p>}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {error && <p className="text-caption text-danger-soft">{error}</p>}

        {conflicts.length > 0 && (
          <section aria-label="Merge conflicts" className="space-y-1.5 rounded-md border border-warn/25 bg-warn/[0.05] p-2">
            <p className="flex items-center gap-1.5 px-1 text-caption font-medium text-warn-soft">
              <OutlinedIcon name="warning" size={14} />
              {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'} to resolve
            </p>
            <p className="px-1 text-label text-faint">Edit each file to keep the right lines, then stage it.</p>
            <ul className="space-y-px">
              {conflicts.map((c) => (
                <li key={c.path} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <FileIcon path={c.path} size={14} />
                  <span className="min-w-0 flex-1 truncate font-mono text-label text-ink/90" title={c.path}>
                    {c.path}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-caption" onClick={() => openFileEditor(projectId, c.path)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-caption" disabled={!!busy} onClick={() => stageRows([c], true)}>
                    Mark resolved
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {status.changes.length === 0 && <p className="text-caption text-faint">The working tree is clean.</p>}

        <ChangeSection
          title="Staged"
          count={staged.length}
          action={staged.length > 0 && <TextAction label="Unstage all" disabled={!!busy} onClick={() => stageRows(staged, false)} />}
          rows={staged}
          staged
          picked={picked}
          busy={!!busy}
          writingLabel={writingLabel}
          onPick={(c) => setPicked({ change: c, staged: true })}
          onToggle={(c) => stageRows([c], false)}
          onDiscard={(c) => setConfirmDiscard([c])}
        />

        <ChangeSection
          title="Changes"
          count={changes.length}
          action={changes.length > 0 && <TextAction label="Stage all" disabled={!!busy} onClick={() => stageRows(changes, true)} />}
          rows={changes}
          staged={false}
          picked={picked}
          busy={!!busy}
          writingLabel={writingLabel}
          onPick={(c) => setPicked({ change: c, staged: false })}
          onToggle={(c) => stageRows([c], true)}
          onDiscard={(c) => setConfirmDiscard([c])}
        />

        {picked && (
          <section aria-label="Diff" className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-mono text-label text-muted" title={picked.change.path}>
                {picked.change.path}
              </p>
              <button type="button" onClick={() => setPicked(null)} aria-label="Close diff" className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-tint/[0.06] hover:text-ink">
                <OutlinedIcon name="close" size={13} />
              </button>
            </div>
            {diffError && <p className="text-caption text-danger-soft">{diffError}</p>}
            {!diffError && (diff === null || diffKey !== pickedKey) && <Spinner label="Loading diff…" />}
            {diff !== null && diffKey === pickedKey &&
              (diff.trim() ? (
                <PatchView text={diff} path={picked.change.path} mode={mode} onModeChange={setMode} />
              ) : (
                <p className="text-caption text-faint">No text changes to show. The file may be binary.</p>
              ))}
          </section>
        )}

        {/* Commit */}
        <section className="space-y-2 border-t border-line pt-4" aria-label="Commit">
          <label htmlFor="sidebar-commit-message" className="text-caption font-medium text-ink">
            Commit message
          </label>
          <textarea
            id="sidebar-commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
            rows={3}
            placeholder={staged.length ? 'Describe the staged changes' : 'Stage some changes to commit'}
            className="w-full resize-y rounded-md border border-line bg-canvas px-2.5 py-2 text-caption text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-faint">
              {staged.length} staged{conflicts.length ? ` · ${conflicts.length} conflicted` : ''}
            </span>
            <Button variant="primary" size="sm" disabled={!canCommit} onClick={commit} className="gap-1.5">
              {busy === 'commit' ? <Spinner /> : <OutlinedIcon name="commit" size={13} />}
              Commit staged
            </Button>
          </div>
        </section>

        {/* History */}
        <section className="space-y-1.5 border-t border-line pt-4" aria-label="Recent commits">
          <p className="text-caption font-medium text-muted">History</p>
          {historyError && <p className="text-caption text-danger-soft">{historyError}</p>}
          {history === null && !historyError && <Spinner label="Reading history…" />}
          {history && history.length === 0 && <p className="text-caption text-faint">No commits yet.</p>}
          {history && history.length > 0 && (
            <ul className="space-y-px">
              {history.map((c) => (
                <li key={c.hash}>
                  <button
                    type="button"
                    onClick={() => setOpenCommit({ hash: c.hash })}
                    className={`group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ${
                      openCommit?.hash === c.hash ? 'bg-tint/[0.07]' : 'hover:bg-tint/[0.04]'
                    }`}
                  >
                    <span className="mt-px shrink-0 font-mono text-label text-muted">{c.short}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-ink" title={c.subject}>
                        {c.subject}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-label text-faint">
                        <span className="truncate">{c.author}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0 tabular-nums" title={new Date(c.at).toLocaleString()}>
                          {timeAgo(c.at)}
                        </span>
                        {c.agent && <AgentBadge name={c.agent} />}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {historyMore && (
            <Button size="sm" variant="ghost" className="w-full text-caption" disabled={loadingMore} onClick={() => void showMore()}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </section>
      </div>

      {openCommit && (
        <CommitPane
          detail={detail}
          error={detailError}
          file={openCommit.file}
          diff={commitDiff}
          mode={mode}
          onModeChange={setMode}
          onBack={() => setOpenCommit(null)}
          onFile={(f) => setOpenCommit({ hash: openCommit.hash, file: f })}
          onCloseFile={() => setOpenCommit({ hash: openCommit.hash })}
        />
      )}

      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          items={branchItems(branchMenu.info)}
          onClose={() => setBranchMenu(null)}
          label="Switch branch"
          align="start"
        />
      )}

      {confirmDiscard && (
        <Dialog
          title={confirmDiscard.length === 1 ? `Discard changes to ${baseName(confirmDiscard[0].path)}?` : `Discard ${confirmDiscard.length} changes?`}
          description="Uncommitted edits to these files will be lost. Untracked files are deleted. This cannot be undone."
          onClose={() => setConfirmDiscard(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={discard}>
                Discard changes
              </Button>
            </div>
          }
        >
          <ul className="max-h-40 space-y-1 overflow-auto font-mono text-caption text-muted">
            {confirmDiscard.slice(0, 8).map((c) => (
              <li key={c.path} className="truncate">
                {c.path}
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {fileEditor && fileEditor.projectId === projectId && <FileEditor projectId={projectId} path={fileEditor.path} />}
    </div>
  )
}

// ---- pieces ----------------------------------------------------------------------------------------

function ChangeSection({
  title,
  count,
  action,
  rows,
  staged,
  picked,
  busy,
  writingLabel,
  onPick,
  onToggle,
  onDiscard,
}: {
  title: string
  count: number
  action: false | ReactNode
  rows: GitChange[]
  staged: boolean
  picked: Picked | null
  busy: boolean
  writingLabel: (path: string) => string | null
  onPick: (c: GitChange) => void
  onToggle: (c: GitChange) => void
  onDiscard: (c: GitChange) => void
}) {
  return (
    <section className="space-y-1" aria-label={title}>
      <div className="flex items-center gap-2">
        <p className="text-caption font-medium text-muted">
          {title} <span className="tabular-nums text-faint">{count}</span>
        </p>
        <div className="ml-auto">{action}</div>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 text-caption text-faint">Nothing here.</p>
      ) : (
        <ul className="space-y-px">
          {rows.map((c) => {
            const mark = markFor(c)
            const active = picked?.change.path === c.path && picked.staged === staged
            const writing = writingLabel(c.path)
            return (
              <li
                key={`${staged ? 's' : 'u'}:${c.path}`}
                className={`group flex items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 transition-colors duration-150 ${active ? 'bg-tint/[0.07]' : 'hover:bg-tint/[0.04]'}`}
              >
                <button type="button" onClick={() => onPick(c)} aria-pressed={active} title={c.path} className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left">
                  <span className="w-3 shrink-0 text-center font-mono text-label font-semibold" style={{ color: TONE_COLOR[mark.tone] }} aria-label={mark.label} title={mark.label}>
                    {mark.letter}
                  </span>
                  <FileIcon path={c.path} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-ink">{baseName(c.path)}</span>
                    {(writing || dirName(c.path)) && (
                      <span className={`block truncate text-label ${writing ? 'text-status-writing' : 'font-mono text-faint'}`}>
                        {writing ?? dirName(c.path)}
                      </span>
                    )}
                  </span>
                </button>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  {!staged && (
                    <Tooltip label="Discard changes">
                      <button type="button" disabled={busy} onClick={() => onDiscard(c)} aria-label={`Discard changes to ${c.path}`} className={rowIcon}>
                        <OutlinedIcon name="undo" size={14} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label={staged ? 'Unstage' : 'Stage'}>
                    <button type="button" disabled={busy} onClick={() => onToggle(c)} aria-label={`${staged ? 'Unstage' : 'Stage'} ${c.path}`} className={rowIcon}>
                      <OutlinedIcon name={staged ? 'remove' : 'add'} size={14} />
                    </button>
                  </Tooltip>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const rowIcon =
  'flex h-6 w-6 items-center justify-center rounded text-faint transition-colors duration-150 hover:bg-tint/[0.08] hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tint/[0.2]'

function TextAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded px-1.5 py-0.5 text-label text-muted transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink disabled:opacity-40">
      {label}
    </button>
  )
}

function IconAction({ icon, label, onClick, disabled, busy }: { icon: string; label: string; onClick: () => void; disabled: boolean; busy: boolean }) {
  return (
    <Tooltip label={label}>
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tint/[0.2]">
        {busy ? <Spinner /> : <OutlinedIcon name={icon} size={15} />}
      </button>
    </Tooltip>
  )
}

function Count({ icon, n, label }: { icon: string; n: number; label: string }) {
  return (
    <span className="flex items-center gap-0.5 text-label tabular-nums text-muted" title={`${n} ${label}`}>
      <OutlinedIcon name={icon} size={12} />
      {n}
      <span className="sr-only">{label}</span>
    </span>
  )
}

function AgentBadge({ name }: { name: string }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 py-px text-[10px] text-muted" title={`Written by the agent ${name}`}>
      <OutlinedIcon name="smart_toy" size={10} />
      {name}
    </span>
  )
}

/** A commit opened in place of the list: its message, its files, and the diff of one file. */
function CommitPane({
  detail,
  error,
  file,
  diff,
  mode,
  onModeChange,
  onBack,
  onFile,
  onCloseFile,
}: {
  detail: GitCommitDetail | null
  error: string | null
  file?: GitCommitFile
  diff: string | null
  mode: PatchMode
  onModeChange: (m: PatchMode) => void
  onBack: () => void
  onFile: (f: GitCommitFile) => void
  onCloseFile: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-sidebar">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" onClick={file ? onCloseFile : onBack} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-caption text-muted transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink">
          <OutlinedIcon name="arrow_back" size={14} />
          {file ? 'Commit' : 'History'}
        </button>
        {detail && <span className="ml-auto font-mono text-label text-muted">{detail.short}</span>}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {error && <p className="text-caption text-danger-soft">{error}</p>}
        {!detail && !error && <Spinner label="Opening commit…" />}
        {detail && !file && (
          <>
            <div className="space-y-2">
              <p className="text-body font-medium leading-snug text-ink">{detail.subject}</p>
              {detail.body && <p className="whitespace-pre-line text-caption leading-relaxed text-muted">{detail.body.replace(/^Orbit-Agent:.*$/m, '').trim()}</p>}
              <p className="flex flex-wrap items-center gap-1.5 text-label text-faint">
                <span>{detail.author}</span>
                <span aria-hidden="true">·</span>
                <span title={new Date(detail.at).toLocaleString()}>{timeAgo(detail.at)}</span>
                {detail.agent && <AgentBadge name={detail.agent} />}
              </p>
            </div>
            <section aria-label="Changed files" className="space-y-1">
              <p className="text-caption font-medium text-muted">
                {detail.files.length} changed {detail.files.length === 1 ? 'file' : 'files'}
              </p>
              <ul className="space-y-px">
                {detail.files.map((f) => (
                  <li key={f.path}>
                    <button type="button" onClick={() => onFile(f)} title={f.path} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-tint/[0.04]">
                      <span className="w-3 shrink-0 text-center font-mono text-label font-semibold text-muted">{f.status}</span>
                      <FileIcon path={f.path} size={14} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-caption text-ink">{baseName(f.path)}</span>
                        {dirName(f.path) && <span className="block truncate font-mono text-label text-faint">{dirName(f.path)}</span>}
                      </span>
                      {f.binary ? (
                        <span className="shrink-0 text-label text-faint">binary</span>
                      ) : (
                        <span className="shrink-0 font-mono text-label tabular-nums">
                          <span className="text-ok">+{f.additions}</span> <span className="text-danger-soft">−{f.deletions}</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {detail && file && (
          <section aria-label="File diff" className="space-y-2">
            <p className="truncate font-mono text-label text-muted" title={file.path}>
              {file.path}
            </p>
            {diff === null && <Spinner label="Loading diff…" />}
            {diff?.startsWith('ERROR:') && <p className="text-caption text-danger-soft">{diff.slice(6)}</p>}
            {diff !== null && !diff.startsWith('ERROR:') &&
              (diff.trim() ? (
                <PatchView text={diff} path={file.path} mode={mode} onModeChange={onModeChange} />
              ) : (
                <p className="text-caption text-faint">No text changes to show. The file may be binary.</p>
              ))}
          </section>
        )}
      </div>
    </div>
  )
}
