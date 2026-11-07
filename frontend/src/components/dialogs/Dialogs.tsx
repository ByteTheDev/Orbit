import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { addImages, toUploads, type PendingImage } from '../../lib/chatImages'
import { api, errorText } from '../../lib/bridge'
import { createProject, deleteProject, launchAgent, removeAgent, setProjectIcon, uploadProjectIcon } from '../../lib/actions'
import { closeDialog, openDialog, useStore, type Dialog as DialogState } from '../../lib/store'
import { SettingsDialog } from '../settings/SettingsDialog'
import { BrowserDialog } from '../browser/BrowserDialog'
// The file inspector pulls in the syntax highlighter, so it loads when a file is first opened.
const FileInspector = lazy(() => import('./FileInspector').then((m) => ({ default: m.FileInspector })))
import { AutomationsDialog } from '../automations/AutomationsDialog'
import { baseName, projectMark } from '../../lib/format'
import { identityFor } from '../../lib/projectIdentity'
import { STATUS_COLOR } from '../../lib/theme'
import type { BranchInfo } from '../../types'
import { IconBranch } from '../inspector/inspectorIcons'
import { defaultModelFor } from '../../lib/defaultModel'
import { defaultPermissionFor } from '../../lib/defaultPermission'
import { Button, Dialog, Field, IconAlert, IconCheck, IconEye, IconFolder, IconPencil, IconPlay, IconPlus, IconShield, IconText, IconUnlock, IconX, Input, ProviderMark, Select, Textarea } from '../ui'
import { SpeedPicker, speedOf, speedOptionsFor } from '../ui/SpeedPicker'
import { ModelFields } from './TeamFields'

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
      return (
        <Suspense fallback={null}>
          <FileInspector agentId={dialog.agentId} path={dialog.path} onClose={close} />
        </Suspense>
      )
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
    case 'automations':
      return <AutomationsDialog onClose={close} />
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

/** The branch picker's value for "New branch…". It contains a space, which git never allows in a branch name, so it cannot clash with one. */
const NEW_BRANCH = 'new branch…'

/** Permission modes that let the agent act without asking. They get a warning instead of a quiet note. */
const RISKY_MODES = new Set(['bypassPermissions', 'danger-full-access', 'full-access'])

