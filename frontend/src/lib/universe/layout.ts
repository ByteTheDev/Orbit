// Pure layout for the universe. Each project is a sun placed on a golden-angle
// spiral, so the map reads as a living field rather than a grid. Its agents are
// planets on concentric orbits. Positions are derived from time, so the renderer
// only needs the static parts recomputed when data changes.
import type { AgentSummary, Point, ProjectSummary } from '../../types'
import { projectMark } from '../format'
import { starColorFor } from '../theme'

/**
 * Typical distance between neighbouring suns. Fixed so that suns never move when
 * data changes, and sized so a universe's disc rarely reaches its neighbour's.
 */
export const CELL = 2600
/** Orbit radius of the first planet in a system, in world units. */
export const BASE_RADIUS = 170
/** Gap between neighbouring orbits. */
export const RING_GAP = 72
/** Smallest allowed orbit when a planet is dragged close to its sun. */
const MIN_RADIUS = 120
const GOLDEN_ANGLE = 2.399963229728653
/** Vogel-spiral scale. The closest pair of suns is about this far apart, so ≈ CELL keeps neighbours a cell apart. */
const SPIRAL_SCALE = CELL * 0.95
/** Angular speed of the innermost orbit, in radians per second. Outer orbits are slower (Kepler-like). */
const BASE_SPEED = 0.12

export interface Sun {
  id: string
  name: string
  /** The letter drawn on the sun. */
  mark: string
  x: number
  y: number
  /** Spectral colour of the star, stable for a project id. */
  color: string
  index: number
  /** Radius of the project's universe: its outermost orbit plus room for moons. */
  reach: number
}

/** Smallest universe disc, so a project with no agents still reads as a region. */
export const MIN_REACH = 320
/** Room past the outermost orbit for moons and labels. */
const REACH_PAD = 150

export interface Planet {
  id: string
  projectId: string
  sunX: number
  sunY: number
  radius: number
  phase: number
  speed: number
}

export interface Layout {
  suns: Sun[]
  planets: Planet[]
  planetById: Map<string, Planet>
  sunById: Map<string, Sun>
}

/**
 * Where the i-th project's sun sits: a Vogel spiral, with a small jitter seeded by the
 * project id so the field looks organic. Depends only on index and id, never on agents.
 */
export function sunPosition(index: number, projectId: string): Point {
  const r = SPIRAL_SCALE * Math.sqrt(index)
  const a = index * GOLDEN_ANGLE
  const h = hashId(projectId)
  const jx = ((h & 0xffff) / 0xffff - 0.5) * 0.08 * CELL
  const jy = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.08 * CELL
  return { x: Math.cos(a) * r + jx, y: Math.sin(a) * r + jy }
}

/** Angular speed for an orbit: inner planets move faster, roughly as r^-3/2. */
export function orbitalSpeed(radius: number): number {
  return Math.max(0.015, BASE_SPEED * Math.pow(BASE_RADIUS / Math.max(1, radius), 1.5))
}

function hashId(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Position of a planet at time t (seconds). */
export function planetPosition(p: Planet, t: number): Point {
  const a = p.phase + p.speed * t
  return { x: p.sunX + Math.cos(a) * p.radius, y: p.sunY + Math.sin(a) * p.radius }
}

/**
 * Builds the layout. overrides holds positions the user has dragged to, which
 * take priority over the position stored on the agent.
 */
export function computeLayout(
  projects: ProjectSummary[],
  agents: AgentSummary[],
  overrides: Map<string, Point>,
  t0: number,
): Layout {
  const suns: Sun[] = []
  const sunById = new Map<string, Sun>()
  projects.forEach((p, i) => {
    const at = sunPosition(i, p.id)
    const sun: Sun = {
      id: p.id,
      name: p.name,
      mark: projectMark(p),
      x: at.x,
      y: at.y,
      color: starColorFor(p.id),
      index: i,
      reach: MIN_REACH,
    }
    suns.push(sun)
    sunById.set(p.id, sun)
  })

  const planets: Planet[] = []
  const planetById = new Map<string, Planet>()
  const perProject = new Map<string, number>()
  for (const a of agents) {
    const sun = sunById.get(a.projectId)
    if (!sun) continue
    const k = perProject.get(a.projectId) ?? 0
    perProject.set(a.projectId, k + 1)

    let radius = BASE_RADIUS + k * RING_GAP
    let phase = k * GOLDEN_ANGLE

    const placed = overrides.get(a.id) ?? a.position
    if (placed) {
      const dx = placed.x - sun.x
      const dy = placed.y - sun.y
      radius = Math.max(MIN_RADIUS, Math.hypot(dx, dy))
    }
    // Speed follows the final radius, so a dragged planet keeps a physically plausible period.
    const direction = k % 2 === 0 ? 1 : -1
    const speed = direction * orbitalSpeed(radius)
    if (placed) {
      // Keep the planet where it was dropped when the clock is at t0.
      phase = Math.atan2(placed.y - sun.y, placed.x - sun.x) - speed * t0
    }
    const planet: Planet = { id: a.id, projectId: a.projectId, sunX: sun.x, sunY: sun.y, radius, phase, speed }
    planets.push(planet)
    planetById.set(a.id, planet)
    const sunReach = planet.radius + REACH_PAD
    if (sunReach > sun.reach) sun.reach = sunReach
  }
  return { suns, planets, planetById, sunById }
}

/** Nearest free-ish drop point for a fresh agent: on its own orbit, away from others. */
export function defaultOrbitRadius(index: number): number {
  return BASE_RADIUS + index * RING_GAP
}
