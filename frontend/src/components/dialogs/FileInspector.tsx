import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { copyText, openProjectFile } from '../../lib/actions'
import { api, errorText } from '../../lib/bridge'
import { parsePatch } from '../../lib/diff'
import { formatBytes, sameChanges, statusLabel, type StatusLabel, type Tone } from '../../lib/fileInspect'
import { baseName, timeAgo } from '../../lib/format'
import { openFileEditor, setSidebar, setSidebarView, setState, useStore } from '../../lib/store'
import { STATUS_COLOR } from '../../lib/theme'
import type { FileActivity, FileDiffResult, FileEvent, GitCommit } from '../../types'
import { CodeDiff } from '../diff/CodeDiff'
import { Button, Dialog, EmptyState, MaterialIcon, Spinner } from '../ui'
import { FileIcon } from '../ui/FileIcon'

/** Matches the error gitdiff returns for a folder that is not a repository. */
const NOT_A_REPO = 'not a git repository'

const MIN_WIDTH = 560
const MIN_HEIGHT = 380

const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
  info: 'var(--color-status-writing)',
  muted: 'var(--color-faint)',
}

type Tab = 'changes' | 'activity' | 'history'

/** Which diff the Changes tab shows. */
type Source = { kind: 'working' } | { kind: 'edit' } | { kind: 'commit'; commit: GitCommit }

