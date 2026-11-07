import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '../../types'
import { percentLeft, resetLabel, usageByProvider } from '../usage'

function agent(provider: string, over: Partial<{ running: boolean; input: number; output: number; cost: number; costKnown: boolean }> = {}): AgentSummary {
  return {
    id: Math.random().toString(36).slice(2),
    provider,
    providerName: provider === 'claude' ? 'Claude Code' : 'Codex CLI',
    running: over.running ?? false,
    usage: { inputTokens: over.input ?? 0, outputTokens: over.output ?? 0, cacheReadTokens: 0, costUsd: over.cost ?? 0 },
    capabilities: { cost: over.costKnown ?? provider === 'claude' },
  } as unknown as AgentSummary
}

describe('usageByProvider', () => {
  it('always lists Claude and Codex, even with no agents', () => {
    const rows = usageByProvider([])
    expect(rows.map((r) => r.provider)).toEqual(['claude', 'codex'])
    expect(rows.every((r) => r.agents === 0 && r.costKnown === false)).toBe(true)
  })

  it('sums tokens, spend and running agents per provider', () => {
    const rows = usageByProvider([
      agent('claude', { running: true, input: 100, output: 20, cost: 1.5 }),
      agent('claude', { input: 50, output: 5, cost: 0.5 }),
      agent('codex', { input: 300, output: 40, costKnown: false }),
    ])
    const claude = rows.find((r) => r.provider === 'claude')!
    const codex = rows.find((r) => r.provider === 'codex')!
    expect(claude).toMatchObject({ agents: 2, running: 1, input: 150, output: 25, costUsd: 2, costKnown: true })
    expect(codex).toMatchObject({ agents: 1, running: 0, input: 300, output: 40, costKnown: false })
  })

  it('appends unknown providers after the fixed ones, labelled by their name', () => {
    const rows = usageByProvider([{ ...agent('gemini'), providerName: 'Gemini CLI' } as AgentSummary])
    expect(rows.map((r) => r.provider)).toEqual(['claude', 'codex', 'gemini'])
    expect(rows[2].label).toBe('Gemini CLI')
  })
})

describe('percentLeft', () => {
  it('is the share of the window still free, rounded', () => {
    expect(percentLeft(30)).toBe(70)
    expect(percentLeft(51.4)).toBe(49)
  })

  it('clamps to 0..100 and treats nonsense as empty', () => {
    expect(percentLeft(140)).toBe(0)
    expect(percentLeft(-5)).toBe(100)
    expect(percentLeft(Number.NaN)).toBe(0)
  })
})

describe('resetLabel', () => {
  it('is empty when the reset time is unknown', () => {
    expect(resetLabel(0)).toBe('')
  })

  it('formats a known reset time', () => {
    expect(resetLabel(Date.UTC(2026, 10, 7, 1, 9))).not.toBe('')
  })
})
