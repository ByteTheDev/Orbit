import { Fragment, type KeyboardEvent, type MouseEvent } from 'react'
import { openDialog, selectAgent } from '../../lib/store'
import { IconChevronDown, IconPlus } from '../ui'
import { AgentItem, StatusGlyph } from './AgentItem'
import type { NavProject } from './projectFilter'
import { ProjectMark } from './ProjectMark'
import { projectStatus, projectSummary, type SummaryPart } from './projectSummary'
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
  onAgentContextMenu: (agentId: string, x: number, y: number) => void
}

/**
 * One project in the navigator. The name and a summary line (conflicts, running, agent count)
 * sit on the left. One status glyph shows the most urgent agent state. A single actions button
 * opens the project menu, so every action is reachable by mouse, keyboard, and right-click alike.
 * The active project is marked by a soft fill and a heavier name, never by a bright border.
 */
export function ProjectItem({ nav, active, expanded, selectedAgentId, onToggle, onSelect, onFocusAgent, onContextMenu, onAgentContextMenu }: Props) {
  const { project, agents, allAgents, filtering } = nav
  const panelId = `project-agents-${project.id}`
  const status = projectStatus(allAgents)
  // Counts come from the agents this row lists, so "2 of 5 agents" matches the rows beneath it.
  const summary = projectSummary(project, allAgents, agents.length)
  const running = allAgents.some((a) => a.running)

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

  const openMenuFromButton = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onContextMenu(r.right, r.bottom)
  }

  return (
    <li className="animate-rise-in">
      <div
        onKeyDown={onKey}
        onContextMenu={menu}
        className={`group relative flex items-center rounded-lg pr-1 transition-colors duration-150 ${
          active ? 'bg-row-active' : 'hover:bg-row-hover'
        }`}
      >
        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-ink" aria-hidden="true" />}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          disabled={filtering}
          className={`ml-0.5 flex h-9 w-5 shrink-0 items-center justify-center rounded transition-colors duration-150 hover:text-ink disabled:opacity-30 ${
            active ? 'text-muted' : 'text-faint'
          }`}
        >
          <IconChevronDown size={10} className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
        </button>

        <button
          type="button"
          data-nav-item
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          title={project.repoPath}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-0.5 pr-1 text-left"
        >
          <ProjectMark project={project} size={28} />
          <span className="min-w-0 flex-1">
            <span
              title={project.name}
              className={`block truncate text-body leading-tight ${active ? 'font-semibold text-ink' : 'font-medium text-ink/90'}`}
            >
              {project.name}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center text-label leading-tight">
              <SummaryLine parts={summary} />
            </span>
          </span>
        </button>

        {status && <StatusGlyph status={status} running={running} />}

        <Tooltip label="Project actions">
          <button
            type="button"
            onClick={openMenuFromButton}
            aria-label={`Actions for ${project.name}`}
            aria-haspopup="menu"
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-row-active hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <IconDots />
          </button>
        </Tooltip>
      </div>

      {expanded && (
        <ul id={panelId} role="list" className="relative mb-2 ml-[19px] mt-0.5 space-y-px border-l border-line pl-2">
          {agents.map((a) => (
            <AgentItem
              key={a.id}
              agent={a}
              selected={a.id === selectedAgentId}
              onSelect={() => {
                selectAgent(a.id, { openInspector: true })
                onFocusAgent(a.id)
              }}
              onOpenMenu={(x, y) => onAgentContextMenu(a.id, x, y)}
            />
          ))}
          {agents.length === 0 && !filtering && <li className="px-2 py-1.5 text-label text-faint">No agents yet</li>}
          {!filtering && (
            <li>
              <button
                type="button"
                data-nav-item
                onClick={() => openDialog({ kind: 'launch', projectId: project.id })}
                className="group/launch flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption text-faint transition-colors duration-150 hover:bg-row-hover hover:text-muted"
              >
                <IconPlus size={10} />
                Launch agent
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** The summary line, parts separated by a middle dot. Conflicts take warning colour; running work takes the live colour. */
function SummaryLine({ parts }: { parts: SummaryPart[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-faint/60" aria-hidden="true">·</span>}
          <span
            className={
              p.tone === 'warn' ? 'text-warn-soft' : p.tone === 'live' ? 'text-status-thinking' : 'text-faint'
            }
          >
            {p.text}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

function IconDots() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}