/** The file inspector: a file's git state, the agent's own recorded edits, who touched it, and its history. */
export function FileInspector({ agentId, path, onClose }: { agentId: string; path: string; onClose: () => void }) {
  const agent = useStore((s) => s.agents[agentId])
  const file = useStore((s) => s.details[agentId]?.files[path])
  const [tab, setTab] = useState<Tab>('changes')
  const [source, setSource] = useState<Source | null>(null)
  const [commitView, setCommitView] = useState<'diff' | 'file'>('diff')
  const [fullscreen, setFullscreen] = useState(false)
  const [size, setSize] = useState(() => initialSize())
  const [refresh, setRefresh] = useState(0)

  const info = useLoad(() => api.getFileDiff(agentId, path), [agentId, path, refresh])
  const timeline = useLoad(() => api.getFileTimeline(agentId, path), [agentId, path, refresh])
  const history = useLoad(() => api.getFileHistory(agentId, path), [agentId, path, refresh])
  const data = info.data
  const inRepo = !!data && !data.gitNotice.includes(NOT_A_REPO)

  const commitHash = source?.kind === 'commit' ? source.commit.hash : null
  const commitDiff = useLoad(
    () => (commitHash ? api.getCommitFileDiff(agentId, commitHash, path) : Promise.resolve('')),
    [agentId, path, commitHash],
  )
  const commitFile = useLoad(
    () => (commitHash && commitView === 'file' ? api.getFileAtCommit(agentId, commitHash, path) : Promise.resolve('')),
    [agentId, path, commitHash, commitView],
  )

  const gitAdditions = useMemo(() => (data?.gitDiff ? parsePatch(data.gitDiff).additions : 0), [data?.gitDiff])
  const gitDeletions = useMemo(() => (data?.gitDiff ? parsePatch(data.gitDiff).deletions : 0), [data?.gitDiff])
  const sameAsGit = !!data && !!data.recorded && !!data.gitDiff && sameChanges(data.recorded, data.gitDiff)
  const hasEdit = !!data?.recorded && !sameAsGit
  const status = statusLabel(data?.git ?? null, data?.exists ?? true, inRepo)

  // Without an explicit choice, show the git diff when there is one, otherwise the agent's edit.
  const defaultSource: Source = data && !data.gitDiff && data.recorded ? { kind: 'edit' } : { kind: 'working' }
  const shown: Source = source ?? defaultSource

  const openInDefaultApp = () => void openProjectFile(agentId, path)
  const copyPath = () => void copyText(path, 'Path')
  // The editor lives in the sidebar's Files view for the agent's project. Switch there, then open it.
  const canEdit = !!agent && !!data?.rel && data.exists
  const editInOrbit = () => {
    if (!agent || !data?.rel) return
    onClose()
    // The Files view only shows the active project, so make the agent's project active first.
    setState({ activeProjectId: agent.projectId })
    setSidebar({ collapsed: false })
    setSidebarView('files')
    openFileEditor(agent.projectId, data.rel)
  }

  const resizeFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
    const move = (ev: PointerEvent) =>
      setSize({
        w: clamp(start.w + ev.clientX - start.x, MIN_WIDTH, window.innerWidth - 48),
        h: clamp(start.h + ev.clientY - start.y, MIN_HEIGHT, window.innerHeight * 0.86),
      })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const headerActions = (
    <>
      <IconButton label="Refresh" icon="refresh" onClick={() => setRefresh((n) => n + 1)} />
      <IconButton label="Edit in Orbit" icon="edit_note" onClick={editInOrbit} disabled={!canEdit} />
      <IconButton label="Open in default app" icon="open_in_new" onClick={openInDefaultApp} disabled={!data?.exists} />
      <IconButton label={fullscreen ? 'Exit full screen' : 'Full screen'} icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'} onClick={() => setFullscreen((f) => !f)} />
    </>
  )

  return (
    <Dialog
      title={baseName(path)}
      description={
        <span className="flex min-w-0 items-center gap-2">
          <FileIcon path={path} size={14} />
          <span className="min-w-0 truncate font-mono text-label text-muted" title={path}>
            {path}
          </span>
          <button
            type="button"
            onClick={copyPath}
            aria-label="Copy path"
            title="Copy path"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink"
          >
            <MaterialIcon outlined name="content_copy" size={12} />
          </button>
        </span>
      }
      onClose={onClose}
      width="max-w-none"
      panelStyle={fullscreen ? undefined : { width: size.w, height: size.h }}
      fullscreen={fullscreen}
      headerActions={headerActions}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-4 pt-3"
    >
      {!fullscreen && <ResizeHandle onPointerDown={resizeFrom} />}

      <Summary
        status={status}
        exists={data?.exists ?? true}
        additions={gitAdditions}
        deletions={gitDeletions}
        modTime={data?.modTime ?? 0}
        size={data?.size ?? 0}
        loading={!data && !info.error}
      />

      <div className="flex shrink-0 items-center gap-1 border-b border-line">
        <TabButton active={tab === 'changes'} onClick={() => setTab('changes')} icon="difference" label="Changes" />
        <TabButton
          active={tab === 'activity'}
          onClick={() => setTab('activity')}
          icon="history"
          label="Activity"
          count={file?.ops?.length ?? 0}
        />
        <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon="commit" label="History" count={history.data?.length} />
      </div>

      {tab === 'changes' && (
        <ChangesTab
          info={info}
          data={data}
          inRepo={inRepo}
          shown={shown}
          setSource={setSource}
          hasEdit={hasEdit}
          sameAsGit={sameAsGit}
          path={path}
          providerName={agent?.provider}
          commitDiff={commitDiff}
          commitFile={commitFile}
          commitView={commitView}
          setCommitView={setCommitView}
        />
      )}
      {tab === 'activity' && (
        <ActivityTab
          agentId={agentId}
          agentName={agent?.name ?? 'This agent'}
          file={file}
          timeline={timeline}
          onViewEdit={() => {
            setSource({ kind: 'edit' })
            setTab('changes')
          }}
          canViewEdit={hasEdit}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          history={history}
          inRepo={inRepo}
          onOpen={(commit) => {
            setSource({ kind: 'commit', commit })
            setCommitView('diff')
            setTab('changes')
          }}
        />
      )}
    </Dialog>
  )
}

// ---- header and summary ------------------------------------------------------------------

