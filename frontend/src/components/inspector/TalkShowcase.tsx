// The showcase at the top of an agent's chat: the talk it is in with other agents, drawn as their
// marks joined by a live connector, with the transcript beneath. Also the way to bring another agent in.
import { useMemo, useState, type KeyboardEvent } from 'react'
import type { AgentSummary, Conversation, ConversationLine } from '../../types'
import { stopTalk, summonAgent } from '../../lib/actions'
import { partnersOf, talkFor, talkStatus } from '../../lib/talk'
import { useStore } from '../../lib/store'
import { Button, Input, MaterialIcon, ProviderMark, Select } from '../ui'

/** How many transcript lines show before the rest are behind "Show earlier". */
const SHOWN_LINES = 6

export function TalkShowcase({ agent }: { agent: AgentSummary }) {
  const conversations = useStore((s) => s.projects[agent.projectId]?.conversations)
  const agentOrder = useStore((s) => s.agentOrder)
  const agents = useStore((s) => s.agents)
  const talk = useMemo(() => talkFor(conversations ?? [], agent.id), [conversations, agent.id])
  // Everyone else in the talk, in speaking order. Members who have since been removed are left out.
  const partners = talk
    ? partnersOf(talk, agent.id)
        .map((id) => agents[id])
        .filter((a): a is AgentSummary => !!a)
    : []
  const [summoning, setSummoning] = useState(false)

  // Other agents in this project, for the summon picker.
  const others = useMemo(
    () => agentOrder.map((id) => agents[id]).filter((a): a is AgentSummary => !!a && a.projectId === agent.projectId && a.id !== agent.id),
    [agentOrder, agents, agent.projectId, agent.id],
  )

  if (!talk && others.length === 0) return null

  const active = talk?.status === 'active'
  const partnerNames = partners.map((p) => p.name).join(', ') || 'Partner'

  return (
    <section aria-label="Work with other agents" className="border-b border-line px-4 py-3">
      {talk && <TalkHeader agent={agent} partners={partners} talk={talk} partnerNames={partnerNames} />}

      {talk && talk.lines.length > 0 && <Transcript talk={talk} agent={agent} partnerNames={partnerNames} />}

      {!summoning && others.length > 0 && (
        <div className={`flex items-center justify-between gap-3 ${talk ? 'mt-3' : ''}`}>
          <p className="text-caption text-faint">
            {active ? 'Other agents are on this talk.' : talk ? 'Bring someone else into the work.' : 'Work with another agent on a task.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setSummoning(true)} disabled={active} title={active ? 'Stop the current talk first' : undefined}>
            <MaterialIcon name="group_add" size={14} />
            Bring in an agent
          </Button>
        </div>
      )}

      {summoning && <SummonForm agent={agent} others={others} onDone={() => setSummoning(false)} />}
    </section>
  )
}

function TalkHeader({
  agent,
  partners,
  talk,
  partnerNames,
}: {
  agent: AgentSummary
  partners: AgentSummary[]
  talk: Conversation
  partnerNames: string
}) {
  const active = talk.status === 'active'
  // Everyone in speaking order, so the connector reads left to right as the turn goes round.
  const ring = talk.members
    .map((id) => (id === agent.id ? agent : partners.find((p) => p.id === id)))
    .filter((a): a is AgentSummary => !!a)

  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 shrink-0 items-center" aria-hidden="true">
        {ring.map((member, i) => (
          <span key={member.id} className="flex items-center">
            {i > 0 && <Link active={active} />}
            <Node provider={member.provider} speaking={active && talk.nextId === member.id} />
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-medium text-ink">
          {agent.name} <span className="text-faint">with</span> {partnerNames}
        </p>
        <p className={`truncate text-label ${active ? 'text-ink/80' : 'text-faint'}`}>
          {active && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-status-thinking align-middle" aria-hidden="true" />}
          {talkStatus(talk)}
        </p>
      </div>

      {active && (
        <Button variant="ghost" size="sm" onClick={() => void stopTalk(talk.id)} aria-label="Stop the talk" title="Stop the talk">
          <MaterialIcon name="stop_circle" size={14} />
          Stop
        </Button>
      )}
    </div>
  )
}

/** The line between two marks: a faint rule, with a spark running along it while the talk is live. */
function Link({ active }: { active: boolean }) {
  return (
    <span className="relative mx-1.5 h-[22px] w-[28px] shrink-0">
      <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
      {active && <span className="partner-spark absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-tint shadow-[0_0_8px_2px_rgba(255,255,255,0.5)]" />}
    </span>
  )
}

/** One agent's mark, ringed while it is the one speaking. */
function Node({ provider, speaking }: { provider: string; speaking: boolean }) {
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      {speaking && <span className="absolute inset-0 animate-ping rounded-full border border-tint/50" />}
      <span className={`flex h-7 w-7 items-center justify-center rounded-full border bg-surface transition-colors duration-300 ${speaking ? 'border-tint/60' : 'border-line'}`}>
        <ProviderMark provider={provider} size={16} />
      </span>
    </span>
  )
}

function Transcript({ talk, agent, partnerNames }: { talk: Conversation; agent: AgentSummary; partnerNames: string }) {
  const [showAll, setShowAll] = useState(false)
  const hidden = Math.max(0, talk.lines.length - SHOWN_LINES)
  const lines = showAll ? talk.lines : talk.lines.slice(hidden)

  return (
    <div className="mt-3">
      {hidden > 0 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="mb-2 text-label text-faint underline-offset-2 hover:text-ink hover:underline">
          Show {hidden} earlier {hidden === 1 ? 'message' : 'messages'}
        </button>
      )}
      <ol role="log" aria-label={`Talk between ${agent.name} and ${partnerNames}`} className="max-h-[200px] space-y-2 overflow-y-auto pr-1">
        {lines.map((line, i) => (
          <Bubble key={`${line.at}-${i}`} line={line} self={line.agentId === agent.id} fromUser={line.agentId === ''} />
        ))}
      </ol>
    </div>
  )
}

function Bubble({ line, self, fromUser }: { line: ConversationLine; self: boolean; fromUser: boolean }) {
  if (fromUser) {
    return (
      <li className="flex justify-center">
        <p className="max-w-[90%] rounded-md border border-line px-2.5 py-1.5 text-center text-caption italic text-muted">
          <span className="not-italic text-faint">Task · </span>
          {line.text}
        </p>
      </li>
    )
  }
  const tone = line.provider === 'claude' ? 'text-claude' : 'text-codex'
  return (
    <li className={`flex ${self ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] rounded-lg border px-2.5 py-1.5 ${self ? 'border-line bg-surface' : 'border-line bg-tint/[0.03]'}`}>
        <p className={`text-label font-semibold ${tone}`}>{line.name}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-caption leading-relaxed text-ink/90">{line.text}</p>
      </div>
    </li>
  )
}

function SummonForm({ agent, others, onDone }: { agent: AgentSummary; others: AgentSummary[]; onDone: () => void }) {
  const [otherId, setOtherId] = useState(others[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const canStart = !busy && !!otherId && task.trim() !== ''

  const start = async () => {
    if (!canStart) return
    setBusy(true)
    const ok = await summonAgent(agent.id, otherId, task)
    setBusy(false)
    if (ok) onDone()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-line p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
        <Select aria-label="Agent to bring in" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKey}
          placeholder="The shared task, e.g. split the parser into two modules"
          maxLength={400}
          aria-label="Shared task"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void start()} disabled={!canStart}>
          {busy ? 'Starting…' : 'Start talk'}
        </Button>
      </div>
    </div>
  )
}
