/** Human names for thinking effort levels. Pure, so the launch dialog and the chat agree. */

const EFFORT_NAMES: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
  thinking: 'Thinking',
}

/** Unknown levels are shown as the CLI gives them. */
export function effortName(level: string): string {
  return EFFORT_NAMES[level] ?? level
}

/**
 * The drifting-border tone for a thinking control. Ultra (Codex) is purple; Claude's max is rainbow.
 * Every other level, and max on another provider, gets no tone. Shared by the launch dialog and the chat.
 */
export function effortTone(level: string, provider: string): string {
  if (level === 'ultra') return 'effort-ultra'
  if (level === 'max' && provider === 'claude') return 'effort-rainbow'
  return ''
}
