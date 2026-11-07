import { describe, expect, it } from 'vitest'
import { draftProblem, formatClock, nextRunLabel, scheduleLabel, type AutomationDraft } from '../automation'

const ready: AutomationDraft = {
  name: 'Weekly review',
  projectId: 'p1',
  provider: 'claude',
  days: [4],
  time: '15:00',
  task: 'Review the open pull requests.',
}

describe('formatClock', () => {
  it('reads 24-hour times as 12-hour times', () => {
    expect(formatClock('15:00')).toBe('3:00 PM')
    expect(formatClock('09:05')).toBe('9:05 AM')
    expect(formatClock('00:30')).toBe('12:30 AM')
    expect(formatClock('12:00')).toBe('12:00 PM')
  })

  it('returns anything that is not a valid time unchanged', () => {
    expect(formatClock('3pm')).toBe('3pm')
    expect(formatClock('25:00')).toBe('25:00')
  })
})

describe('scheduleLabel', () => {
  it('names a single weekday', () => {
    expect(scheduleLabel([4], '15:00')).toBe('Every Thursday at 3:00 PM')
  })

  it('names the common sets', () => {
    expect(scheduleLabel([1, 2, 3, 4, 5], '09:00')).toBe('Weekdays at 9:00 AM')
    expect(scheduleLabel([0, 1, 2, 3, 4, 5, 6], '09:00')).toBe('Every day at 9:00 AM')
  })

  it('lists other sets in week order, whatever order they were chosen in', () => {
    expect(scheduleLabel([5, 1, 3], '08:30')).toBe('Mon, Wed, Fri at 8:30 AM')
  })

  it('says so when no day is chosen', () => {
    expect(scheduleLabel([], '08:30')).toBe('No days chosen')
  })
})

describe('nextRunLabel', () => {
  it('says today when the run is on the same day', () => {
    const now = new Date(2026, 10, 12, 9, 0)
    const at = new Date(2026, 10, 12, 15, 0).getTime()
    expect(nextRunLabel(at, now)).toMatch(/^today at /)
  })

  it('names the day for a later run', () => {
    const now = new Date(2026, 10, 12, 9, 0)
    const at = new Date(2026, 10, 19, 15, 0).getTime()
    expect(nextRunLabel(at, now)).not.toMatch(/^today/)
  })
})

describe('draftProblem', () => {
  it('accepts a complete draft', () => {
    expect(draftProblem(ready)).toBeNull()
  })

  it('reports the first missing field', () => {
    expect(draftProblem({ ...ready, name: '   ' })).toBe('Give the automation a name.')
    expect(draftProblem({ ...ready, projectId: '' })).toBe('Choose a project.')
    expect(draftProblem({ ...ready, provider: '' })).toBe('Choose a provider.')
    expect(draftProblem({ ...ready, days: [] })).toBe('Choose at least one day.')
    expect(draftProblem({ ...ready, time: '3pm' })).toBe('Choose a time of day.')
    expect(draftProblem({ ...ready, task: ' ' })).toBe('Write the task the agent should do.')
  })

  it('limits the name length in characters, not bytes', () => {
    expect(draftProblem({ ...ready, name: 'é'.repeat(60) })).toBeNull()
    expect(draftProblem({ ...ready, name: 'x'.repeat(61) })).toMatch(/60 characters/)
  })
})