function Summary({
  status,
  exists,
  additions,
  deletions,
  modTime,
  size,
  loading,
}: {
  status: StatusLabel
  exists: boolean
  additions: number
  deletions: number
  modTime: number
  size: number
  loading: boolean
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted">
      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[status.tone] }} aria-hidden="true" />
        {loading ? 'Loading' : status.label}
      </span>
      {exists && (
        <span className="font-mono text-label tabular-nums">
          <span className="text-ok">+{additions}</span> <span className="text-danger-soft">−{deletions}</span>
        </span>
      )}
      {modTime > 0 && (
        <span title={new Date(modTime).toLocaleString()} className="tabular-nums">
          Modified {timeAgo(modTime)}
        </span>
      )}
      {exists && size > 0 && <span className="tabular-nums">{formatBytes(size)}</span>}
      {!exists && !loading && <span className="text-danger-soft">No longer on disk</span>}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative -mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-caption font-medium transition-[color,border-color] duration-150 ${
        active ? 'border-ink text-ink' : 'border-transparent text-faint hover:text-muted'
      }`}
    >
      <MaterialIcon outlined name={icon} size={14} />
      {label}
      {count !== undefined && count > 0 && <span className="font-mono text-label tabular-nums text-faint">{count}</span>}
    </button>
  )
}

function IconButton({ label, icon, onClick, disabled = false }: { label: string; icon: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-tint/[0.05] hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      <MaterialIcon outlined name={icon} size={16} />
    </button>
  )
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      role="separator"
      aria-label="Resize dialog"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      className="group absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
    >
      <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br-sm border-b-2 border-r-2 border-tint/20 transition-colors duration-150 group-hover:border-tint/50" />
    </div>
  )
}

// ---- changes -----------------------------------------------------------------------------

function ChangesTab({
  info,
  data,
  inRepo,
  shown,
  setSource,
  hasEdit,
  sameAsGit,
  path,
  providerName,
  commitDiff,
  commitFile,
  commitView,
  setCommitView,
}: {
  info: LoadState<FileDiffResult>
  data: FileDiffResult | null
  inRepo: boolean
  shown: Source
  setSource: (s: Source) => void
  hasEdit: boolean
  sameAsGit: boolean
  path: string
  providerName: string | undefined
  commitDiff: LoadState<string>
  commitFile: LoadState<string>
  commitView: 'diff' | 'file'
  setCommitView: (v: 'diff' | 'file') => void
}) {
  if (info.error) return <ErrorBlock message={info.error} onRetry={info.retry} />
  if (!data) return <Spinner label="Loading changes…" />

  const sourceBar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <SourceChip active={shown.kind === 'working'} onClick={() => setSource({ kind: 'working' })}>
        Working tree
      </SourceChip>
      {hasEdit && (
        <SourceChip active={shown.kind === 'edit'} onClick={() => setSource({ kind: 'edit' })}>
          Agent edit
        </SourceChip>
      )}
      {shown.kind === 'commit' && (
        <SourceChip active onClick={() => setSource({ kind: 'working' })} closable>
          <span className="font-mono">{shown.commit.short}</span>
          <span className="max-w-[16rem] truncate text-muted">{shown.commit.subject}</span>
        </SourceChip>
      )}
      {shown.kind === 'commit' && (
        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-line p-0.5">
          <ViewSwitch active={commitView === 'diff'} onClick={() => setCommitView('diff')} label="Changes" />
          <ViewSwitch active={commitView === 'file'} onClick={() => setCommitView('file')} label="File" />
        </div>
      )}
      {sameAsGit && shown.kind === 'working' && (
        <span className="ml-auto text-label text-faint">The agent’s recorded edit matches these changes, so it is not repeated.</span>
      )}
    </div>
  )

  const notice = !inRepo ? (
    <Notice>This folder is not a git repository. Only the agent’s recorded edit can be shown here.</Notice>
  ) : data.gitNotice ? (
    <Notice tone="warn">{data.gitNotice}</Notice>
  ) : null

  let body: ReactNode
  if (shown.kind === 'working' && data.gitDiff && parsePatch(data.gitDiff).hunks.length === 0) {
    // Git reports the file changed, but with no text to show, as for a binary file or a pure rename.
    body = (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<MaterialIcon outlined name="draft" size={26} />}
          title="No text changes to show"
          body="Git reports this file as changed, but the change has no text lines. It may be a binary file or a rename."
        />
      </div>
    )
  } else if (shown.kind === 'working') {
    body = (
      <CodeDiff
        text={data.gitDiff}
        path={path}
        kind="git"
        emptyTitle={data.exists ? 'No changes against HEAD' : 'Nothing to compare'}
        emptyBody={
          !inRepo
            ? 'Git is not tracking this folder.'
            : data.exists
              ? 'This file matches its last commit.'
              : 'The file is gone and was not committed, so there is no diff to show.'
        }
      />
    )
  } else if (shown.kind === 'edit') {
    body = (
      <CodeDiff
        text={data.recorded}
        path={path}
        kind="edit"
        emptyTitle="No recorded edit"
        emptyBody={providerName === 'codex' ? 'Codex does not send diffs, so its edits are not shown.' : 'The agent has not sent an edit for this file.'}
      />
    )
  } else {
    const loading = commitView === 'diff' ? commitDiff : commitFile
    body = loading.error ? (
      <ErrorBlock message={loading.error} onRetry={loading.retry} />
    ) : loading.data === null ? (
      <Spinner label={commitView === 'diff' ? 'Loading commit…' : 'Loading file…'} />
    ) : commitView === 'diff' ? (
      <CodeDiff text={commitDiff.data ?? ''} path={path} kind="git" emptyTitle="No change in this commit" emptyBody="This commit did not change the file." />
    ) : (
      <CodeDiff text={commitFile.data ?? ''} path={path} kind="file" emptyTitle="Empty file" emptyBody="The file had no content in this commit." />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {notice}
      {sourceBar}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">{body}</div>
    </div>
  )
}

function SourceChip({
  active,
  onClick,
  children,
  closable = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  closable?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-caption transition-colors duration-150 ${
        active ? 'border-line-strong bg-tint/[0.07] text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink'
      }`}
    >
      {children}
      {closable && <MaterialIcon outlined name="close" size={12} className="text-faint" />}
    </button>
  )
}

