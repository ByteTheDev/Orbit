import { STATUS_COLOR, STATUS_LABEL } from '../../lib/theme'
import type { Status, AgentSummary } from '../../types'
import { IconCheck, IconX, MaterialIcon, ProviderMark } from '../ui'
import { agentBucket, statusKind } from './agentStatus'

interface Props {
  agent: AgentSummary
  selected: boolean
  onSelect: () => void
  onOpenMenu?: (x: number, y: number) => void
}

/**
 * An agent in the navigator. Line one is the name and, when there is one, the model. Line two is
 * what the agent is doing now, else what it was asked to do, else its status. Live agents carry a
 * thin sweep along the bottom edge. Attention agents get an accent bar at the left. The actions
 * button and right-click open the same menu.
 */
export function AgentItem({ agent, selected, onSelect, onOpenMenu }: Props) {
  const color = STATUS_COLOR[agent.status]
  const label = STATUS_LABEL[agent.status]
  const bucket = agentBucket(agent.status)
  const failed = statusKind(agent.status) === 'failed'
  // What the agent is doing, else what it was asked, else its status. Failures take colour in the line.
  const detail = agent.statusDetail || agent.task || label
  const tooltip = [agent.name, label, agent.statusDetail, agent.task && `Task: ${agent.task}`, `${agent.toolCalls} tool calls`]
    .filter(Boolean)
    .join('\n')

  return (
    <li className="group/agent relative animate-rise-in">
      <div
        onContextMenu={
          onOpenMenu
            ? (e) => {
                e.preventDefault()
                onOpenMenu(e.clientX, e.clientY)
              }
            : undefined
        }
        className={`relative flex items-center rounded-md transition-colors duration-150 ${
          selected ? 'bg-nav-active' : 'hover:bg-nav-hover'
        }`}
      >
        <button
          type="button"
          data-nav-item
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          title={tooltip}
          className="nav-item flex min-w-0 flex-1 items-center gap-2 py-0.5 pl-1.5 pr-1 text-left"
        >
          <ProviderMark provider={agent.provider} size={16} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className={`min-w-0 truncate text-caption leading-tight ${selected ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                {agent.name}
              </span>
              {agent.model && <span className="shrink-0 truncate text-label leading-tight text-faint/90">{shortModel(agent.model)}</span>}
            </span>
            <span
              className={`mt-px block truncate text-label leading-snug ${failed || bucket === 'attention' ? '' : 'text-muted'}`}
              style={failed || bucket === 'attention' ? { color } : undefined}
            >
              {detail}
            </span>
          </span>
          <StatusGlyph status={agent.status} running={agent.running} />
        </button>

        {onOpenMenu && (
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onOpenMenu(r.right, r.bottom)
            }}
            aria-label={`Actions for ${agent.name}`}
            aria-haspopup="menu"
            className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-nav-active hover:text-ink focus-visible:opacity-100 group-hover/agent:opacity-100 group-focus-within/agent:opacity-100"
          >
            <MaterialIcon name="more_horiz" size={11} />
          </button>
        )}

        {agent.running && <ActivitySweep color={color} />}
      </div>
    </li>
  )
}

/** A thin light that travels along the row's bottom edge while the agent is working. Motion-safe. */
export function ActivitySweep({ color }: { color: string }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-0 h-px overflow-hidden">
      <span
        className="block h-full w-1/3 animate-[activity-sweep_1.8s_linear_infinite] motion-reduce:hidden"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
    </span>
  )
}

/** "claude-opus-5-5" reads as "opus-5-5": the family and version, without the vendor prefix. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/**
 * The status mark at the end of an agent row. Shape carries the meaning, colour reinforces it:
 * a pulsing dot while live, a check when done, a cross on failure, a hollow ring at rest.
 */
export function StatusGlyph({ status, running }: { status: Status; running: boolean }) {
  const color = STATUS_COLOR[status]
  const label = STATUS_LABEL[status]
  const kind = statusKind(status)

  return (
    <span role="img" aria-label={label} className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" style={{ color }}>
      {kind === 'live' && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse motion-reduce:animate-none' : ''}`}
          style={{ background: color }}
        />
      )}
      {kind === 'done' && <IconCheck size={11} />}
      {kind === 'failed' && <IconX size={11} />}
      {kind === 'idle' && <span className="h-2 w-2 rounded-full border-[1.5px] border-current opacity-60" />}
    </span>
  )
}
