import type { KeyboardEvent, MouseEvent } from 'react'
import { openDialog, selectAgent } from '../../lib/store'
import { plural } from '../../lib/format'
import { STATUS_COLOR } from '../../lib/theme'
import type { AgentSummary } from '../../types'
import { IconAlert, IconChevronDown, IconPencil, IconPlus, IconX, ProviderMark } from '../ui'
import type { NavProject } from './projectFilter'
import { ProjectMark } from './ProjectMark'
import { Tooltip } from './Tooltip'

interface Props {
  nav: NavProject
  active: boolean
  expanded: boolean
  selectedAgentId: string | null
  onToggle: () => void
  onSelect: () => void
  onFocusAgent: (agentId: string) => void
  onContextMenu: (x: number, y: number) => void
}

/**
 * One project in the navigator: a row that selects it, a chevron that expands it, and,
 * when expanded, its agents. Selection is a quiet background change, not a border.
 */
export function ProjectItem({ nav, active, expanded, selectedAgentId, onToggle, onSelect, onFocusAgent, onContextMenu }: Props) {
  const { project, agents, filtering } = nav
  const panelId = `project-agents-${project.id}`
  const conflicts = project.conflicts.length
  const runningLabel = project.runningCount > 0 ? `${project.runningCount} running` : null

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' && !expanded) {
      e.preventDefault()
      onToggle()
    } else if (e.key === 'ArrowLeft' && expanded) {
      e.preventDefault()
      onToggle()
    }
  }

  const menu = (e: MouseEvent) => {
    e.preventDefault()
    onContextMenu(e.clientX, e.clientY)
  }

  return (
    <li>
      <div
        onKeyDown={onKey}
        onContextMenu={menu}
        className={`group relative flex items-center rounded-lg pr-1 transition-colors duration-150 ${
          active ? 'bg-white/[0.075]' : 'hover:bg-white/[0.04]'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          disabled={filtering}
          className="ml-0.5 flex h-8 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-150 hover:text-ink disabled:opacity-30"
        >
          <IconChevronDown size={11} className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
        </button>

        <button
          type="button"
          data-nav-item
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-0.5 pr-1 text-left"
        >
          <ProjectMark project={project} size={28} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[13px] leading-tight ${active ? 'font-semibold text-ink' : 'font-medium text-ink/90'}`}>{project.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[10.5px] leading-tight text-faint" title={project.repoPath}>
              {pathTail(project.repoPath)}
            </span>
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-2 pr-1.5 text-[11px] tabular-nums group-hover:hidden group-focus-within:hidden">
          {conflicts > 0 && (
            <span className="inline-flex items-center gap-1 text-warn-soft" title={`${plural(conflicts, 'conflict')}`}>
              <IconAlert size={11} />
              {conflicts}
            </span>
          )}
          {runningLabel ? (
            <span className="inline-flex items-center gap-1.5 text-status-thinking" title={runningLabel}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-thinking motion-reduce:animate-none" aria-hidden="true" />
              {project.runningCount}
            </span>
          ) : (
            <span className="text-faint" title={plural(project.agentCount, 'agent')}>
              {project.agentCount}
            </span>
          )}
        </span>

        <span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
          <Tooltip label="Change icon">
            <button
              type="button"
              onClick={() => openDialog({ kind: 'projectIcon', projectId: project.id })}
              aria-label={`Change icon for ${project.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-white/[0.07] hover:text-ink"
            >
              <IconPencil size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Remove project">
            <button
              type="button"
              onClick={() => openDialog({ kind: 'deleteProject', projectId: project.id })}
              aria-label={`Remove project ${project.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-danger/10 hover:text-danger-soft"
            >
              <IconX size={12} />
            </button>
          </Tooltip>
        </span>
      </div>

      {expanded && (
        <ul id={panelId} role="list" className="relative mb-1.5 ml-[18px] mt-0.5 space-y-px border-l border-white/[0.07] pl-2">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} selected={a.id === selectedAgentId} onFocus={() => onFocusAgent(a.id)} />
          ))}
          {agents.length === 0 && !filtering && <li className="px-2 py-1.5 text-[11.5px] text-faint">No agents yet</li>}
          {!filtering && (
            <li>
              <button
                type="button"
                data-nav-item
                onClick={() => openDialog({ kind: 'launch', projectId: project.id })}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-faint transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink"
              >
                <IconPlus size={11} />
                Launch agent here
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function AgentRow({ agent, selected, onFocus }: { agent: AgentSummary; selected: boolean; onFocus: () => void }) {
  const color = STATUS_COLOR[agent.status]
  return (
    <li>
      <button
        type="button"
        data-nav-item
        onClick={() => {
          selectAgent(agent.id, { openInspector: true })
          onFocus()
        }}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.05] ${selected ? 'bg-white/[0.08]' : ''}`}
      >
        <ProviderMark provider={agent.provider} size={16} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium leading-tight text-ink">{agent.name}</span>
          <span className="block truncate text-[10.5px] leading-snug" style={{ color }}>
            {agent.statusDetail || agent.status}
          </span>
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${agent.running ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ background: color }} aria-hidden="true" />
      </button>
    </li>
  )
}

/** The last two folders of a repository path, e.g. `Desktop\SuperStar`. Handles both separators. */
export function pathTail(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('\\')
}