function ViewSwitch({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-5 rounded px-2 text-label font-medium transition-colors duration-150 ${active ? 'bg-tint/[0.08] text-ink' : 'text-faint hover:text-ink'}`}
    >
      {label}
    </button>
  )
}

// ---- activity ----------------------------------------------------------------------------

function ActivityTab({
  agentId,
  agentName,
  file,
  timeline,
  onViewEdit,
  canViewEdit,
}: {
  agentId: string
  agentName: string
  file: FileActivity | undefined
  timeline: LoadState<FileEvent[]>
  onViewEdit: () => void
  canViewEdit: boolean
}) {
  const [allAgents, setAllAgents] = useState(false)
  const ops = file?.ops ?? []
  const others = (timeline.data ?? []).filter((e) => e.agentId !== agentId)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line pb-3 text-caption">
        <Stat label="Reads" value={String(file?.reads ?? 0)} />
        <Stat label="Writes" value={String(file?.writes ?? 0)} />
        <Stat label="Last operation" value={file?.lastOp ? `${file.lastOp} · ${timeAgo(file.lastAt)}` : '—'} />
        <Stat label="State" value={file?.state ?? '—'} />
      </dl>

      <section className="min-h-0">
        <h3 className="mb-1.5 text-label font-medium uppercase tracking-[0.08em] text-faint">{agentName}</h3>
        {ops.length === 0 ? (
          <EmptyState
            icon={<MaterialIcon outlined name="history_toggle_off" size={26} />}
            title="No operations recorded"
            body="This agent has not read or edited this file. Reads and edits made through its tools are listed here as they happen."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {[...ops].reverse().map((op, i) => {
              const write = op.op === 'write'
              const tone = write ? STATUS_COLOR.writing : STATUS_COLOR.reading
              return (
                <li key={`${op.at}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-caption transition-colors duration-150 hover:bg-tint/[0.03]">
                  <MaterialIcon outlined name={write ? 'edit' : 'visibility'} size={14} style={{ color: tone }} />
                  <span className="w-12 font-medium" style={{ color: tone }}>
                    {write ? 'Write' : 'Read'}
                  </span>
                  <span className="font-mono text-label text-muted">{op.tool}</span>
                  <span className="ml-auto flex items-center gap-2 text-faint" title={new Date(op.at).toLocaleString()}>
                    {write && op.diff && canViewEdit && (
                      <button type="button" onClick={onViewEdit} className="text-label text-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline">
                        View edit
                      </button>
                    )}
                    {timeAgo(op.at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <button
          type="button"
          onClick={() => setAllAgents((v) => !v)}
          aria-expanded={allAgents}
          className="inline-flex items-center gap-1.5 text-caption text-muted transition-colors duration-150 hover:text-ink"
        >
          <MaterialIcon outlined name={allAgents ? 'expand_less' : 'expand_more'} size={15} />
          All agents in this project
          {timeline.data && <span className="font-mono text-label text-faint">{timeline.data.length}</span>}
        </button>
        {allAgents && (
          <div className="mt-2">
            {timeline.error ? (
              <ErrorBlock message={timeline.error} onRetry={timeline.retry} />
            ) : !timeline.data ? (
              <Spinner label="Loading activity…" />
            ) : timeline.data.length === 0 ? (
              <p className="text-caption text-faint">No agent in this project has read or edited this file.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {timeline.data.map((e, i) => (
                  <li key={`${e.agentId}-${e.at}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-caption">
                    <span className={`truncate ${e.agentId === agentId ? 'text-ink' : 'text-muted'}`}>{e.agentName || 'Agent'}</span>
                    <span className="text-faint">{e.op === 'write' ? 'wrote' : 'read'}</span>
                    <span className="font-mono text-label text-faint">{e.tool}</span>
                    <span className="ml-auto text-faint" title={new Date(e.at).toLocaleString()}>
                      {timeAgo(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {timeline.data && others.length === 0 && timeline.data.length > 0 && (
              <p className="mt-2 text-label text-faint">Only this agent has touched the file.</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-label uppercase tracking-[0.06em] text-faint">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  )
}

// ---- history -----------------------------------------------------------------------------

function HistoryTab({
  history,
  inRepo,
  onOpen,
}: {
  history: LoadState<GitCommit[]>
  inRepo: boolean
  onOpen: (commit: GitCommit) => void
}) {
  if (!inRepo) return <Notice>This folder is not a git repository, so there is no commit history.</Notice>
  if (history.error) return <ErrorBlock message={history.error} onRetry={history.retry} />
  if (!history.data) return <Spinner label="Loading history…" />
  if (history.data.length === 0) {
    return (
      <EmptyState
        icon={<MaterialIcon outlined name="commit" size={26} />}
        title="No commits yet"
        body="No commit in this repository has changed this file."
      />
    )
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {history.data.map((c) => (
        <li key={c.hash}>
          <button
            type="button"
            onClick={() => onOpen(c)}
            className="group flex w-full items-center gap-3 px-3 py-2 text-left text-caption transition-colors duration-150 hover:bg-tint/[0.03]"
          >
            <span className="font-mono text-label text-muted">{c.short}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{c.subject}</span>
            <span className="shrink-0 text-faint" title={new Date(c.at).toLocaleString()}>
              {c.author} · {timeAgo(c.at)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-label text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <MaterialIcon outlined name="difference" size={13} />
              Changes
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---- shared ------------------------------------------------------------------------------

function Notice({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <p className={`flex shrink-0 items-start gap-2 text-caption leading-relaxed ${tone === 'warn' ? 'text-warn-soft' : 'text-muted'}`}>
      <MaterialIcon outlined name={tone === 'warn' ? 'warning' : 'info'} size={14} className="mt-px" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger/20 bg-danger/[0.05] px-4 py-3">
      <p className="text-caption text-danger-soft">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <MaterialIcon outlined name="refresh" size={13} />
        Try again
      </Button>
    </div>
  )
}

interface LoadState<T> {
  data: T | null
  error: string | null
  retry: () => void
}

/** Runs a loader when its inputs change. A stale result from an earlier run is ignored. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null })
    load().then(
      (data) => !cancelled && setState({ data, error: null }),
      (err) => !cancelled && setState({ data: null, error: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
    // The loader is rebuilt on each render, so its inputs (deps) decide when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

function initialSize(): { w: number; h: number } {
  return {
    w: clamp(1040, MIN_WIDTH, window.innerWidth - 48),
    h: clamp(Math.round(window.innerHeight * 0.8), MIN_HEIGHT, window.innerHeight * 0.86),
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
