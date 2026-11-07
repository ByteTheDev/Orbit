import type { KeyboardEvent } from 'react'
import { STATUS_COLOR } from '../../lib/theme'
import type { AgentSummary, ProjectSummary } from '../../types'
import { projectStatus, projectSummary } from './projectSummary'
import { ProjectMark } from './ProjectMark'
import { Tooltip } from './Tooltip'

export interface RailProject {
  project: ProjectSummary
  agents: AgentSummary[]
}

interface Props {
  rows: RailProject[]
  activeId: string | null
  onSelect: (projectId: string) => void
  onExpand: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * The collapsed sidebar: a column of project marks. Each mark carries the most urgent status of
 * its agents as a dot, and a tooltip with the project's name and summary. The active project is
 * ringed. The expand control at the top restores the full navigator.
 */
export function ProjectRail({ rows, activeId, onSelect, onExpand, onKeyDown }: Props) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto py-3" aria-label="Project list" onKeyDown={onKeyDown}>
      <Tooltip label="Expand sidebar" align="center">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand sidebar"
          className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
        >
          <RailIcon />
        </button>
      </Tooltip>
      <span className="mb-1 h-px w-6 bg-white/[0.07]" aria-hidden="true" />

      <ul role="list" className="flex flex-col items-center gap-1.5">
        {rows.map(({ project, agents }) => {
          const status = projectStatus(agents)
          const active = project.id === activeId
          const running = agents.some((a) => a.running)
          const summary = projectSummary(project, agents).map((p) => p.text).join(' · ')
          return (
            <li key={project.id}>
              <Tooltip label={`${project.name} · ${summary}`}>
                <button
                  type="button"
                  data-nav-item
                  onClick={() => onSelect(project.id)}
                  aria-label={`${project.name}, ${summary}`}
                  aria-current={active ? 'true' : undefined}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-[background-color,box-shadow] duration-150 ${
                    active ? 'bg-white/[0.085] ring-1 ring-inset ring-white/[0.14]' : 'hover:bg-white/[0.05]'
                  }`}
                >
                  <ProjectMark project={project} size={24} />
                  {status && (
                    <span
                      aria-hidden="true"
                      className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-sidebar ${running ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                      style={{ background: STATUS_COLOR[status] }}
                    />
                  )}
                </button>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function RailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
      <path d="m13.5 10 2 2-2 2" />
    </svg>
  )
}
