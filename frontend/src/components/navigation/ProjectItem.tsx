import { Fragment, type KeyboardEvent, type MouseEvent } from 'react'
import { openDialog, selectAgent } from '../../lib/store'
import { IconChevronDown } from '../ui'
import { AgentItem, StatusGlyph } from './AgentItem'
import type { NavProject } from './projectFilter'
import { ProjectMark } from './ProjectMark'
import { projectStatus, projectSummary, type SummaryPart } from './projectSummary'
import { MaterialIcon } from '../ui'
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
 * One project in the navigator: a chevron, the project mark, the name, and an optional summary line.
 * One status glyph shows the most urgent agent state. The actions button and right-click open the
 * project menu, so every action is reachable by mouse, keyboard, and right-click alike, and the
 * button only shows on hover or focus. The active project is marked by a faint fill and a heavier name.
 * A project with no agents shows one line in its list: the launch action. Nothing else.
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
        className={`group relative flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active ? 'bg-nav-active' : 'hover:bg-nav-hover'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          disabled={filtering}
          className={`nav-item ml-0.5 flex h-7 w-4 shrink-0 items-center justify-center transition-colors duration-150 hover:text-ink disabled:opacity-30 ${
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
          className="nav-item flex min-w-0 flex-1 items-center gap-2 py-1 pl-0.5 pr-1 text-left"
        >
          <ProjectMark project={project} size={24} fallback="dot" />
          <span className="min-w-0 flex-1">
            <span
              title={project.name}
              className={`block truncate text-body leading-tight ${active ? 'font-semibold text-ink' : 'font-medium text-ink'}`}
            >
              {project.name}
            </span>
            {summary.length > 0 && (
              <span className="mt-px flex min-w-0 items-center text-label leading-tight">
                <SummaryLine parts={summary} />
              </span>
            )}
          </span>
        </button>

        {status && <StatusGlyph status={status} running={running} />}

        <Tooltip label="Project actions">
          <button
            type="button"
            onClick={openMenuFromButton}
            aria-label={`Actions for ${project.name}`}
            aria-haspopup="menu"
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-nav-active hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <IconDots />
          </button>
        </Tooltip>
      </div>

      {expanded && (
        // The tree line sits under the project mark's centre; agent marks start just inside it.
        <ul id={panelId} role="list" className="ml-[21px] mt-px space-y-px border-l border-line pb-1 pl-[5px]">
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
          {!filtering && agents.length === 0 && (
            // The one empty state: a single launch action, no extra label.
            <li>
              <button
                type="button"
                data-nav-item
                onClick={() => openDialog({ kind: 'launch', projectId: project.id })}
                className="nav-item flex items-center gap-1.5 py-1 pl-1.5 pr-2 text-caption text-muted transition-colors duration-150 hover:text-ink"
              >
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
          {i > 0 && <span className="text-faint" aria-hidden="true">·</span>}
          <span
            className={
              p.tone === 'warn' ? 'text-warn-soft' : p.tone === 'live' ? 'text-status-thinking' : 'text-muted'
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
  return <MaterialIcon name="more_horiz" size={12} />
}
