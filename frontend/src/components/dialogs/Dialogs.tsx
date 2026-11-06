import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { parseDiff, type DiffKind } from '../../lib/diff'
import { api, errorText } from '../../lib/bridge'
import { createProject, deleteProject, launchAgent, removeAgent, setProjectIcon, uploadProjectIcon } from '../../lib/actions'
import { closeDialog, openDialog, useStore } from '../../lib/store'
import { baseName, projectMark, timeAgo } from '../../lib/format'
import { SHORTCUTS } from '../../lib/shortcuts'
import { STATUS_COLOR } from '../../lib/theme'
import type { FileDiffResult } from '../../types'
import { Button, Dialog, Field, IconAlert, IconCheck, IconCpu, IconFolder, IconPencil, IconPlay, IconPlus, IconShield, IconText, Input, Kbd, ProviderMark, Select, Spinner, Tag, Textarea } from '../ui'

/** Renders whichever dialog the store asks for. */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  const close = useCallback(() => closeDialog(), [])
  if (!dialog) return null
  switch (dialog.kind) {
    case 'project':
      return <ProjectDialog onClose={close} />
    case 'launch':
      return <LaunchDialog presetProjectId={dialog.projectId} onClose={close} />
    case 'file':
      return <FileDialog agentId={dialog.agentId} path={dialog.path} onClose={close} />
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />
    case 'remove':
      return <ConfirmRemoveAgent agentId={dialog.agentId} onClose={close} />
    case 'deleteProject':
      return <ConfirmDeleteProject projectId={dialog.projectId} onClose={close} />
    case 'projectIcon':
      return <ProjectIconDialog projectId={dialog.projectId} onClose={close} />
    default:
      return null
  }
}

