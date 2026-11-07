// Render smoke tests for the Files and Git sidebar views. Effects do not run during static rendering, so
// these check the first paint: that each view mounts with store state, shows its search or loading
// state, and never throws. Behaviour is covered by the pure tests in lib/__tests__/sourceView.test.ts.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilesView } from './FilesView'
import { GitView } from '../git/GitView'
import { setState } from '../../lib/store'
import type { ProjectSummary } from '../../types'

const project = {
  id: 'p1',
  name: 'Orbit',
  repoPath: 'C:\\work\\orbit',
  autoCommit: false,
  conflicts: [],
  agentCount: 0,
  runningCount: 0,
} as unknown as ProjectSummary

describe('sidebar views', () => {
  it('Files view mounts with a search field and a loading state', () => {
    setState({ projects: { p1: project }, projectOrder: ['p1'], agents: {}, agentOrder: [] })
    const html = renderToStaticMarkup(<FilesView projectId="p1" />)
    expect(html).toContain('aria-label="Search files"')
    expect(html).toContain('Reading the folder')
    expect(html).toContain('aria-label="New file"')
    expect(html).toContain('aria-label="New folder"')
  })

  it('Git view mounts and shows it is reading the repository', () => {
    setState({ projects: { p1: project }, projectOrder: ['p1'] })
    const html = renderToStaticMarkup(<GitView projectId="p1" />)
    expect(html).toContain('Reading the repository')
  })

  it('Files view explains when no project is selected', () => {
    setState({ projects: {}, projectOrder: [] })
    const html = renderToStaticMarkup(<FilesView projectId="missing" />)
    expect(html).toContain('No project selected')
  })
})
