// Pure layout for the universe. Each project is a sun placed along one of two galactic
// arms, so the projects read as a single formation around an empty core rather than a
// scatter of points. Its agents are planets on concentric orbits. Positions are derived
// from time, so the renderer only needs the static parts recomputed when data changes.
import type { AgentSummary, Point, ProjectSummary, Status } from '../../types'
import { projectMark } from '../format'
import { starColorFor } from '../theme'

/**
 * Typical distance between neighbouring suns along an arm. Fixed so that suns never move
 * when data changes, and sized so a universe's disc rarely reaches its neighbour's.
 */
export const CELL = 1700
/** Radius of the empty bulge at the galactic centre. No sun sits inside it. */
export const CORE_GAP = 1300
/**
 * Spacing of the sunflower layout that positions were first saved against. Agent positions are
 * stored as world points measured from those suns, so the layout keeps that frame for storage.
 */
const LEGACY_CELL = 2600
const LEGACY_SCALE = LEGACY_CELL * 0.95
const LEGACY_GOLDEN_ANGLE = 2.399963229728653
/** Orbit radius of the first planet in a system, in world units. */
export const BASE_RADIUS = 230
/** Gap between neighbouring orbits. */
export const RING_GAP = 96
/** Smallest allowed orbit when a planet is dragged close to its sun. */
const MIN_RADIUS = 160
const GOLDEN_ANGLE = 2.399963229728653
/** Angular speed of the innermost orbit, in radians per second. Outer orbits are slower (Kepler-like). */
const BASE_SPEED = 0.12

/**
 * Arm geometry. The crest of arm k sits at θ = k·π + WIND·ln(r/SCALE + 1). These constants
 * match the density field in galaxyShape.ts, so the structure drawn behind the suns and
 * the suns themselves follow the same arms.
 */
const ARM_WIND = 2.6
const ARM_SCALE = 900
/** Lateral scatter of suns about their arm, in radians of angle. */
const ARM_SPREAD = 0.22
/** Radial scatter of suns along an arm, as a share of CELL. */
const RADIAL_SPREAD = 0.3

/**
 * Overview legibility. Orbits never draw closer to their sun than this many screen pixels,
 * so the planets of a small system stay separate when the whole galaxy is on screen. Once
 * the camera zooms in, the true orbit (which is always larger) takes over.
 */
export const ORBIT_FLOOR_PX = 24
export const ORBIT_GAP_PX = 13

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
  /** Number of planets (agents) in the system. */
  planets: number
  /**
   * Offset from where the sun was first saved to where it sits now. Stored agent positions are
   * world points in the saved frame, so they are shifted by this to land on the same orbit.
   */
  shiftX: number
  shiftY: number
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
  /** True orbit radius, in world units. */
  radius: number
  /** Order of the orbit within its system, innermost first. */
  rank: number
  phase: number
  speed: number
}

export interface Layout {
  suns: Sun[]
  planets: Planet[]
  planetById: Map<string, Planet>
  sunById: Map<string, Sun>
}

/** Angle of arm `arm` (0 or 1) at radius r. Suns scatter about this line. */
export function armAngle(r: number, arm: number): number {
  return arm * Math.PI + ARM_WIND * Math.log(r / ARM_SCALE + 1)
}

/** Where the i-th project's sun was placed when agent positions were first saved. Used only to keep those positions valid. */
export function legacySunPosition(index: number, projectId: string): Point {
  const r = LEGACY_SCALE * Math.sqrt(index)
  const a = index * LEGACY_GOLDEN_ANGLE
  const h = hashId(projectId)
  const jx = ((h & 0xffff) / 0xffff - 0.5) * 0.08 * LEGACY_CELL
  const jy = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.08 * LEGACY_CELL
  return { x: Math.cos(a) * r + jx, y: Math.sin(a) * r + jy }
}

/** Converts a stored agent position (saved frame) to world coordinates for this sun. */
export function storedToWorld(sun: Pick<Sun, 'shiftX' | 'shiftY'>, p: Point): Point {
  return { x: p.x + sun.shiftX, y: p.y + sun.shiftY }
}

/** Converts a world position back to the saved frame, for persisting a dragged planet. */
export function worldToStored(sun: Pick<Sun, 'shiftX' | 'shiftY'>, p: Point): Point {
  return { x: p.x - sun.shiftX, y: p.y - sun.shiftY }
}

/**
 * Where the i-th project's sun sits. Projects alternate between the two arms, moving
 * outward one cell at a time, with a jitter seeded by the project id so the field looks
 * organic. Depends only on index and id, never on agents.
 */
export function sunPosition(index: number, projectId: string): Point {
  const arm = index % 2
  const slot = Math.floor(index / 2)
  const h = hashId(projectId)
  const u1 = (h & 0xffff) / 0xffff - 0.5
  const u2 = ((h >>> 16) & 0xffff) / 0xffff - 0.5
  const r = CORE_GAP + slot * CELL * 0.9 + u2 * CELL * RADIAL_SPREAD
  const theta = armAngle(r, arm) + u1 * ARM_SPREAD * 2
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r }
}

/** Angular speed for an orbit: inner planets move faster, roughly as r^-3/2. */
export function orbitalSpeed(radius: number): number {
  return Math.max(0.015, BASE_SPEED * Math.pow(BASE_RADIUS / Math.max(1, radius), 1.5))
}