/** Small section label used inside dialogs. */
function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{children}</h3>
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
            <Input id="project-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Projects\my-app" className="flex-1 font-mono text-[12px]" />
            <Button onClick={() => void choose()} type="button" variant="secondary">
              Choose…
            </Button>
          </div>
        </Field>
        <Field label="Name" htmlFor="project-name" hint="Optional. Defaults to the folder name." icon={<IconPencil size={13} />}>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={path ? baseName(path) : 'My app'} />
        </Field>
        {error && (
          <p className="flex items-start gap-2 text-[12px] text-danger-soft">
            <IconAlert size={13} className="mt-0.5" />
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

// ---- launch ----------------------------------------------------------------------

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
  const [busy, setBusy] = useState(false)

  const models = provider?.capabilities.models ?? []
  const modelGroups = [...new Set(models.map((m) => m.group))]

  useEffect(() => {
    setMode(modes[0]?.id ?? '')
    // A model from one provider means nothing to another, so the choice resets with the provider.
    setModel('')
    // Only reset when the provider changes, not when the list object identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const project = projects[projectId]
  const canLaunch = !!project && !!provider?.available && !busy

  const submit = async () => {
    if (!canLaunch) return
    setBusy(true)
    await launchAgent({ projectId, name: name.trim(), provider: providerId, model: model.trim(), permissionMode: mode, task: task.trim() })
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
          <p className="text-[13px] text-muted">Create a project first. An agent always works inside a project.</p>
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
            <legend className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">Provider</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Provider" onKeyDown={onProviderKey}>
              {providers.map((p) => {
                const selected = p.id === providerId
                const statusTone = p.available ? 'ok' : 'warn'
                return (
                  <button
                    key={p.id}
                    id={`launch-provider-${p.id}`}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={!p.available}
                    onClick={() => setProviderId(p.id)}
                    className={`relative flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-[border-color,background-color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected ? 'border-white/30 bg-white/[0.05]' : 'border-line bg-surface hover:border-line-strong hover:bg-hover'
                    }`}
                  >
                    <span className="flex w-full items-center gap-2">
                      <ProviderMark provider={p.id} size={22} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
                      {selected && (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink text-canvas">
                          <IconCheck size={9} />
                        </span>
                      )}
                    </span>
                    <span>
                      <Tag tone={statusTone}>{p.available ? 'Installed' : 'Not installed'}</Tag>
                    </span>
                    <span className="line-clamp-1 w-full break-all font-mono text-[10.5px] leading-snug text-faint" title={p.available ? p.path : p.hint}>
                      {p.available ? p.path : p.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Model"
              htmlFor="launch-model"
              hint={models.find((m) => m.id === model)?.description ?? (models.length ? 'Empty uses the provider default.' : `${provider?.name ?? 'The provider'} picks its own model.`)}
              icon={<IconCpu size={13} />}
            >
              <Select id="launch-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={models.length === 0}>
                <option value="">Provider default</option>
                {modelGroups.map((group) => (
                  <optgroup key={group} label={group}>
                    {models
                      .filter((m) => m.group === group)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Permissions" htmlFor="launch-mode" hint={modes.find((m) => m.id === mode)?.description} icon={<IconShield size={13} />}>
              <Select id="launch-mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={modes.length <= 1}>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

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

          {provider && !provider.available && (
            <p className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12px] text-warn-soft">
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
        <div className="grid grid-cols-3 gap-2 text-[12px]">
          <Info label="Last operation" value={file ? `${file.lastOp || '—'} · ${file.state}` : '—'} />
          <Info label="Writes / reads" value={file ? `${file.writes} / ${file.reads}` : '—'} />
          <Info label="Last touched" value={file ? timeAgo(file.lastAt) : '—'} />
        </div>

        <section>
          <SectionLabel>Operations</SectionLabel>
          {file?.ops && file.ops.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
              {[...file.ops].reverse().map((op, i) => (
                <li key={`${op.at}-${i}`} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <span className="flex w-14 items-center gap-1.5 font-medium" style={{ color: op.op === 'write' ? STATUS_COLOR.writing : STATUS_COLOR.reading }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: op.op === 'write' ? STATUS_COLOR.writing : STATUS_COLOR.reading }} />
                    {op.op === 'write' ? 'Write' : 'Read'}
                  </span>
                  <span className="font-mono text-[11px] text-muted">{op.tool}</span>
                  <span className="ml-auto text-faint">{timeAgo(op.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">No recorded operations.</p>
          )}
        </section>

        <section>
          <SectionLabel>Diff</SectionLabel>
          {!result && !error && <Spinner label="Loading diff…" />}
          {error && <p className="text-[12px] text-danger-soft">{error}</p>}
          {result && (
            <>
              {diff ? (
                <DiffView text={diff} />
              ) : (
                <p className="text-[12px] text-faint">{agent?.provider === 'codex' ? 'Codex does not send diffs. ' : ''}No diff was recorded for this file.</p>
              )}
              {result.gitDiff && (
                <div className="mt-5">
                  <p className="mb-2 text-[12px] text-muted">Working tree against HEAD (git)</p>
                  <DiffView text={result.gitDiff} />
                </div>
              )}
              {result.gitNotice && !result.gitDiff && <p className="mt-3 text-[11px] text-faint">{result.gitNotice}</p>}
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
      <div className="text-[11px] text-muted">{label}</div>
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
function DiffView({ text }: { text: string }) {
  const { rows, additions, deletions } = useMemo(() => parseDiff(text), [text])
  return (
    <div>
      <p className="mb-2 flex items-center gap-3 font-mono text-[11px] tabular-nums">
        <span className="text-ok">+{additions}</span>
        <span className="text-danger-soft">−{deletions}</span>
      </p>
      <div className="max-h-96 overflow-auto rounded-lg border border-line bg-canvas font-mono text-[11.5px] leading-[1.65]">
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

// ---- shortcuts ---------------------------------------------------------------------------

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width="max-w-md">
      <ul className="divide-y divide-line">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
            <span className="text-ink/85">{s.action}</span>
            <span className="flex shrink-0 items-center gap-1">
              {s.keys.split(' ').filter((k) => k !== '+' && k !== '/' && k !== '–').map((k, i) => (
                <Kbd key={`${k}-${i}`}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
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
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 px-3 py-2.5 text-[13px] text-muted">
        <ProviderMark provider={agent.provider} size={22} />
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        <span className="flex items-center gap-1.5 text-[12px] capitalize" style={{ color: STATUS_COLOR[agent.status] }}>
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
              className="h-14 w-14 shrink-0 rounded-full object-cover shadow-[0_0_24px_rgba(224,169,109,0.35)]"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-extrabold text-canvas shadow-[0_0_24px_rgba(224,169,109,0.35)]"
              style={{ background: 'radial-gradient(circle at 35% 30%, #fff4dc 0%, #e0a96d 60%, #b8834a 100%)' }}
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
              className="w-28 text-center text-[16px] font-semibold"
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
              <span className="min-w-0 truncate text-[12px] text-muted">{file.name}</span>
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
      <p className="truncate rounded-lg border border-line bg-surface/60 px-3 py-2 font-mono text-[12px] text-faint" title={project.repoPath}>
        {project.repoPath}
      </p>
    </Dialog>
  )
}
