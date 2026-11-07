// Agent-to-agent beams: which pairs of planets are connected, and by what. Pure logic, no canvas,
// so the rules can be tested directly. render.ts draws whatever this returns.
import type { AgentSummary, Handoff } from '../../types'

export type BeamKind = 'delegation' | 'handoff' | 'failed' | 'shared'

export interface Beam {
  /** Stable across frames, so drawing can key animation phase to it. */
  key: string
  kind: BeamKind
  fromId: string
  toId: string
  /** Shared beams only: the files both agents touched, at least one of them written. */
  files: string[]
  /** Milliseconds since a finished handoff ended. Zero for every other kind. */
  age: number
}

/** A finished or failed handoff stays visible this long, then fades out of the galaxy. */
export const HANDOFF_FADE_MS = 6000

/** Beam colours. Shared files reuse the amber of the conflict badge so both read as "overlap". */
export const BEAM_COLOR: Record<BeamKind, string> = {
  delegation: '#38bdf8',
  handoff: '#4ade80',
  failed: '#f87171',
  shared: '#f59e0b',
}

/**
 * Connects planets that share work. Handoffs come from the project summaries; a handoff is drawn
 * while active, then for HANDOFF_FADE_MS after it ends. Shared files are derived from each agent's
 * recently touched files: two agents in one project who both touched a file, with a write by either.
 * Beams whose endpoints are not on the galaxy (removed agents) are dropped.
 */
export function computeBeams(agents: AgentSummary[], handoffs: Handoff[], now: number): Beam[] {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const beams: Beam[] = []

  for (const h of handoffs) {
    if (!byId.has(h.fromId) || !byId.has(h.toId) || h.fromId === h.toId) continue
    if (h.status === 'active') {
      beams.push({ key: `h:${h.id}`, kind: 'delegation', fromId: h.fromId, toId: h.toId, files: [], age: 0 })
      continue
    }
    const ended = h.doneAt ?? h.at
    const age = now - ended
    if (age < 0 || age >= HANDOFF_FADE_MS) continue
    beams.push({
      key: `h:${h.id}`,
      kind: h.status === 'failed' ? 'failed' : 'handoff',
      fromId: h.fromId,
      toId: h.toId,
      files: [],
      age,
    })
  }

  // Shared files: index each agent's touched files, then pair agents that share one in the same project.
  const pairs = new Map<string, { a: AgentSummary; b: AgentSummary; files: string[] }>()
  const list = [...agents].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a.projectId !== b.projectId) continue
      const shared = sharedFiles(a, b)
      if (shared.length === 0) continue
      pairs.set(`${a.id}|${b.id}`, { a, b, files: shared })
    }
  }
  for (const [key, p] of pairs) {
    beams.push({ key: `s:${key}`, kind: 'shared', fromId: p.a.id, toId: p.b.id, files: p.files, age: 0 })
  }
  return beams
}

/** Paths both agents touched where at least one of them wrote the file. Sorted for stable output. */
function sharedFiles(a: AgentSummary, b: AgentSummary): string[] {
  const bFiles = new Map((b.recentFiles ?? []).map((f) => [f.path, f]))
  const out: string[] = []
  for (const fa of a.recentFiles ?? []) {
    const fb = bFiles.get(fa.path)
    if (!fb) continue
    if (fa.writes > 0 || fb.writes > 0) out.push(fa.path)
  }
  return out.sort()
}

/** Returns the stroke alpha for a beam, from 0 to 1, so finished handoffs fade rather than vanish. */
export function beamAlpha(beam: Beam): number {
  if (beam.kind === 'handoff' || beam.kind === 'failed') {
    return Math.max(0, 1 - beam.age / HANDOFF_FADE_MS)
  }
  return 1
}