/**
 * How fast an agent moves round its sun, as a multiple of its orbital speed. Working agents
 * race, idle ones drift, a finished one settles, and a failed one nearly stalls.
 */
export function orbitRate(status: Status): number {
  switch (status) {
    case 'thinking':
    case 'writing':
    case 'reading':
      return 2.6
    case 'waiting':
      return 1.2
    case 'completed':
      return 0.6
    case 'idle':
    case 'stopped':
      return 0.35
    case 'failed':
      return 0.2
    default:
      // Unknown or missing status (older data, or a status added later): keep the base speed.
      return 1
  }
}

function hashId(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Corners of the square that encloses a whole solar system, for framing it with fitPoints. */
export function systemBounds(sun: Pick<Sun, 'x' | 'y' | 'reach'>): Point[] {
  return [
    { x: sun.x - sun.reach, y: sun.y - sun.reach },
    { x: sun.x + sun.reach, y: sun.y + sun.reach },
  ]
}

/**
 * The orbit a planet is drawn on at a camera zoom, in world units. It is the true radius
 * unless the zoom is so far out that the true orbit would be closer than the overview floor.
 */
export function displayOrbit(p: Planet, zoom: number): number {
  if (!(zoom > 0)) return p.radius
  return Math.max(p.radius, (ORBIT_FLOOR_PX + p.rank * ORBIT_GAP_PX) / zoom)
}

/**
 * Position of a planet at time t (seconds). Pass the camera zoom so the planet sits on the
 * orbit it is drawn on. The default, Infinity, gives the true orbit.
 */
export function planetPosition(p: Planet, t: number, zoom = Infinity): Point {
  const a = p.phase + p.speed * t
  const r = displayOrbit(p, zoom)
  return { x: p.sunX + Math.cos(a) * r, y: p.sunY + Math.sin(a) * r }
}

/**
 * Builds the layout. overrides holds positions the user has dragged to, which
 * take priority over the position stored on the agent. carry is the previous layout: a
 * planet keeps the angle it has reached, so a change of speed (a status change) does not
 * make it jump. Passing no carry starts every planet from its stored or default angle.
 * activeDragId identifies the override that must follow the pointer right now.
 */
export function computeLayout(
  projects: ProjectSummary[],
  agents: AgentSummary[],
  overrides: Map<string, Point>,
  t0: number,
  carry?: Layout,
  activeDragId?: string,
): Layout {
  const suns: Sun[] = []
  const sunById = new Map<string, Sun>()
  projects.forEach((p, i) => {
    const at = sunPosition(i, p.id)
    const was = legacySunPosition(i, p.id)
    const sun: Sun = {
      id: p.id,
      name: p.name,
      mark: projectMark(p),
      x: at.x,
      y: at.y,
      color: starColorFor(p.id),
      index: i,
      reach: MIN_REACH,
      planets: 0,
      shiftX: at.x - was.x,
      shiftY: at.y - was.y,
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
    sun.planets += 1

    let radius = BASE_RADIUS + k * RING_GAP
    let phase = k * GOLDEN_ANGLE

    // Overrides are already world points (a drag in progress). A saved position is in the saved frame.
    const placed = overrides.get(a.id) ?? (a.position ? storedToWorld(sun, a.position) : undefined)
    if (placed) {
      const dx = placed.x - sun.x
      const dy = placed.y - sun.y
      radius = Math.max(MIN_RADIUS, Math.hypot(dx, dy))
    }
    // Speed follows the final radius, so a dragged planet keeps a physically plausible period,
    // then scales with the agent's status.
    const direction = k % 2 === 0 ? 1 : -1
    const speed = direction * orbitalSpeed(radius) * orbitRate(a.status)
    const before = carry?.planetById.get(a.id)
    const drag = activeDragId === a.id ? overrides.get(a.id) : undefined
    if (drag) {
      // A drag in progress: keep the planet under the pointer.
      phase = Math.atan2(drag.y - sun.y, drag.x - sun.x) - speed * t0
    } else if (before && before.sunX === sun.x && before.sunY === sun.y) {
      // Continue from the angle it has reached, so a speed change never jumps it.
      phase = before.phase + before.speed * t0 - speed * t0
    } else if (placed) {
      // Keep the planet where it was saved when the clock is at t0.
      phase = Math.atan2(placed.y - sun.y, placed.x - sun.x) - speed * t0
    }
    const planet: Planet = { id: a.id, projectId: a.projectId, sunX: sun.x, sunY: sun.y, radius, rank: 0, phase, speed }
    planets.push(planet)
    planetById.set(a.id, planet)
    const sunReach = planet.radius + REACH_PAD
    if (sunReach > sun.reach) sun.reach = sunReach
  }

  // Rank orbits within each system by radius, so the overview floor keeps them in order
  // even when a planet has been dragged inside another's orbit.
  const byProject = new Map<string, Planet[]>()
  for (const p of planets) {
    const list = byProject.get(p.projectId)
    if (list) list.push(p)
    else byProject.set(p.projectId, [p])
  }
  for (const list of byProject.values()) {
    list.sort((a, b) => a.radius - b.radius)
    list.forEach((p, i) => (p.rank = i))
  }
  return { suns, planets, planetById, sunById }
}

/** Nearest free-ish drop point for a fresh agent: on its own orbit, away from others. */
export function defaultOrbitRadius(index: number): number {
  return BASE_RADIUS + index * RING_GAP
}
