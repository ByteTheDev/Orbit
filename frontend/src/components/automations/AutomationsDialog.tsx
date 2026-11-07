import { useState, type FormEvent, type ReactNode } from 'react'
import type { Automation } from '../../types'
import { deleteAutomation, runAutomation, saveAutomation } from '../../lib/actions'
import { DAY_LONG, DAY_SHORT, EVERY_DAY, MAX_AUTOMATION_NAME, WEEKDAYS, draftProblem, nextRunLabel, scheduleLabel } from '../../lib/automation'
import { defaultModelFor } from '../../lib/defaultModel'
import { useStore } from '../../lib/store'
import { Button, Dialog, Field, IconAlert, IconClock, IconPencil, IconPlay, IconPlus, IconTrash, Input, ModelPicker, Select, SwitchGlyph, Textarea } from '../ui'

/** Permission modes that act without asking. An automation has nobody to ask, so these get a warning. */
const RISKY_MODES = new Set(['bypassPermissions', 'danger-full-access', 'full-access'])

/**
 * Scheduled launches. An automation starts an agent on its own at a set time each week, in one project.
 * The list shows each one with its next run; the form creates and edits them.
 */
export function AutomationsDialog({ onClose }: { onClose: () => void }) {
  // null shows the list. 'new' or an automation opens the form for it.
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)
  const hasProjects = useStore((s) => s.projectOrder.length > 0)
  const title = editing === null ? 'Automations' : editing === 'new' ? 'New automation' : 'Edit automation'

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width="max-w-[580px]"
      footer={
        editing === null ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')} disabled={!hasProjects} title={hasProjects ? undefined : 'Create a project first'}>
              <IconPlus size={12} />
              New automation
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Back
            </Button>
            <Button variant="primary" type="submit" form="automation-form">
              Save automation
            </Button>
          </>
        )
      }
    >
      {editing === null ? (
        <AutomationList onEdit={setEditing} />
      ) : (
        <AutomationForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onSaved={() => setEditing(null)} />
      )}
    </Dialog>
  )
}

// ---- list -------------------------------------------------------------------------

