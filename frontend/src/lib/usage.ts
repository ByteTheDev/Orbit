import type { AgentSummary } from '../types'

/** Totals for one provider across every agent Orbit runs on it. */
export interface ProviderUsage {
  provider: string
  label: string
  agents: number
  running: number
  input: number
  output: number
  costUsd: number
  /** False when no agent on this provider reports cost, so the UI shows a dash instead of $0. */
  costKnown: boolean
}

/** The providers the usage strip always shows, in order, even before any agent uses them. */
export const USAGE_PROVIDERS: { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
]

function empty(provider: string, label: string): ProviderUsage {
  return { provider, label, agents: 0, running: 0, input: 0, output: 0, costUsd: 0, costKnown: false }
}

/**
 * Sums each provider's agents: tokens in and out, spend, and how many are running. Pure, so it
 * can be tested without React. Unknown providers are appended after the fixed ones.
 */
export function usageByProvider(agents: AgentSummary[]): ProviderUsage[] {
  const rows = USAGE_PROVIDERS.map((p) => empty(p.id, p.label))
  for (const a of agents) {
    let row = rows.find((r) => r.provider === a.provider)
    if (!row) {
      row = empty(a.provider, a.providerName || a.provider)
      rows.push(row)
    }
    row.agents++
    if (a.running) row.running++
    row.input += a.usage.inputTokens
    row.output += a.usage.outputTokens
    row.costUsd += a.usage.costUsd
    if (a.capabilities.cost) row.costKnown = true
  }
  return rows
}

/** Share of a usage window still free, as a whole percent. Clamped to 0..100. */
export function percentLeft(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0
  return Math.min(100, Math.max(0, Math.round(100 - usedPercent)))
}

/** A short local time for when a window resets, e.g. "Nov 7, 1:09 AM". Empty when the time is unknown. */
export function resetLabel(resetsAtMs: number): string {
  if (!resetsAtMs) return ''
  return new Date(resetsAtMs).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
