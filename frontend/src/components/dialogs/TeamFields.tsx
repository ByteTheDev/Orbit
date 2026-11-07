// The agent fields of the launch dialog: one model and thinking choice for a solo agent, and one card per
// agent once a team is on. Every agent in a team chooses its own model and thinking level, because each
// provider offers its own models.
import { useState, type ReactNode } from 'react'
import type { ModelOption } from '../../types'
import { effortName, effortTone } from '../../lib/effort'
import { Field, IconCpu, IconX, Input, MaterialIcon, ModelPicker, ProviderMark, Select } from '../ui'

function IconBrain({ size = 13 }: { size?: number }) {
  return <MaterialIcon name="speed" size={size} />
}

/** One agent's model and thinking choice. */
export function ModelFields({
  idPrefix,
  providerId,
  models,
  model,
  onModel,
  effort,
  onEffort,
}: {
  idPrefix: string
  providerId: string
  models: ModelOption[]
  model: string
  onModel: (id: string) => void
  effort: string
  onEffort: (level: string) => void
}) {
  const selected = models.find((m) => m.id === model)
  const levels = selected?.effort ?? []
  const effortOn = levels.includes(effort) ? effort : ''
  const modelNote = selected?.description ?? (models.length ? 'Empty uses the provider default.' : 'The provider picks its own model.')
  const effortNote = `How hard the model thinks before it answers. ${selected?.defaultEffort ? `Default is ${effortName(selected.defaultEffort).toLowerCase()}.` : 'Default is the CLI setting.'}`

  return (
    <div className={`grid gap-2.5 ${levels.length > 0 ? 'sm:grid-cols-2' : ''}`}>
      <Field label="Model" htmlFor={`${idPrefix}-model`} icon={<IconCpu size={13} />}>
        <div title={modelNote || undefined}>
          {models.length === 0 ? (
            <Input id={`${idPrefix}-model`} value={model} onChange={(e) => onModel(e.target.value)} placeholder="Provider default" aria-label="Model" />
          ) : (
            <ModelPicker id={`${idPrefix}-model`} value={model} onChange={onModel} models={models} provider={providerId} defaultLabel="Provider default" aria-label="Model" />
          )}
        </div>
      </Field>
      {levels.length > 0 && (
        <Field label="Thinking" htmlFor={`${idPrefix}-effort`} icon={<IconBrain size={13} />}>
          <div title={effortNote}>
            <Select id={`${idPrefix}-effort`} value={effortOn} onChange={(e) => onEffort(e.target.value)} className={effortTone(effortOn, providerId)}>
              <option value="">{selected?.defaultEffort ? `Default (${effortName(selected.defaultEffort).toLowerCase()})` : 'Default'}</option>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {effortName(level)}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      )}
    </div>
  )
}

/** A bordered card for one agent in the team: its mark and name, an optional remove, and its fields. */
function AgentCard({
  providerId,
  name,
  role,
  onRemove,
  children,
}: {
  providerId: string
  name: string
  role: string
  onRemove?: () => void
  children: ReactNode
}) {
  return (
    <section aria-label={`${name}, ${role}`} className="space-y-2.5 rounded-md border border-line p-2.5">
      <header className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
          <ProviderMark provider={providerId} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-ink">{name}</span>
        <span className="text-label text-faint">{role}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            title={`Remove ${name} from the team`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint outline-none transition-colors hover:bg-tint/[0.06] hover:text-ink focus-visible:ring-[3px] focus-visible:ring-tint/[0.08]"
          >
            <IconX size={11} />
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

export interface TeamMember {
  providerId: string
  name: string
  models: ModelOption[]
  model: string
  effort: string
}

/**
 * The cards for a team: the first agent, then each agent added, then the control that adds another.
 * The team starts with only the first agent's card and an empty "Add an agent" slot.
 */
export function TeamCards({
  first,
  onFirstModel,
  onFirstEffort,
  members,
  onMemberModel,
  onMemberEffort,
  onRemove,
  choices,
  onAdd,
}: {
  first: TeamMember
  onFirstModel: (id: string) => void
  onFirstEffort: (level: string) => void
  members: TeamMember[]
  onMemberModel: (index: number, id: string) => void
  onMemberEffort: (index: number, level: string) => void
  onRemove: (index: number) => void
  /** The providers that can still be added: installed, and not already in the team. */
  choices: { id: string; name: string }[]
  onAdd: (providerId: string) => void
}) {
  const [picking, setPicking] = useState(false)

  return (
    <div className="space-y-3">
      <AgentCard providerId={first.providerId} name={first.name} role="Opens the talk">
        <ModelFields
          idPrefix="launch"
          providerId={first.providerId}
          models={first.models}
          model={first.model}
          onModel={onFirstModel}
          effort={first.effort}
          onEffort={onFirstEffort}
        />
      </AgentCard>

      {members.map((m, i) => (
        <AgentCard key={`${m.providerId}-${i}`} providerId={m.providerId} name={m.name} role="Takes turns" onRemove={() => onRemove(i)}>
          <ModelFields
            idPrefix={`launch-agent-${i}`}
            providerId={m.providerId}
            models={m.models}
            model={m.model}
            onModel={(id) => onMemberModel(i, id)}
            effort={m.effort}
            onEffort={(level) => onMemberEffort(i, level)}
          />
        </AgentCard>
      ))}

      {choices.length === 0 ? (
        members.length === 0 && <p className="text-caption text-faint">No other agent is installed yet.</p>
      ) : picking ? (
        <div className="space-y-2 rounded-md border border-line p-2.5">
          <p className="text-caption font-medium text-muted">Choose an agent to add</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setPicking(false)
                  onAdd(c.id)
                }}
                className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left outline-none transition-colors hover:border-line-strong hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-tint/[0.08]"
              >
                <ProviderMark provider={c.id} size={16} />
                <span className="truncate text-caption font-medium text-ink">{c.name}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setPicking(false)} className="text-label text-faint hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-caption font-medium text-muted outline-none transition-colors hover:border-tint/30 hover:text-ink focus-visible:ring-[3px] focus-visible:ring-tint/[0.08]"
        >
          <span className="text-[15px] leading-none">+</span>
          {members.length === 0 ? 'Add an agent' : 'Add another agent'}
        </button>
      )}
    </div>
  )
}