function AutomationList({ onEdit }: { onEdit: (a: Automation) => void }) {
  const automations = useStore((s) => s.automations)
  const projects = useStore((s) => s.projects)
  const providers = useStore((s) => s.providers)
  // Deleting takes two clicks: the first asks, so a stray click cannot remove a schedule.
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (automations.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-line text-faint">
          <IconClock size={15} />
        </span>
        <p className="text-body font-medium text-ink">No automations yet</p>
        <p className="mt-1 max-w-sm text-caption leading-relaxed text-muted">
          An automation starts an agent on a schedule, such as every Thursday at 3 PM. Orbit has to be open for it to run.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-line">
      {automations.map((a) => {
        const projectName = projects[a.projectId]?.name ?? 'Project removed'
        const providerName = providers.find((p) => p.id === a.provider)?.name ?? a.provider
        return (
          <li key={a.id} className="flex items-start gap-3 py-3">
            <Switch on={a.enabled} label={`${a.enabled ? 'Pause' : 'Resume'} ${a.name}`} onChange={(on) => void saveAutomation({ ...a, enabled: on })} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-ink">{a.name}</p>
              <p className="truncate text-caption text-muted">
                {scheduleLabel(a.days, a.time)} · {projectName} · {providerName}
              </p>
              <p className="text-label text-faint">{a.enabled && a.nextRunAt ? `Next ${nextRunLabel(a.nextRunAt)}` : 'Paused'}</p>
              {a.lastError && (
                <p className="mt-1 flex items-start gap-1.5 text-label leading-relaxed text-warn-soft">
                  <IconAlert size={11} className="mt-0.5 shrink-0" />
                  {a.lastError}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {confirmId === a.id ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => { setConfirmId(null); void deleteAutomation(a.id) }}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <>
                  <IconButton label={`Run ${a.name} now`} onClick={() => void runAutomation(a.id)}>
                    <IconPlay size={11} />
                  </IconButton>
                  <IconButton label={`Edit ${a.name}`} onClick={() => onEdit(a)}>
                    <IconPencil size={12} />
                  </IconButton>
                  <IconButton label={`Delete ${a.name}`} onClick={() => setConfirmId(a.id)}>
                    <IconTrash size={12} />
                  </IconButton>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** A square icon-only button. The label is its accessible name and tooltip. */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={label} title={label} className="h-7 w-7 px-0">
      {children}
    </Button>
  )
}

/** A plain on/off switch in the shared Material toggle style. Fast mode has its own FastSwitch. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="mt-0.5 shrink-0 rounded-md outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-white/[0.08]"
    >
      <SwitchGlyph on={on} size={30} />
    </button>
  )
}

// ---- form -------------------------------------------------------------------------

function AutomationForm({ initial, onSaved }: { initial: Automation | null; onSaved: () => void }) {
  const projectOrder = useStore((s) => s.projectOrder)
  const projects = useStore((s) => s.projects)
  const providers = useStore((s) => s.providers)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const defaultModels = useStore((s) => s.settings.defaultModels)

  const firstAvailable = providers.find((p) => p.available)?.id ?? providers[0]?.id ?? ''
  const startProvider = providers.find((p) => p.id === (initial?.provider ?? firstAvailable))

  const [name, setName] = useState(initial?.name ?? '')
  const [projectId, setProjectId] = useState(initial?.projectId ?? activeProjectId ?? projectOrder[0] ?? '')
  const [providerId, setProviderId] = useState(startProvider?.id ?? '')
  // A new automation defaults to today's weekday, which is the common case: "every Thursday" set on a Thursday.
  const [days, setDays] = useState<number[]>(initial?.days ?? [new Date().getDay()])
  const [time, setTime] = useState(initial?.time ?? '09:00')
  const [model, setModel] = useState(
    initial?.model ?? defaultModelFor(defaultModels, startProvider?.id ?? '', startProvider?.capabilities.models ?? []),
  )
  const [mode, setMode] = useState(initial?.permissionMode ?? startProvider?.capabilities.permissionModes[0]?.id ?? '')
  const [task, setTask] = useState(initial?.task ?? '')
  const [error, setError] = useState<string | null>(null)

  const provider = providers.find((p) => p.id === providerId)
  const models = provider?.capabilities.models ?? []
  const modes = provider?.capabilities.permissionModes ?? []

  // A model or mode from one provider means nothing to another, so switching provider resets both.
  const chooseProvider = (id: string) => {
    const next = providers.find((p) => p.id === id)
    setProviderId(id)
    setModel(defaultModelFor(defaultModels, id, next?.capabilities.models ?? []))
    setMode(next?.capabilities.permissionModes[0]?.id ?? '')
  }

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = draftProblem({ name, projectId, provider: providerId, days, time, task })
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    const ok = await saveAutomation({
      id: initial?.id ?? '',
      name: name.trim(),
      projectId,
      enabled: initial?.enabled ?? true,
      days: [...days].sort((a, b) => a - b),
      time,
      provider: providerId,
      model: model.trim(),
      permissionMode: mode,
      task: task.trim(),
      // The backend sets these. They are placeholders in the request.
      createdAt: 0,
      lastRunAt: 0,
      lastError: '',
      nextRunAt: 0,
    })
    if (ok) onSaved()
  }

  return (
    <form id="automation-form" onSubmit={(e) => void submit(e)} className="space-y-3.5">
      <Field label="Name" htmlFor="automation-name">
        <Input
          id="automation-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly review"
          maxLength={MAX_AUTOMATION_NAME}
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="Project" htmlFor="automation-project">
          {projectOrder.length === 0 ? (
            <p className="text-caption text-faint">Create a project first. An automation always runs inside one.</p>
          ) : (
            <Select id="automation-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projectOrder.map((id) => (
                <option key={id} value={id}>
                  {projects[id]?.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Provider" htmlFor="automation-provider">
          <Select id="automation-provider" value={providerId} onChange={(e) => chooseProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.available ? p.name : `${p.name} (not installed)`}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Days">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days of the week">
          {DAY_SHORT.map((short, d) => {
            const on = days.includes(d)
            return (
              <button
                key={short}
                type="button"
                aria-pressed={on}
                aria-label={DAY_LONG[d]}
                title={DAY_LONG[d]}
                onClick={() => toggleDay(d)}
                className={`h-8 w-9 rounded-md border text-caption font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-white/[0.08] ${
                  on ? 'border-white/25 bg-white/[0.09] text-ink' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {short.slice(0, 2)}
              </button>
            )
          })}
          <span className="ml-1.5 flex items-center gap-0.5">
            <button type="button" onClick={() => setDays(WEEKDAYS)} className="rounded px-1.5 py-1 text-label text-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-white/[0.08]">
              Weekdays
            </button>
            <button type="button" onClick={() => setDays(EVERY_DAY)} className="rounded px-1.5 py-1 text-label text-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-white/[0.08]">
              Every day
            </button>
          </span>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="Time" htmlFor="automation-time">
          <Input id="automation-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="tabular-nums" />
        </Field>
        <Field label="Model">
          {models.length === 0 ? (
            <Input id="automation-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Provider default" aria-label="Model" />
          ) : (
            <ModelPicker
              id="automation-model"
              value={model}
              onChange={setModel}
              models={models}
              provider={providerId}
              defaultLabel="Provider default"
              disabled={false}
              aria-label="Model"
            />
          )}
        </Field>
      </div>

      <Field label="Permissions" htmlFor="automation-mode">
        {modes.length > 0 ? (
          <Select id="automation-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-caption text-faint">{provider?.name ?? 'The provider'} sets its own permissions.</p>
        )}
        {/* Nobody is watching a scheduled run, so the warnings matter more here than in the launch dialog. */}
        <p className={`flex items-start gap-1.5 text-label leading-relaxed ${RISKY_MODES.has(mode) ? 'text-warn-soft' : 'text-faint'}`}>
          {RISKY_MODES.has(mode) && <IconAlert size={11} className="mt-0.5 shrink-0" />}
          {RISKY_MODES.has(mode)
            ? 'This mode lets the agent act without asking. It runs unattended, so use it only for work you trust.'
            : 'The run has no one to approve steps, so choose a mode that does not wait for approval.'}
        </p>
      </Field>

      <Field label="Task" htmlFor="automation-task">
        <Textarea
          id="automation-task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder="Summarise yesterday’s commits and list anything left open."
        />
      </Field>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-caption text-danger-soft">
          <IconAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </form>
  )
}