function LaunchDialog({ presetProjectId, onClose }: { presetProjectId?: string; onClose: () => void }) {
  const projectOrder = useStore((s) => s.projectOrder)
  const projects = useStore((s) => s.projects)
  const providers = useStore((s) => s.providers)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const defaultModels = useStore((s) => s.settings.defaultModels)
  const defaultPermissions = useStore((s) => s.settings.defaultPermissions)

  const firstAvailable = providers.find((p) => p.available)?.id ?? providers[0]?.id ?? ''
  const [projectId, setProjectId] = useState(presetProjectId ?? activeProjectId ?? projectOrder[0] ?? '')
  const [providerId, setProviderId] = useState(firstAvailable)
  const provider = providers.find((p) => p.id === providerId)
  const modes = provider?.capabilities.permissionModes ?? []
  const [mode, setMode] = useState(defaultPermissionFor(defaultPermissions, providerId, modes) || (modes[0]?.id ?? ''))
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [task, setTask] = useState('')
  // Images pasted into the task box. They go with the first message. The ref lets a quick second paste see the first.
  const [images, setImages] = useState<PendingImage[]>([])
  const imagesRef = useRef<PendingImage[]>([])
  const [imageNote, setImageNote] = useState('')
  const [fast, setFast] = useState(false)
  const [ultra, setUltra] = useState(false)
  const [effort, setEffort] = useState('')
  const [busy, setBusy] = useState(false)
  // Branches belong to one project, so the list reloads when the project changes. Empty choice = project folder.
  const [branches, setBranches] = useState<BranchInfo | null>(null)
  const [branchError, setBranchError] = useState('')
  const [branchChoice, setBranchChoice] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const newMode = branchChoice === NEW_BRANCH

  useEffect(() => {
    let live = true
    setBranches(null)
    setBranchError('')
    setBranchChoice('')
    if (projectId) {
      api
        .projectBranches(projectId)
        .then((info) => {
          if (!live) return
          setBranches(info)
          setBranchChoice(info.current)
        })
        .catch((err: unknown) => {
          if (live) setBranchError(errorText(err))
        })
    }
    return () => {
      live = false
    }
  }, [projectId])

  const models = provider?.capabilities.models ?? []
  // Fast mode is a per-model option. It shows only where some model offers it, and is on only for a model that does.
  const fastOffered = models.some((m) => m.fastMode)
  const fastAvailable = models.find((m) => m.id === model)?.fastMode ?? false
  const fastOn = fastOffered && fastAvailable && fast
  // Ultrafast is offered only on a model the signed-in account can run that way, and is on only then.
  const ultraAvailable = models.find((m) => m.id === model)?.ultraFast ?? false
  const ultraOn = ultraAvailable && ultra
  // Thinking effort is per model: each one offers its own levels, so the choice only applies to the selected model.
  const selectedModel = models.find((m) => m.id === model)
  const effortLevels = selectedModel?.effort ?? []
  const effortOn = effortLevels.includes(effort) ? effort : ''

  useEffect(() => {
    // The saved permission default for this provider, if it still offers it; otherwise its first mode.
    setMode(defaultPermissionFor(defaultPermissions, providerId, modes) || (modes[0]?.id ?? ''))
    // A model from one provider means nothing to another, so the choice follows the provider: its saved default, if it still offers it.
    setModel(defaultModelFor(defaultModels, providerId, models))
    setFast(false)
    setUltra(false)
    setEffort('')
    // Only reset when the provider changes, not when the list object identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const project = projects[projectId]
  const canLaunch = !!project && !!provider?.available && !busy && (!newMode || newBranchName.trim() !== '')

  const root = branches?.worktreeRoot ?? ''
  const branchHint = !branches
    ? ''
    : newMode
      ? `A new branch from ${branches.current || 'HEAD'} gets its own worktree in ${root}.`
      : branchChoice && branchChoice !== branches.current
        ? `Runs in its own worktree under ${root}.`
        : 'Runs in the project folder.'

  // The field notes. Secondary explanations live in tooltips; only a branch note shows inline, because it changes where the agent works.
  const branchNote = !branches
    ? ''
    : newMode
      ? `New branch from ${branches.current || 'HEAD'}`
      : branchChoice && branchChoice !== branches.current
        ? 'Separate worktree'
        : ''
  const selectedMode = modes.find((m) => m.id === mode)
  const modeRisky = RISKY_MODES.has(mode)
  const taskNote = `Empty starts idle. ${provider?.name ?? 'The agent'} runs in ${project ? project.repoPath : 'the project folder'}. Ctrl/⌘+Enter launches.`

  const submit = async () => {
    if (!canLaunch) return
    setBusy(true)
    const first = {
      projectId,
      name: name.trim(),
      provider: providerId,
      model: model.trim(),
      permissionMode: mode,
      task: task.trim(),
      images: toUploads(images),
      fastMode: fastOn || ultraOn,
      ultraFast: ultraOn,
      effort: effortOn,
      branch: newMode ? newBranchName.trim() : branchChoice,
      newBranch: newMode,
    }
    await launchAgent(first)
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

  // The permission group is a radio group too: arrows move and focus the next choice.
  const onModeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || modes.length === 0) return
    const idx = Math.max(0, modes.findIndex((m) => m.id === mode))
    const next = modes[(idx + step + modes.length) % modes.length]
    e.preventDefault()
    setMode(next.id)
    document.getElementById(`launch-mode-${next.id}`)?.focus()
  }

  // ⌘/Ctrl+Enter in the task box launches, so a keyboard user never has to reach for the button.
  const onTaskKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const setImagesFor = (next: PendingImage[]) => {
    imagesRef.current = next
    setImages(next)
  }

  // Pasting an image attaches it to the first message. Text pastes behave as usual.
  const onTaskPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    void addImages(files, imagesRef.current.length).then(({ added, problems }) => {
      if (added.length) setImagesFor([...imagesRef.current, ...added])
      setImageNote(problems.join(' '))
    })
  }

  return (
    <Dialog
      title="Launch an agent"
      onClose={onClose}
      width="max-w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canLaunch} title="Launch (Ctrl/⌘+Enter in the task box)">
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
        <div className="space-y-3.5">
          <SectionLabel>Setup</SectionLabel>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Project" htmlFor="launch-project" icon={<IconFolder size={13} />}>
              <div title={project?.repoPath}>
                <Select id="launch-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projectOrder.map((id) => (
                    <option key={id} value={id}>
                      {projects[id]?.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="Name" htmlFor="launch-name" icon={<IconPencil size={13} />}>
              <Input id="launch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Refactor agent" maxLength={60} />
            </Field>
          </div>

          <Field label="Branch" htmlFor="launch-branch" hint={branchError ? undefined : branchNote} icon={<IconBranch size={13} />}>
            {branchError ? (
              <p className="text-caption text-faint">Branches unavailable: {branchError}. The agent runs in the project folder.</p>
            ) : (
              <div className="space-y-2" title={branchHint || undefined}>
                <Select id="launch-branch" aria-label="Branch" value={branchChoice} disabled={!branches} onChange={(e) => setBranchChoice(e.target.value)}>
                  {!branches && <option value="">Loading branches…</option>}
                  {branches && !branches.current && <option value="">Project folder (detached HEAD)</option>}
                  {branches?.branches.map((b) => (
                    <option key={b} value={b}>
                      {b === branches.current ? `${b} (current)` : b}
                    </option>
                  ))}
                  {branches && <option value={NEW_BRANCH}>New branch…</option>}
                </Select>
                {newMode && (
                  <Input
                    id="launch-new-branch"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="feature/my-change"
                    maxLength={100}
                    aria-label="New branch name"
                    className="font-mono text-caption"
                  />
                )}
              </div>
            )}
          </Field>

          <SectionLabel>Agent</SectionLabel>
          <fieldset>
            <legend className="mb-1.5 text-caption font-medium text-muted">Provider</legend>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]" role="radiogroup" aria-label="Provider" onKeyDown={onProviderKey}>
              {providers.map((p) => {
                const selected = p.id === providerId
                return (
                  <button
                    key={p.id}
                    id={`launch-provider-${p.id}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={!p.available}
                    onClick={() => setProviderId(p.id)}
                    title={p.available ? p.path : p.hint}
                    className={`flex h-10 min-w-0 items-center gap-2 rounded-md border px-2.5 text-left outline-none transition-[border-color,background-color] duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-tint/[0.08] disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected ? 'border-tint/25 bg-tint/[0.06]' : 'border-line bg-surface hover:border-line-strong hover:bg-hover'
                    }`}
                  >
                    <ProviderMark provider={p.id} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-caption font-semibold ${p.available ? 'text-ink' : 'text-muted'}`}>{p.name}</span>
                      <span className={`block truncate text-label ${p.available ? 'text-faint' : 'text-warn-soft'}`}>{p.available ? 'Installed' : 'Not installed'}</span>
                    </span>
                    {selected && (
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-ink text-canvas" aria-hidden="true">
                        <IconCheck size={8} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {provider && !provider.available && (
            <p className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/[0.06] px-2.5 py-1.5 text-caption text-warn-soft">
              <IconAlert size={12} className="mt-0.5 shrink-0" />
              {provider.name} isn’t installed, so this provider can’t launch yet.
            </p>
          )}

          <ModelFields
            idPrefix="launch"
            providerId={providerId}
            models={models}
            model={model}
            onModel={(next) => {
              setModel(next)
              setEffort('')
            }}
            effort={effortOn}
            onEffort={setEffort}
          />

          {fastOffered && (
            <Field label="Speed" hint={fastAvailable ? undefined : 'Needs a model that supports fast mode.'}>
              <SpeedPicker
                value={speedOf(fastOn, ultraOn)}
                options={speedOptionsFor(ultraAvailable)}
                disabled={!fastAvailable}
                aria-label="Speed for the new agent"
                onChange={(id) => {
                  setFast(id !== 'standard')
                  setUltra(id === 'ultrafast')
                }}
              />
            </Field>
          )}

          <SectionLabel>Task</SectionLabel>
          <Field label="Permissions" icon={<IconShield size={13} />}>
            <div id="launch-mode" role="radiogroup" aria-label="Permissions" onKeyDown={onModeKey} className="flex gap-0.5 rounded-lg border border-line bg-surface p-0.5">
              {modes.map((m) => {
                const selected = m.id === mode
                const Icon = RISKY_MODES.has(m.id) ? IconUnlock : m.id === 'plan' || m.id === 'read-only' ? IconEye : IconShield
                return (
                  <button
                    key={m.id}
                    id={`launch-mode-${m.id}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    disabled={modes.length <= 1}
                    onClick={() => setMode(m.id)}
                    title={m.description}
                    className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-caption font-medium outline-none transition-[background-color,color] duration-150 focus-visible:ring-[3px] focus-visible:ring-tint/[0.08] disabled:cursor-default ${
                      selected ? 'bg-tint/[0.09] text-ink shadow-sm shadow-black/30' : 'text-muted hover:text-ink'
                    }`}
                  >
                    <Icon size={12} className="shrink-0" />
                    <span className="truncate">{m.label}</span>
                  </button>
                )
              })}
            </div>
            {selectedMode?.description && (
              // The one permission explanation that stays visible. A full-access mode gets a warning, not a quieter note.
              <p className={`flex items-start gap-1.5 text-label leading-relaxed ${modeRisky ? 'text-warn-soft' : 'text-faint'}`}>
                {modeRisky && <IconAlert size={11} className="mt-0.5 shrink-0" />}
                {selectedMode.description}
              </p>
            )}
          </Field>

          <Field label="Task" htmlFor="launch-task" icon={<IconText size={13} />}>
            <Textarea
              id="launch-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={onTaskKey}
              onPaste={onTaskPaste}
              rows={3}
              title={taskNote}
              placeholder="Add a loading state to the settings page and write a test for it."
            />
            {images.length > 0 && (
              <ul aria-label="Attached images" className="flex flex-wrap gap-2 pt-2">
                {images.map((img) => (
                  <li key={img.id} className="relative">
                    <img src={img.preview} alt={img.name} title={img.name} className="h-12 w-12 rounded-md border border-tint/[0.08] object-cover" />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${img.name}`}
                      title="Remove"
                      onClick={() => setImagesFor(imagesRef.current.filter((i) => i.id !== img.id))}
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-tint/[0.08] bg-canvas px-0"
                    >
                      <IconX size={9} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {imageNote && (
              <p role="alert" className="pt-1 text-label text-danger-soft">
                {imageNote}
              </p>
            )}
          </Field>

        </div>
      )}
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
