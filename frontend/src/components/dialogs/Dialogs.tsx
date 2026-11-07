import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { parseDiff, type DiffKind } from '../../lib/diff'
import { api, errorText } from '../../lib/bridge'
import { createProject, deleteProject, launchAgent, removeAgent, setProjectIcon, uploadProjectIcon } from '../../lib/actions'
import { closeDialog, openDialog, useStore, type Dialog as DialogState } from '../../lib/store'
import { SettingsDialog } from '../settings/SettingsDialog'
import { BrowserDialog } from '../browser/BrowserDialog'
import { baseName, projectMark, timeAgo } from '../../lib/format'
import { identityFor } from '../../lib/projectIdentity'
import { STATUS_COLOR } from '../../lib/theme'
import type { FileDiffResult } from '../../types'
import { Button, Dialog, Field, IconAlert, IconCheck, IconChevronDown, IconCpu, IconEye, IconFolder, IconPencil, IconPlay, IconPlus, IconShield, IconText, IconUnlock, Input, ModelPicker, ProviderMark, Select, Spinner, Textarea } from '../ui'

function IconBolt() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-muted">
      <path d="M13.2 2.5 4.6 13.4h6.1l-.9 8.1 8.6-10.9h-6.1l.9-8.1Z" />
    </svg>
  )
}

/** A gauge: the thinking-effort control's icon, matching the bolt's size and colour. */
function IconBrain({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <path d="M4.5 15a7.5 7.5 0 0 1 15 0" />
      <path d="M12 15l3.5-3.5" />
      <path d="M7 19h10" />
    </svg>
  )
}

/** Renders whichever dialog the store asks for. */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  const reducedMotion = useStore((s) => s.reducedMotion)
  const close = useCallback(() => closeDialog(), [])

  // Keep the last dialog mounted while it animates out. Reduced motion skips the wait.
  const [retained, setRetained] = useState<DialogState | null>(dialog)
  if (dialog && dialog !== retained) setRetained(dialog)
  const closing = !dialog && !!retained
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(() => setRetained(null), reducedMotion ? 0 : 160)
    return () => window.clearTimeout(t)
  }, [closing, reducedMotion])

  if (!retained) return null
  return (
    <div className="contents" data-closing={closing || undefined}>
      {renderDialog(retained, close)}
    </div>
  )
}

function renderDialog(dialog: NonNullable<DialogState>, close: () => void): ReactNode {
  switch (dialog.kind) {
    case 'project':
      return <ProjectDialog onClose={close} />
    case 'launch':
      return <LaunchDialog presetProjectId={dialog.projectId} onClose={close} />
    case 'file':
      return <FileDialog agentId={dialog.agentId} path={dialog.path} onClose={close} />
    case 'settings':
      return <SettingsDialog section={dialog.section} onClose={close} />
    case 'remove':
      return <ConfirmRemoveAgent agentId={dialog.agentId} onClose={close} />
    case 'deleteProject':
      return <ConfirmDeleteProject projectId={dialog.projectId} onClose={close} />
    case 'projectIcon':
      return <ProjectIconDialog projectId={dialog.projectId} onClose={close} />
    case 'browser':
      return <BrowserDialog initialUrl={dialog.url} onClose={close} />
    default:
      return null
  }
}

/** Small section label used inside dialogs. */
function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-label font-semibold uppercase tracking-[0.12em] text-faint">{children}</h3>
}

// ---- project ---------------------------------------------------------------------

function ProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async () => {
    try {
      const picked = await api.pickRepository()
      if (picked) setPath(picked)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const submit = async () => {
    if (!path.trim()) {
      setError('Choose the repository folder first.')
      return
    }
    setBusy(true)
    setError(null)
    const ok = await createProject(name, path)
    setBusy(false)
    if (!ok) setError('That folder could not be used. Check that it exists.')
  }

  return (
    <Dialog
      title="New project"
      description="A project is one repository folder. Agents launched in it work inside that folder."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Repository folder" htmlFor="project-path" hint="Choose the folder, or paste its full path." icon={<IconFolder size={13} />}>
          <div className="flex gap-2">
            <Input id="project-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Projects\my-app" className="flex-1 font-mono text-caption" />
            <Button onClick={() => void choose()} type="button" variant="secondary">
              Choose…
            </Button>
          </div>
        </Field>
        <Field label="Name" htmlFor="project-name" hint="Optional. Defaults to the folder name." icon={<IconPencil size={13} />}>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={path ? baseName(path) : 'My app'} />
        </Field>
        {error && (
          <p className="flex items-start gap-2 text-caption text-danger-soft">
            <IconAlert size={13} className="mt-0.5" />
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

// ---- launch ----------------------------------------------------------------------

const EFFORT_NAMES: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }

/** Human name for a thinking effort level. Unknown levels are shown as the CLI gives them. */
function effortName(level: string): string {
  return EFFORT_NAMES[level] ?? level
}

function LaunchDialog({ presetProjectId, onClose }: { presetProjectId?: string; onClose: () => void }) {
  const projectOrder = useStore((s) => s.projectOrder)
  const projects = useStore((s) => s.projects)
  const providers = useStore((s) => s.providers)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const firstAvailable = providers.find((p) => p.available)?.id ?? providers[0]?.id ?? ''
  const [projectId, setProjectId] = useState(presetProjectId ?? activeProjectId ?? projectOrder[0] ?? '')
  const [providerId, setProviderId] = useState(firstAvailable)
  const provider = providers.find((p) => p.id === providerId)
  const modes = provider?.capabilities.permissionModes ?? []
  const [mode, setMode] = useState(modes[0]?.id ?? '')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [task, setTask] = useState('')
  const [fast, setFast] = useState(false)
  const [effort, setEffort] = useState('')
  const [busy, setBusy] = useState(false)

  const models = provider?.capabilities.models ?? []
  // Fast mode is a per-model option. It shows only where some model offers it, and is on only for a model that does.
  const fastOffered = models.some((m) => m.fastMode)
  const fastAvailable = models.find((m) => m.id === model)?.fastMode ?? false
  const fastOn = fastOffered && fastAvailable && fast
  // Thinking effort is per model: each one offers its own levels, so the choice only applies to the selected model.
  const selectedModel = models.find((m) => m.id === model)
  const effortLevels = selectedModel?.effort ?? []
  const effortOn = effortLevels.includes(effort) ? effort : ''
  // Both get the drifting border: Ultra (Codex-only) in purple, Claude's max in rainbow.
  const effortTone = effortOn === 'ultra' ? 'effort-ultra' : effortOn === 'max' && providerId === 'claude' ? 'effort-rainbow' : ''
  // Thinking and fast mode are rarely changed, so they sit behind one disclosure. Set values stay visible in its summary.
  const hasAdvanced = effortLevels.length > 0 || fastOffered
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedSummary = [effortOn ? effortName(effortOn) : '', fastOn ? 'Fast mode' : ''].filter(Boolean).join(' · ')

  useEffect(() => {
    setMode(modes[0]?.id ?? '')
    // A model from one provider means nothing to another, so the choice resets with the provider.
    setModel('')
    setFast(false)
    setEffort('')
    // Only reset when the provider changes, not when the list object identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const project = projects[projectId]
  const canLaunch = !!project && !!provider?.available && !busy

  const submit = async () => {
    if (!canLaunch) return
    setBusy(true)
    await launchAgent({
      projectId,
      name: name.trim(),
      provider: providerId,
      model: model.trim(),
      permissionMode: mode,
      task: task.trim(),
      fastMode: fastOn,
      effort: effortOn,
    })
    setBusy(false)
  }

  // Arrow keys move through the installed providers, as in any radio group.
  const onProviderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    const enabled = providers.filter((p) => p.available)
    if (enabled.length === 0) return
    const idx = Math.max(0, enabled.findIndex((p) => p.id === providerId))
    const next = enabled[(idx + step + enabled.length) % enabled.length]
    e.preventDefault()
    setProviderId(next.id)
    document.getElementById(`launch-provider-${next.id}`)?.focus()
  }

  // ⌘/Ctrl+Enter in the task box launches, so a keyboard user never has to reach for the button.
  const onTaskKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Dialog
      title="Launch an agent"
      description="Pick a project and a provider. A task is optional; you can also send one later from Chat."
      onClose={onClose}
      width="max-w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canLaunch}>
            {!busy && <IconPlay size={11} />}
            {busy ? 'Launching…' : 'Launch agent'}
          </Button>
        </>
      }
    >
      {projectOrder.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="text-body text-muted">Create a project first. An agent always works inside a project.</p>
          <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'project' })}>
            <IconPlus size={12} />
            New project
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project" htmlFor="launch-project" icon={<IconFolder size={13} />}>
              <Select id="launch-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projectOrder.map((id) => (
                  <option key={id} value={id}>
                    {projects[id]?.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="launch-name" icon={<IconPencil size={13} />}>
              <Input id="launch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Refactor agent" maxLength={60} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-caption font-medium text-muted">Provider</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Provider" onKeyDown={onProviderKey}>
              {providers.map((p) => {
                const selected = p.id === providerId
                return (
                  <button
                    key={p.id}
                    id={`launch-provider-${p.id}`}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={!p.available}
                    onClick={() => setProviderId(p.id)}
                    className={`flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected ? 'border-ink/50 bg-white/[0.07]' : 'border-line bg-surface hover:border-line-strong hover:bg-hover'
                    }`}
                  >
                    <ProviderMark provider={p.id} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-ink">{p.name}</span>
                      <span className={`block truncate text-caption ${p.available ? 'text-faint' : 'text-warn-soft'}`} title={p.available ? p.path : p.hint}>
                        {p.available ? 'Installed' : 'Not installed'}
                      </span>
                    </span>
                    {selected && (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink text-canvas" aria-hidden="true">
                        <IconCheck size={9} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Field
            label="Task"
            htmlFor="launch-task"
            hint={`Empty starts idle. ${provider?.name ?? 'The agent'} runs in ${project ? project.repoPath : 'the project folder'}.`}
            icon={<IconText size={13} />}
          >
            <Textarea
              id="launch-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={onTaskKey}
              rows={3}
              placeholder="Add a loading state to the settings page and write a test for it."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Model"
              htmlFor="launch-model"
              hint={models.find((m) => m.id === model)?.description ?? (models.length ? 'Empty uses the provider default.' : `${provider?.name ?? 'The provider'} picks its own model.`)}
              icon={<IconCpu size={13} />}
            >
              {models.length === 0 ? (
              <Input
                id="launch-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Provider default"
                aria-label="Model"
              />
            ) : (
              <ModelPicker
                id="launch-model"
                value={model}
                onChange={(next) => {
                  setModel(next)
                  setEffort('')
                }}
                models={models}
                provider={provider?.id ?? ''}
                defaultLabel="Provider default"
                disabled={false}
                aria-label="Model"
              />
            )}
            </Field>
            <Field label="Permissions" htmlFor="launch-mode" hint={modes.find((m) => m.id === mode)?.description} icon={<IconShield size={13} />}>
              <div id="launch-mode" role="radiogroup" aria-label="Permissions" className="grid grid-cols-2 gap-1.5">
                {modes.map((m) => {
                  const selected = m.id === mode
                  const Icon = m.id === 'bypassPermissions' || m.id === 'danger-full-access' ? IconUnlock : m.id === 'plan' || m.id === 'read-only' ? IconEye : IconShield
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={modes.length <= 1}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-body font-medium transition-colors disabled:cursor-default ${
                        selected ? 'border-ink/50 bg-white/[0.07] text-ink' : 'border-line bg-surface text-muted hover:border-line-strong hover:bg-hover hover:text-ink'
                      }`}
                    >
                      <Icon size={14} />
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </Field>
          </div>

          {hasAdvanced && (
            <section>
              <button
                type="button"
                aria-expanded={advancedOpen}
                aria-controls="launch-advanced"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded text-caption font-medium text-muted transition-colors duration-150 hover:text-ink"
              >
                <IconChevronDown size={10} className={`transition-transform duration-200 motion-reduce:transition-none ${advancedOpen ? '' : '-rotate-90'}`} />
                Advanced
                {advancedSummary && <span className="font-normal text-faint">· {advancedSummary}</span>}
              </button>
              {advancedOpen && (
                <div id="launch-advanced" className="mt-3 space-y-5">
          {effortLevels.length > 0 && (
            <Field
              label="Thinking"
              htmlFor="launch-effort"
              hint={`How hard the model thinks before it answers. ${selectedModel?.defaultEffort ? `Default is ${effortName(selectedModel.defaultEffort).toLowerCase()}.` : 'Default is the CLI setting.'}`}
              icon={<IconBrain size={13} />}
            >
              <Select id="launch-effort" value={effortOn} onChange={(e) => setEffort(e.target.value)} className={effortTone}>
                <option value="">{selectedModel?.defaultEffort ? `Default (${effortName(selectedModel.defaultEffort).toLowerCase()})` : 'Default'}</option>
                {effortLevels.map((level) => (
                  <option key={level} value={level}>
                    {effortName(level)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {fastOffered && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
              <div className="min-w-0">
                <p id="launch-fast-label" className="flex items-center gap-1.5 text-body font-medium text-ink">
                  <IconBolt />
                  Fast mode
                </p>
                <p className="mt-0.5 text-caption text-faint">
                  {fastAvailable ? 'Faster output from this model.' : 'Choose a model that supports fast mode.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fastOn}
                aria-labelledby="launch-fast-label"
                disabled={!fastAvailable}
                onClick={() => setFast((v) => !v)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                  fastOn ? 'bg-ink' : 'bg-white/[0.12]'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-canvas transition-transform duration-150 motion-reduce:transition-none ${
                    fastOn ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )}
                </div>
              )}
            </section>
          )}

          {provider && !provider.available && (
            <p className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/[0.06] px-3 py-2 text-caption text-warn-soft">
              <IconAlert size={13} className="mt-0.5" />
              {provider.name} isn’t installed, so this provider can’t launch yet.
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

// ---- file ----------------------------------------------------------------------------

function FileDialog({ agentId, path, onClose }: { agentId: string; path: string; onClose: () => void }) {
  const detail = useStore((s) => s.details[agentId])
  const agent = useStore((s) => s.agents[agentId])
  const file = detail?.files[path]
  const [result, setResult] = useState<FileDiffResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getFileDiff(agentId, path)
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [agentId, path])

  const diff = result?.recorded || ''
  return (
    <Dialog title={baseName(path)} description={path} onClose={onClose} width="max-w-3xl">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-2 text-caption">
          <Info label="Last operation" value={file ? `${file.lastOp || '—'} · ${file.state}` : '—'} />
          <Info label="Writes / reads" value={file ? `${file.writes} / ${file.reads}` : '—'} />
          <Info label="Last touched" value={file ? timeAgo(file.lastAt) : '—'} />
        </div>

        <section>
          <SectionLabel>Operations</SectionLabel>
          {file?.ops && file.ops.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
              {[...file.ops].reverse().map((op, i) => (
                <li key={`${op.at}-${i}`} className="flex items-center gap-3 px-3 py-2 text-caption">
                  <span className="flex w-14 items-center gap-1.5 font-medium" style={{ color: op.op === 'write' ? STATUS_COLOR.writing : STATUS_COLOR.reading }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: op.op === 'write' ? STATUS_COLOR.writing : STATUS_COLOR.reading }} />
                    {op.op === 'write' ? 'Write' : 'Read'}
                  </span>
                  <span className="font-mono text-label text-muted">{op.tool}</span>
                  <span className="ml-auto text-faint">{timeAgo(op.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-faint">No recorded operations.</p>
          )}
        </section>

        <section>
          <SectionLabel>Diff</SectionLabel>
          {!result && !error && <Spinner label="Loading diff…" />}
          {error && <p className="text-caption text-danger-soft">{error}</p>}
          {result && (
            <>
              {diff ? (
                <DiffView text={diff} />
              ) : (
                <p className="text-caption text-faint">{agent?.provider === 'codex' ? 'Codex does not send diffs. ' : ''}No diff was recorded for this file.</p>
              )}
              {result.gitDiff && (
                <div className="mt-5">
                  <p className="mb-2 text-caption text-muted">Working tree against HEAD (git)</p>
                  <DiffView text={result.gitDiff} />
                </div>
              )}
              {result.gitNotice && !result.gitDiff && <p className="mt-3 text-label text-faint">{result.gitNotice}</p>}
            </>
          )}
        </section>
      </div>
    </Dialog>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-3 py-2">
      <div className="text-label text-muted">{label}</div>
      <div className="mt-0.5 truncate font-medium text-ink">{value}</div>
    </div>
  )
}

const DIFF_TONE: Record<DiffKind, string> = {
  add: 'bg-ok/[0.07] text-ok',
  del: 'bg-danger/[0.07] text-danger-soft',
  ctx: 'text-ink/70',
  hunk: 'bg-white/[0.03] text-muted',
  meta: 'text-faint',
}
const DIFF_SIGN: Record<DiffKind, string> = { add: '+', del: '−', ctx: ' ', hunk: ' ', meta: ' ' }

/** Unified diff with old and new line numbers, a change count, and per-line tinting. */
export function DiffView({ text }: { text: string }) {
  const { rows, additions, deletions } = useMemo(() => parseDiff(text), [text])
  return (
    <div>
      <p className="mb-2 flex items-center gap-3 font-mono text-label tabular-nums">
        <span className="text-ok">+{additions}</span>
        <span className="text-danger-soft">−{deletions}</span>
      </p>
      <div className="max-h-96 overflow-auto rounded-lg border border-line bg-canvas font-mono text-caption leading-[1.65]">
        <div className="min-w-max py-1.5">
          {rows.map((r, i) => (
            <div key={i} className={`flex whitespace-pre ${DIFF_TONE[r.kind]}`}>
              <span className="w-11 shrink-0 select-none pr-2 text-right text-faint/70" aria-hidden="true">
                {r.oldNo ?? ''}
              </span>
              <span className="w-11 shrink-0 select-none pr-2 text-right text-faint/70" aria-hidden="true">
                {r.newNo ?? ''}
              </span>
              <span className="w-4 shrink-0 select-none text-faint" aria-hidden="true">
                {DIFF_SIGN[r.kind]}
              </span>
              <span className="pr-4">{r.text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- confirmations ---------------------------------------------------------------------------

function ConfirmRemoveAgent({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const agent = useStore((s) => s.agents[agentId])
  const [busy, setBusy] = useState(false)
  if (!agent) return null
  return (
    <Dialog
      title={`Remove ${agent.name}?`}
      description="Its history, files and chat are deleted from Orbit. Its code changes stay in the repository."
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep agent
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await removeAgent(agentId)
              setBusy(false)
            }}
          >
            {agent.running ? 'Stop and remove' : 'Remove agent'}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 px-3 py-2.5 text-body text-muted">
        <ProviderMark provider={agent.provider} size={22} />
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        <span className="flex items-center gap-1.5 text-caption capitalize" style={{ color: STATUS_COLOR[agent.status] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[agent.status] }} />
          {agent.status}
        </span>
      </div>
    </Dialog>
  )
}

/**
 * Sets a project's sun: a letter, or an uploaded PNG that replaces it. Empty input restores
 * the first letter of the name. A chosen file takes precedence over the letter field.
 */
function ProjectIconDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.projects[projectId])
  const [icon, setIcon] = useState(project?.icon ?? '')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [currentImage, setCurrentImage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const iconRev = project?.iconRev ?? 0

  // Object URL for a chosen file, released when the file changes or the dialog closes.
  useEffect(() => {
    if (!file) {
      setFilePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFilePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // The project's current uploaded PNG, shown when no new file is chosen.
  useEffect(() => {
    let cancelled = false
    if (!iconRev) {
      setCurrentImage(null)
      return
    }
    api
      .getProjectIcon(projectId)
      .then((url) => {
        if (!cancelled) setCurrentImage(url || null)
      })
      .catch(() => {
        if (!cancelled) setCurrentImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, iconRev])

  if (!project) return null
  const shownImage = filePreview ?? currentImage
  const preview = icon.trim() || projectMark({ name: project.name })

  const save = async (value: string) => {
    setBusy(true)
    await setProjectIcon(projectId, value)
    setBusy(false)
  }
  const submit = async () => {
    if (file) {
      setBusy(true)
      await uploadProjectIcon(projectId, file)
      setBusy(false)
    } else {
      await save(icon)
    }
  }

  return (
    <Dialog
      title="Project icon"
      description="What’s shown on this project’s sun: a letter of up to two characters, or a square PNG up to 2 MB. Leave the letter empty to use the first letter of the name."
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => void save('')} disabled={busy}>
            Reset to default
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : file ? 'Upload icon' : 'Save icon'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex items-center gap-4">
          {shownImage ? (
            <img
              src={shownImage}
              alt=""
              className="h-14 w-14 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-display font-semibold text-canvas"
              style={{ background: identityFor(project.id).accent }}
            >
              {preview}
            </span>
          )}
          <Field label="Icon" htmlFor="project-icon" hint={file ? 'Replaced by the uploaded image' : `${project.name}`} icon={<IconPencil size={13} />}>
            <Input
              id="project-icon"
              value={icon}
              maxLength={2}
              autoFocus
              disabled={!!file}
              onChange={(e) => setIcon(e.target.value)}
              placeholder={projectMark({ name: project.name })}
              className="w-28 text-center text-title font-semibold"
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0]
              if (chosen) setFile(chosen)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload PNG…
          </Button>
          {file && (
            <>
              <span className="min-w-0 truncate text-caption text-muted">{file.name}</span>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={busy}>
                Remove
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  )
}

function ConfirmDeleteProject({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.projects[projectId])
  const agentCount = useStore((s) => Object.values(s.agents).filter((a) => a.projectId === projectId).length)
  const [busy, setBusy] = useState(false)
  if (!project) return null
  return (
    <Dialog
      title={`Remove ${project.name}?`}
      description={`This removes the project from Orbit${agentCount ? ` and its ${agentCount} agent${agentCount === 1 ? '' : 's'}, stopping any that are running` : ''}. Your files on disk are not touched.`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await deleteProject(projectId)
              setBusy(false)
            }}
          >
            Remove project
          </Button>
        </>
      }
    >
      <p className="truncate rounded-lg border border-line bg-surface/60 px-3 py-2 font-mono text-caption text-faint" title={project.repoPath}>
        {project.repoPath}
      </p>
    </Dialog>
  )
}
