// Pure helpers for automations: how a schedule reads, and whether a form is ready to save.
// The backend checks the same rules again, so these only make the form's feedback immediate.

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

/** The longest name an automation may have. Matches maxAutomationName on the backend. */
export const MAX_AUTOMATION_NAME = 60

/** "15:00" becomes "3:00 PM". Anything that is not a valid time comes back unchanged. */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  const h = Number(m[1])
  const min = m[2]
  if (h > 23 || Number(min) > 59) return hhmm
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i])
}

/** A readable schedule: "Every Thursday at 3:00 PM", "Weekdays at 9:00 AM", "Mon, Wed at 9:00 AM". */
export function scheduleLabel(days: number[], time: string): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 0) return 'No days chosen'
  let when: string
  if (sameDays(sorted, WEEKDAYS)) when = 'Weekdays'
  else if (sameDays(sorted, EVERY_DAY)) when = 'Every day'
  else if (sorted.length === 1) when = `Every ${DAY_LONG[sorted[0]]}`
  else when = sorted.map((d) => DAY_SHORT[d]).join(', ')
  return `${when} at ${formatClock(time)}`
}

/** When the next run happens, relative to now: "today at 3:00 PM", or "Thu, 12 Nov at 3:00 PM". */
export function nextRunLabel(ms: number, now: Date = new Date()): string {
  const at = new Date(ms)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return `today at ${time}`
  const day = at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} at ${time}`
}

export interface AutomationDraft {
  name: string
  projectId: string
  provider: string
  days: number[]
  time: string
  task: string
}

/** The first thing wrong with a draft, in words the form can show. Null when it is ready to save. */
export function draftProblem(d: AutomationDraft): string | null {
  const name = d.name.trim()
  if (!name) return 'Give the automation a name.'
  if ([...name].length > MAX_AUTOMATION_NAME) return `The name must be ${MAX_AUTOMATION_NAME} characters or fewer.`
  if (!d.projectId) return 'Choose a project.'
  if (!d.provider) return 'Choose a provider.'
  if (d.days.length === 0) return 'Choose at least one day.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return 'Choose a time of day.'
  if (!d.task.trim()) return 'Write the task the agent should do.'
  return null
}
