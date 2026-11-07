// Canvas renderer and hit-testing for the universe. Drawing reads from a view
// snapshot and has no side effects, which keeps frames cheap and testable.
//
// Cost model: each planet's body (surface, bands, craters, atmosphere, rings) is drawn
// once into a cached sprite. Per frame a planet costs one drawImage, a directional
// lighting overlay that follows its sun, and its status and selection marks.
import type { AgentSummary, Handoff, ProjectSummary, Status, SubAgent } from '../../types'
import { toolKind, type ToolKind } from '../toolKind'
import { BEAM_COLOR, beamAlpha, computeBeams, type Beam } from './beams'
import { DEFAULT_BODY, PROVIDER_BODY, STATUS_COLOR, type PlanetBody } from '../theme'
import { worldToScreen, type Camera } from './camera'
import { ORBIT_FLOOR_PX, ORBIT_GAP_PX, displayOrbit, planetPosition, type Layout, type Planet } from './layout'
import { projectIconImage } from '../icons'
import { identityFor } from '../projectIdentity'

const PLANET_RADIUS = 30 // world units: large enough that surface detail reads at fit zoom
const SUN_RADIUS = 46 // world units: the star body, sized so its surface still reads when zoomed out
const ROCK_ORBIT = 58
/** Rocks shown per agent: the newest tool calls. Matches the backend's recent-tools cap. */
const MAX_ROCKS = 8
const ROCK_RADIUS = 6.5 // screen px: big enough to read as a solid object on the dark canvas
const TAU = Math.PI * 2
const RING_TILT = -0.32
export const PULSE_MS = 900
/** Period of the red ring a failed agent repeats. */
const FAIL_RING_MS = 1400

/** Body sprites are drawn at this radius and scaled per frame. Sprites cover the atmosphere and rings. */
const SPRITE_R = 32
const SPRITE_EXTENT = SPRITE_R * 2.4
const SPRITE_LIMIT = 96

/** Colour tokens used by the canvas. Mirrors index.css; read through theme.ts where possible. */
const INK = '#f4f4f5'
const MUTED = '#a1a1aa'
const CANVAS = '#09090b'
const SUN_CORE = '#fff4dc'

export interface Pulse {
  x: number
  y: number
  color: string
  start: number
}

export interface ViewState {
  width: number
  height: number
  dpr: number
  camera: Camera
  layout: Layout
  agents: Map<string, AgentSummary>
  projects: Map<string, ProjectSummary>
  selectedId: string | null
  hoverId: string | null
  t: number
  now: number
  reduced: boolean
  pulses: Pulse[]
  appearAt: Map<string, number>
}

/** A rock orbiting a planet: one recent tool call, coloured and labelled by what kind of command it was. */
export interface Rock {
  key: string
  agentId: string
  kind: ToolKind
  /** The tool's name as the provider reports it, e.g. "Bash" or "Edit". */
  name: string
  status: string
  x: number
  y: number
  appear: number
  seed: number
}

export type Hit =
  | { kind: 'planet'; id: string }
  | { kind: 'rock'; agentId: string; name: string }
  | { kind: 'sun'; id: string }

// ---- rocks ------------------------------------------------------------------

/**
 * One rock per recent tool call, newest last. A running call orbits faster and sits further out,
 * so work in progress stands out from finished work.
 */
export function rocksFor(agent: AgentSummary, planet: Planet, view: ViewState): Rock[] {
  // Rocks are live only: they show while the agent is running and a command is in flight.
  if (!agent.running) return []
  const tools = (agent.recentTools ?? []).filter((t) => t.status === 'running')
  if (tools.length === 0) return []
  const shown = tools.slice(-MAX_ROCKS)

  const center = planetPosition(planet, view.t, view.camera.zoom)
  return shown.map((t, i) => {
    const running = t.status === 'running'
    const lane = i % 2 === 0 ? 0 : 1
    const radius = ROCK_ORBIT + lane * 9 + (running ? 3 : 0)
    const speed = (running ? 0.9 : 0.22) * (lane === 0 ? 1 : -1)
    const base = (i / shown.length) * TAU + hashAngle(t.id)
    const a = base + (view.reduced ? 0 : speed * view.t)
    const key = `${agent.id}|${t.id || t.at}`
    const seen = view.appearAt.get(key)
    const appear = seen === undefined ? 0 : easeOut(Math.min(1, (view.now - seen) / 380))
    return {
      key,
      agentId: agent.id,
      kind: toolKind(t.name),
      name: t.name || 'Tool',
      status: t.status,
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
      appear,
      seed: hashString(t.id),
    }
  })
}

function hashAngle(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 628) / 100
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ---- backdrop -----------------------------------------------------------------

/** Pre-rendered starfield and gradient, rebuilt only when the canvas size changes. */
export function makeBackdrop(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(w * dpr))
  c.height = Math.max(1, Math.floor(h * dpr))
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Near-black, lifted very slightly at the centre so the planets sit in a little light.
  ctx.fillStyle = CANVAS
  ctx.fillRect(0, 0, w, h)
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.6)
  glow.addColorStop(0, 'rgba(244,244,245,0.035)')
  glow.addColorStop(1, 'rgba(244,244,245,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Deterministic stars so the field does not shimmer when the window resizes.
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const count = Math.round((w * h) / 4800)
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = rnd() < 0.07 ? 1.2 : 0.6
    ctx.fillStyle = `rgba(228,228,231,${(0.1 + rnd() * 0.42).toFixed(3)})`
    ctx.fillRect(x, y, r, r)
  }
  return c
}

// ---- drawing ------------------------------------------------------------------

export function drawUniverse(ctx: CanvasRenderingContext2D, view: ViewState, backdrop: HTMLCanvasElement | null): void {
  const { width: w, height: h, dpr, camera: cam, layout, agents } = view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (backdrop) ctx.drawImage(backdrop, 0, 0, w, h)
  drawGalaxy(ctx, view)

  // Orbit tracks first, so planets and suns sit on top of them. The selected planet's track is brightest.
  // Fine trails: a hairline that suggests the path without drawing it as a diagram.
  for (const p of layout.planets) {
    const sun = worldToScreen(cam, w, h, p.sunX, p.sunY)
    const r = displayOrbit(p, cam.zoom) * cam.zoom
    if (!onScreen(sun, r + 4, w, h)) continue
    const selected = p.id === view.selectedId
    // Inactive tracks are hairlines that recede into the nebula. The selected track is the one clear line.
    ctx.lineWidth = selected ? 1.25 : 0.75
    ctx.setLineDash([])
    ctx.strokeStyle = selected ? 'rgba(244,244,245,0.6)' : 'rgba(244,244,245,0.16)'
    ctx.beginPath()
    ctx.arc(sun.x, sun.y, r, 0, TAU)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Labels are placed greedily. A name that would overlap one already drawn is left out, so the
  // overview names a few systems rather than piling text on top of the stars. The selected and
  // hovered systems always keep their name.
  const placed: LabelBox[] = []
  for (const sun of layout.suns) {
    const s = worldToScreen(cam, w, h, sun.x, sun.y)
    if (!onScreen(s, 260, w, h)) continue
    drawSun(ctx, s.x, s.y, identityFor(sun.id).accent, cam.zoom, view.now, view.reduced)
    const project = view.projects.get(sun.id)
    const label = project?.name ?? sun.name
    const labelY = s.y + Math.max(10, SUN_RADIUS * cam.zoom) + 6

    ctx.font = '600 14px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    const nameW = ctx.measureText(label).width
    const meta = project ? systemMeta(project) : ''
    ctx.font = '10px "Segoe UI", system-ui, sans-serif'
    const metaW = meta ? ctx.measureText(meta).width : 0
    const half = Math.max(nameW, metaW) / 2 + 22
    const box: LabelBox = { x0: s.x - half, x1: s.x + half, y0: labelY - 2, y1: labelY + (meta ? 28 : 16) }
    const important = sun.id === view.selectedId || sun.id === view.hoverId
    if (!important && placed.some((b) => overlaps(b, box))) continue
    placed.push(box)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    // A soft dark backdrop keeps the name readable over bright nebula without adding a shadow blur.
    drawLabelBackdrop(ctx, box)
    ctx.font = '600 14px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(244,244,245,0.9)'
    if (project) drawProjectBadge(ctx, s.x - nameW / 2 - 14, labelY + 7, project)
    ctx.fillText(label, s.x, labelY)
    if (project && project.conflicts.length > 0) {
      drawBadge(ctx, s.x + nameW / 2 + 12, labelY + 8, `${project.conflicts.length}`, '#f59e0b')
    }
    if (meta) {
      ctx.font = '11px "Segoe UI", system-ui, sans-serif'
      ctx.fillStyle = MUTED
      ctx.fillText(meta, s.x, labelY + 16)
    }
  }

  // Beams sit under the planets, so their ends tuck behind the bodies they connect.
  drawBeams(ctx, view)

  for (const p of layout.planets) {
    const agent = agents.get(p.id)
    if (!agent) continue
    const pos = planetPosition(p, view.t, cam.zoom)
    const s = worldToScreen(cam, w, h, pos.x, pos.y)
    // Off-screen planets cost nothing: their sprite, lighting and labels are skipped.
    if (!onScreen(s, ROCK_ORBIT * cam.zoom + 60, w, h)) continue
    const sunS = worldToScreen(cam, w, h, p.sunX, p.sunY)
    const r = Math.max(5, PLANET_RADIUS * cam.zoom)

    if (cam.zoom >= 0.35) {
      for (const k of rocksFor(agent, p, view)) drawRock(ctx, k, s, cam, w, h, view)
    }
    drawPlanet(ctx, agent, sunS, s, r, view)
    if (cam.zoom >= 0.35) drawSubAgents(ctx, agent, s, r, view, cam.zoom)
  }

  for (const pulse of view.pulses) {
    const age = (view.now - pulse.start) / PULSE_MS
    if (age < 0 || age > 1) continue
    const p = worldToScreen(cam, w, h, pulse.x, pulse.y)
    ctx.strokeStyle = withAlpha(pulse.color, 0.55 * (1 - age))
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, (PLANET_RADIUS + age * 70) * cam.zoom, 0, TAU)
    ctx.stroke()
  }
  ctx.lineWidth = 1
}

// ---- beams ------------------------------------------------------------------

/** One delegation particle crosses its beam in this long. */
const DELEGATION_PERIOD_MS = 2200
/** A received handoff sends one ring out from the receiving planet over this long. */
const HANDOFF_RING_MS = 900

/**
 * Agent-to-agent beams. Delegations carry a particle from the giver to the receiver; a finished
 * handoff leaves a ring on the receiver and fades; a failed one fades in red; shared files get
 * a slow amber shimmer. Beams are gently curved so two that share a planet do not stack.
 */
function drawBeams(ctx: CanvasRenderingContext2D, view: ViewState): void {
  const handoffs: Handoff[] = []
  for (const p of view.projects.values()) handoffs.push(...(p.handoffs ?? []))
  const beams = computeBeams([...view.agents.values()], handoffs, view.now)
  if (beams.length === 0) return

  const centres = new Map<string, { x: number; y: number }>()
  for (const p of view.layout.planets) {
    const pos = planetPosition(p, view.t, view.camera.zoom)
    centres.set(p.id, worldToScreen(view.camera, view.width, view.height, pos.x, pos.y))
  }
  for (const beam of beams) {
    const a = centres.get(beam.fromId)
    const b = centres.get(beam.toId)
    if (!a || !b) continue
    const alpha = beamAlpha(beam)
    if (alpha <= 0) continue
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2
    if (!onScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, half + 12, view.width, view.height)) continue
    drawBeam(ctx, view, beam, a, b, alpha)
  }
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
  ctx.lineWidth = 1
}

function drawBeam(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  beam: Beam,
  a: { x: number; y: number },
  b: { x: number; y: number },
  alpha: number,
): void {
  const color = BEAM_COLOR[beam.kind]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const side = hashString(beam.key) % 2 === 0 ? 1 : -1
  const bow = len * 0.12 * side
  const c = { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * bow, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * bow }
  const crawl = view.reduced ? 0 : view.now / 40

  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)

  switch (beam.kind) {
    case 'delegation': {
      ctx.setLineDash([6, 6])
      ctx.lineDashOffset = -crawl
      ctx.lineWidth = 1.6
      ctx.strokeStyle = withAlpha(color, 0.8 * alpha)
      ctx.stroke()
      if (!view.reduced) {
        const phase = (view.now / DELEGATION_PERIOD_MS + (hashString(beam.key) % 100) / 100) % 1
        const q = quadPoint(a, c, b, phase)
        ctx.fillStyle = withAlpha(color, alpha)
        ctx.beginPath()
        ctx.arc(q.x, q.y, 2.8, 0, TAU)
        ctx.fill()
      }
      break
    }
    case 'handoff': {
      ctx.lineWidth = 2
      ctx.strokeStyle = withAlpha(color, 0.75 * alpha)
      ctx.stroke()
      const ringT = view.reduced ? 1 : Math.min(1, beam.age / HANDOFF_RING_MS)
      if (ringT < 1) {
        ctx.strokeStyle = withAlpha(color, 0.6 * (1 - ringT))
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(b.x, b.y, (PLANET_RADIUS + ringT * 40) * view.camera.zoom, 0, TAU)
        ctx.stroke()
      }
      break
    }
    case 'failed': {
      ctx.setLineDash([2, 5])
      ctx.lineWidth = 1.2
      ctx.strokeStyle = withAlpha(color, 0.7 * alpha)
      ctx.stroke()
      break
    }
    case 'shared': {
      ctx.setLineDash([1, 5])
      ctx.lineDashOffset = -crawl / 4
      ctx.lineWidth = 1 + Math.min(beam.files.length, 3) * 0.5
      ctx.strokeStyle = withAlpha(color, 0.55 * alpha)
      ctx.stroke()
      break
    }
  }
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

/** Point at parameter t on the quadratic curve from a through c to b. */
function quadPoint(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  }
}

/** True when a disc of radius `pad` around a screen point touches the canvas. */
function onScreen(p: { x: number; y: number }, pad: number, w: number, h: number): boolean {
  return p.x + pad >= 0 && p.x - pad <= w && p.y + pad >= 0 && p.y - pad <= h
}

/** Room past a system's outermost planet for its halo, in pixels. */
const HALO_PAD_PX = 26
/**
 * Each project is a solar system: a faint halo sized to its planets, so a whole system reads as
 * one object before its orbits resolve, with a dotted edge. Drawn under the orbits.
 */
function drawGalaxy(ctx: CanvasRenderingContext2D, view: ViewState): void {
  const { width: w, height: h, camera: cam, layout } = view
  for (const sun of layout.suns) {
    const s = worldToScreen(cam, w, h, sun.x, sun.y)
    const floor = ORBIT_FLOOR_PX + Math.max(0, sun.planets - 1) * ORBIT_GAP_PX
    const R = Math.max(sun.reach * cam.zoom, floor + HALO_PAD_PX)
    if (!onScreen(s, R, w, h)) continue
    const accent = identityFor(sun.id).accent

    const disc = ctx.createRadialGradient(s.x, s.y, R * 0.3, s.x, s.y, R)
    disc.addColorStop(0, withAlpha(accent, 0.03))
    disc.addColorStop(0.85, withAlpha(accent, 0.035))
    disc.addColorStop(1, withAlpha(accent, 0))
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.arc(s.x, s.y, R, 0, TAU)
    ctx.fill()

    ctx.setLineDash([1, 7])
    ctx.strokeStyle = withAlpha(accent, 0.12)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(s.x, s.y, R, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

interface LabelBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** The second line under a system's name: its agent count, and how many are running. */
function systemMeta(project: ProjectSummary): string {
  if (project.agentCount === 0) return 'No agents yet'
  const agents = `${project.agentCount} agent${project.agentCount === 1 ? '' : 's'}`
  return project.runningCount > 0 ? `${agents} · ${project.runningCount} running` : agents
}

/** Surface sprites, one per accent, drawn once and scaled every frame. */
const SUN_SPRITE_R = 64
const sunSprites = new Map<string, HTMLCanvasElement>()

/** A stellar surface: a lit disc with limb darkening, granulation and a few darker spots. Cached per accent. */
function sunSprite(accent: string): HTMLCanvasElement {
  const hit = sunSprites.get(accent)
  if (hit) return hit
  if (sunSprites.size >= 16) sunSprites.clear()

  const side = SUN_SPRITE_R * 2 + 2
  const c = document.createElement('canvas')
  c.width = side
  c.height = side
  const g = c.getContext('2d')
  if (!g) return c
  const cx = side / 2
  const r = SUN_SPRITE_R

  // A star is light, not a solid body: no clipped disc and no hard edge. A white-hot centre
  // fades smoothly through the accent colour into nothing, so it reads as luminous.
  const hot = mixHex(accent, '#ffffff', 0.85)
  const warm = mixHex(accent, '#ffffff', 0.4)
  const light = g.createRadialGradient(cx, cx, 0, cx, cx, r)
  light.addColorStop(0, withAlpha(hot, 1))
  light.addColorStop(0.18, withAlpha(hot, 0.97))
  light.addColorStop(0.4, withAlpha(warm, 0.88))
  light.addColorStop(0.65, withAlpha(accent, 0.5))
  light.addColorStop(0.85, withAlpha(accent, 0.16))
  light.addColorStop(1, withAlpha(accent, 0))
  g.fillStyle = light
  g.fillRect(0, 0, side, side)

  // Faint granulation near the centre only: enough texture to feel like a surface, not a planet.
  const rand = seeded(hashString(accent))
  for (let i = 0; i < 90; i++) {
    const a = rand() * TAU
    const d = Math.sqrt(rand()) * r * 0.6
    const rad = r * (0.03 + rand() * 0.05)
    g.fillStyle = `rgba(255,255,255,${(0.03 + rand() * 0.04).toFixed(3)})`
    g.beginPath()
    g.arc(cx + Math.cos(a) * d, cx + Math.sin(a) * d, rad, 0, TAU)
    g.fill()
  }

  sunSprites.set(accent, c)
  return c
}

/**
 * A project's star. Light first: a wide bloom, a breathing corona and fine diffraction spikes,
 * all added onto what is behind. Then the surface sprite. No lettering on the disc.
 */
function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string, zoom: number, now: number, reduced: boolean): void {
  const core = Math.max(10, SUN_RADIUS * zoom)
  // Each star breathes on its own phase, very slightly, so a field of them never pulses in step.
  const breath = reduced ? 1 : 1 + 0.04 * Math.sin(now / 1100 + (x * 0.013 + y * 0.017))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const bloom = Math.max(core * 7, 120 * zoom)
  const glow = ctx.createRadialGradient(x, y, 0, x, y, bloom)
  glow.addColorStop(0, withAlpha(accent, 0.42 * breath))
  glow.addColorStop(0.18, withAlpha(accent, 0.16 * breath))
  glow.addColorStop(0.5, withAlpha(accent, 0.04 * breath))
  glow.addColorStop(1, withAlpha(accent, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, bloom, 0, TAU)
  ctx.fill()

  const corona = core * 2.8
  const halo = ctx.createRadialGradient(x, y, core * 0.4, x, y, corona)
  halo.addColorStop(0, withAlpha(SUN_CORE, 0.5 * breath))
  halo.addColorStop(0.4, withAlpha(accent, 0.24 * breath))
  halo.addColorStop(1, withAlpha(accent, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, corona, 0, TAU)
  ctx.fill()

  if (core >= 10) {
    const spike = core * 3.1
    ctx.lineWidth = 1
    for (const horizontal of [true, false]) {
      const gx = horizontal ? x - spike : x
      const gy = horizontal ? y : y - spike
      const ex = horizontal ? x + spike : x
      const ey = horizontal ? y : y + spike
      const beam = ctx.createLinearGradient(gx, gy, ex, ey)
      beam.addColorStop(0, withAlpha(SUN_CORE, 0))
      beam.addColorStop(0.5, withAlpha(SUN_CORE, 0.22))
      beam.addColorStop(1, withAlpha(SUN_CORE, 0))
      ctx.strokeStyle = beam
      ctx.beginPath()
      ctx.moveTo(gx, gy)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    }
  }
  ctx.restore()

  // The surface, scaled from its cached sprite to the star's current radius.
  const sprite = sunSprite(accent)
  const scale = core / SUN_SPRITE_R
  const side = sprite.width * scale
  ctx.drawImage(sprite, x - side / 2, y - side / 2, side, side)
}

/**
 * The project's uploaded icon or custom letter, set beside its name. Draws nothing when the project
 * has neither. Centred on (x, y), at the left edge of the label.
 */
function drawProjectBadge(ctx: CanvasRenderingContext2D, x: number, y: number, project: ProjectSummary): void {
  const identity = identityFor(project.id)
  const size = 18
  const image = projectIconImage(project.id, project.iconRev ?? 0)
  if (image && image.naturalWidth > 0) {
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    const sx = (image.naturalWidth - side) / 2
    const sy = (image.naturalHeight - side) / 2
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x - size / 2, y - size / 2, size, size, 4)
    ctx.clip()
    ctx.drawImage(image, sx, sy, side, side, x - size / 2, y - size / 2, size, size)
    ctx.restore()
    return
  }
  const letter = project.icon?.trim()
  if (letter) {
    ctx.save()
    ctx.fillStyle = identity.accent
    ctx.font = `700 ${letter.length > 1 ? 9 : 11}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(letter, x, y + 0.5)
    ctx.restore()
    return
  }
  // No generated fallback: a project with no uploaded icon or letter is labelled by its name alone.
}

/**
 * A planet: a cached, unlit body sprite, a per-frame lighting pass that faces its own sun,
 * and the live marks (writing glow, status ring, selection, labels).
 */
function drawPlanet(ctx: CanvasRenderingContext2D, agent: AgentSummary, sunS: { x: number; y: number }, s: { x: number; y: number }, r: number, view: ViewState): void {
  const body = PROVIDER_BODY[agent.provider] ?? DEFAULT_BODY
  const status = agent.status
  const color = STATUS_COLOR[status]
  const selected = agent.id === view.selectedId
  const hovered = agent.id === view.hoverId
  const pulse = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now / 420)

  // Direction from the planet to its sun. Light comes from there.
  let lx = sunS.x - s.x
  let ly = sunS.y - s.y
  const len = Math.hypot(lx, ly) || 1
  lx /= len
  ly /= len

  // Sun-facing haze: an atmosphere that leans toward the light.
  const haze = ctx.createRadialGradient(s.x + lx * r * 0.7, s.y + ly * r * 0.7, r * 0.5, s.x, s.y, r * 2.4)
  haze.addColorStop(0, withAlpha(body.glow, 0.2))
  haze.addColorStop(1, withAlpha(body.glow, 0))
  ctx.fillStyle = haze
  ctx.beginPath()
  ctx.arc(s.x, s.y, r * 2.4, 0, TAU)
  ctx.fill()

  // Writing glows and pulses, so activity is visible at a glance.
  if (status === 'writing') {
    ctx.fillStyle = withAlpha(color, 0.1 + 0.12 * pulse)
    ctx.beginPath()
    ctx.arc(s.x, s.y, r * (1.9 + 0.25 * pulse), 0, TAU)
    ctx.fill()
  }

  // A finished agent glows green and breathes slowly. A failed one sends out a red ring that repeats.
  if (status === 'completed') {
    const breathe = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now / 900)
    ctx.fillStyle = withAlpha(color, 0.08 + 0.1 * breathe)
    ctx.beginPath()
    ctx.arc(s.x, s.y, r * (1.8 + 0.2 * breathe), 0, TAU)
    ctx.fill()
  } else if (status === 'failed' && !view.reduced) {
    const k = (view.now % FAIL_RING_MS) / FAIL_RING_MS
    ctx.strokeStyle = withAlpha(color, 0.6 * (1 - k))
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(s.x, s.y, r * (1.4 + 1.2 * k), 0, TAU)
    ctx.stroke()
  }

  // The cached body: atmosphere, back ring, surface, front ring.
  const sprite = planetSprite(agent, body, view.dpr)
  const scale = r / SPRITE_R
  const half = SPRITE_EXTENT * scale
  ctx.drawImage(sprite, s.x - half, s.y - half, half * 2, half * 2)

  // Lighting from the sun: shadow falls away from the light, a soft specular sits toward it.
  if (r >= 6) drawLighting(ctx, s.x, s.y, r, lx, ly, body.glow)

  // Status ring. Each state has its own line style, so the state reads without colour:
  // solid = working, marching dashes = reading, dots = waiting, sparse dashes = stopped, hairline = idle.
  const ringR = r + (r < 9 ? 3 : 5)
  ctx.lineWidth = status === 'idle' ? 1.2 : 2
  ctx.strokeStyle = withAlpha(color, status === 'idle' ? 0.6 : status === 'thinking' ? 0.7 + 0.3 * pulse : status === 'stopped' ? 0.6 : 1)
  if (status === 'reading') {
    ctx.setLineDash([4, 4])
    ctx.lineDashOffset = view.reduced ? 0 : -((view.now / 80) % 8)
  } else if (status === 'waiting') {
    ctx.setLineDash([1, 3])
    ctx.lineCap = 'round'
  } else if (status === 'stopped') {
    ctx.setLineDash([3, 3])
  }
  ctx.beginPath()
  ctx.arc(s.x, s.y, ringR, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
  ctx.lineCap = 'butt'

  if (selected) {
    ctx.strokeStyle = 'rgba(244,244,245,0.95)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(s.x, s.y, ringR + 5, 0, TAU)
    ctx.stroke()
    ctx.lineWidth = 1
  } else if (hovered) {
    ctx.strokeStyle = 'rgba(244,244,245,0.45)'
    ctx.beginPath()
    ctx.arc(s.x, s.y, ringR + 4, 0, TAU)
    ctx.stroke()
  }

  if (r >= 9) {
    ctx.fillStyle = 'rgba(9,9,11,0.78)'
    if (body.logo) {
      // Brand mark: the 24×24 path scaled to about 60% of the planet's diameter, centred.
      const k = (r * 2 * 0.6) / 24
      ctx.save()
      ctx.translate(s.x - 12 * k, s.y - 12 * k)
      ctx.scale(k, k)
      ctx.fill(new Path2D(body.logo))
      ctx.restore()
    } else {
      ctx.font = `700 ${Math.round(Math.min(14, r * 0.85))}px "Segoe UI", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(body.mark, s.x, s.y + 0.5)
    }
  }

  // Done and failed carry a glyph badge, so the outcome is a shape as well as a colour.
  if ((status === 'failed' || status === 'completed') && r >= 7) {
    drawStateBadge(ctx, s.x + r * 0.72, s.y - r * 0.72, Math.max(3.5, r * 0.3), status === 'failed' ? 'cross' : 'tick', color)
  }

  // Labels: always for the selected or hovered planet, and for the rest when zoomed in.
  if (selected || hovered || view.camera.zoom >= 0.85) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    // A thin dark outline keeps the text legible over bright nebula without a costly shadow blur.
    ctx.lineJoin = 'round'
    ctx.font = '600 14px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(9,9,11,0.7)'
    ctx.strokeText(agent.name, s.x, s.y + ringR + 9)
    ctx.fillStyle = selected || hovered ? INK : 'rgba(244,244,245,0.86)'
    ctx.fillText(agent.name, s.x, s.y + ringR + 9)
    ctx.font = '11px "Segoe UI", system-ui, sans-serif'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(9,9,11,0.7)'
    const detail = statusLabel(status, agent.statusDetail)
    ctx.strokeText(detail, s.x, s.y + ringR + 25)
    ctx.fillStyle = withAlpha(color, 0.95)
    ctx.fillText(detail, s.x, s.y + ringR + 25)
  }
}

/** A small glyph disc on a planet's shoulder: a tick for completed, a cross for failed. */
function drawStateBadge(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, glyph: 'tick' | 'cross', color: string): void {
  ctx.fillStyle = 'rgba(9,9,11,0.92)'
  ctx.beginPath()
  ctx.arc(x, y, rad + 1.5, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (glyph === 'cross') {
    const k = rad * 0.5
    ctx.moveTo(x - k, y - k)
    ctx.lineTo(x + k, y + k)
    ctx.moveTo(x + k, y - k)
    ctx.lineTo(x - k, y + k)
  } else {
    ctx.moveTo(x - rad * 0.55, y + rad * 0.05)
    ctx.lineTo(x - rad * 0.1, y + rad * 0.5)
    ctx.lineTo(x + rad * 0.6, y - rad * 0.45)
  }
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
}

/** Per-frame light from the sun: a terminator that darkens away from it, a specular glint and a lit rim. */
function drawLighting(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, glow: string): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.clip()

  const shadow = ctx.createRadialGradient(x + lx * r * 0.35, y + ly * r * 0.35, r * 0.2, x, y, r * 1.04)
  shadow.addColorStop(0, 'rgba(9,9,11,0)')
  shadow.addColorStop(0.55, 'rgba(9,9,11,0.22)')
  shadow.addColorStop(1, 'rgba(9,9,11,0.82)')
  ctx.fillStyle = shadow
  ctx.fillRect(x - r, y - r, r * 2, r * 2)

  const spec = ctx.createRadialGradient(x + lx * r * 0.42, y + ly * r * 0.42, 0, x + lx * r * 0.42, y + ly * r * 0.42, r * 0.5)
  spec.addColorStop(0, 'rgba(255,255,255,0.32)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.restore()

  if (r >= 7) {
    const angle = Math.atan2(ly, lx)
    ctx.strokeStyle = withAlpha(glow, 0.5)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, r - 0.5, angle - 0.85, angle + 0.85)
    ctx.stroke()
  }
}

// ---- cached body sprites --------------------------------------------------------

const spriteCache = new Map<string, HTMLCanvasElement>()
/**
 * Distinct surfaces per provider. A planet's look is its agent's surface variant, so the
 * cache is bounded by providers × variants × dpr. Hundreds of agents never force re-bakes.
 */
const SPRITE_VARIANTS = 24

/** Draws a planet's unlit body once, at a fixed reference size, and reuses it every frame. */
function planetSprite(agent: AgentSummary, body: PlanetBody, dpr: number): HTMLCanvasElement {
  const variant = hashString(agent.id) % SPRITE_VARIANTS
  const key = `${agent.provider}|${variant}|${dpr}`
  const cached = spriteCache.get(key)
  if (cached) return cached
  // Safety bound only: unknown providers or a dpr change could otherwise grow the cache.
  if (spriteCache.size >= SPRITE_LIMIT) spriteCache.clear()

  const c = document.createElement('canvas')
  const side = Math.ceil(SPRITE_EXTENT * 2 * dpr)
  c.width = side
  c.height = side
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.setTransform(dpr, 0, 0, dpr, side / 2, side / 2)

  const seed = hashString(`surface-${variant}`) || 1
  const ringed = variant % 3 === 0
  // Atmosphere: a soft halo that reaches past the ring.
  const atmo = ctx.createRadialGradient(0, 0, SPRITE_R * 0.6, 0, 0, SPRITE_R * 2.2)
  atmo.addColorStop(0, withAlpha(body.glow, 0.16))
  atmo.addColorStop(1, withAlpha(body.glow, 0))
  ctx.fillStyle = atmo
  ctx.beginPath()
  ctx.arc(0, 0, SPRITE_R * 2.2, 0, TAU)
  ctx.fill()

  if (ringed) drawRing(ctx, 0, 0, SPRITE_R, 'back')
  drawBody(ctx, 0, 0, SPRITE_R, body, seed)
  if (ringed) drawRing(ctx, 0, 0, SPRITE_R, 'front')

  spriteCache.set(key, c)
  return c
}

/** Unlit surface: a banded, cratered sphere. Lighting is applied live, so this stays fixed. */
function drawBody(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, body: PlanetBody, seed: number): void {
  const rand = seeded(seed)

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.clip()

  const grad = ctx.createRadialGradient(x - r * 0.12, y - r * 0.12, r * 0.1, x, y, r)
  grad.addColorStop(0, body.glow)
  grad.addColorStop(0.6, body.base)
  grad.addColorStop(1, mixHex(body.base, '#000000', 0.5))
  ctx.fillStyle = grad
  ctx.fillRect(x - r, y - r, r * 2, r * 2)

  // Bands: soft horizontal strata that bend slightly across the disc.
  const bands = 3 + Math.floor(rand() * 3)
  for (let i = 0; i < bands; i++) {
    const by = y - r + ((i + 0.5 + (rand() - 0.5) * 0.45) / bands) * r * 2
    const bh = r * (0.06 + rand() * 0.07)
    ctx.fillStyle = withAlpha(mixHex(body.base, '#000000', 0.3), 0.3 + rand() * 0.14)
    ctx.beginPath()
    ctx.ellipse(x + (rand() - 0.5) * r * 0.3, by, r * 1.35, bh, RING_TILT * 0.4, 0, TAU)
    ctx.fill()
  }

  // Craters: a dark bowl with a lit rim on its lower right.
  const craters = 2 + Math.floor(rand() * 3)
  for (let i = 0; i < craters; i++) {
    const cx = x + (rand() - 0.5) * r * 1.1
    const cy = y + (rand() - 0.5) * r * 1.1
    const cr = r * (0.07 + rand() * 0.1)
    ctx.fillStyle = withAlpha(body.glow, 0.2)
    ctx.beginPath()
    ctx.arc(cx + cr * 0.35, cy + cr * 0.35, cr, 0, TAU)
    ctx.fill()
    ctx.fillStyle = withAlpha(mixHex(body.base, '#000000', 0.42), 0.6)
    ctx.beginPath()
    ctx.arc(cx, cy, cr, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

/** A tilted ring. The back half sits behind the planet and the front half in front of it. */
function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, half: 'back' | 'front'): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(RING_TILT)
  // Always light, whatever the planet's colour, so the ring reads against the dark canvas.
  ctx.strokeStyle = withAlpha(INK, half === 'back' ? 0.7 : 0.95)
  ctx.lineWidth = Math.max(1.6, r * 0.17)
  ctx.beginPath()
  if (half === 'back') ctx.ellipse(0, 0, r * 2.05, r * 0.5, 0, Math.PI, TAU)
  else ctx.ellipse(0, 0, r * 2.05, r * 0.5, 0, 0, Math.PI)
  ctx.stroke()
  ctx.restore()
}

/** Small deterministic PRNG, seeded per planet, so the surface is stable frame to frame. */
function seeded(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mixes two hex colours. Returns hex, so withAlpha can still apply an alpha to the result. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return '#' + [16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')
}

/** Colour per kind of command, so a glance tells shell work from edits and reads. */
const TOOL_COLOR: Record<ToolKind, string> = {
  shell: '#facc15',
  edit: '#f472b6',
  write: '#fb923c',
  read: '#7dd3fc',
  search: '#c4b5fd',
  web: '#34d399',
  agent: '#f0abfc',
  mcp: '#22d3ee',
  other: MUTED,
}
const FAILED_ROCK = '#f87171'

// ---- sub-agents -------------------------------------------------------------

/** Sub-agent icons shown above a planet, newest on the right. */
const MAX_SUB_ICONS = 4
const SUB_ICON_R = 5

/** Centres of an agent's sub-agent icons, in a row above its planet. */
function subAgentIcons(agent: AgentSummary, s: { x: number; y: number }, r: number): { x: number; y: number; sub: SubAgent }[] {
  const subs = (agent.subAgents ?? []).slice(-MAX_SUB_ICONS)
  const gap = SUB_ICON_R * 2 + 5
  const left = s.x - ((subs.length - 1) * gap) / 2
  const y = s.y - r - 22
  return subs.map((sub, i) => ({ x: left + i * gap, y, sub }))
}

/**
 * A sub-agent as a small icon: a dark disc with a mini tilted ring. Amber while it works, with a
 * satellite dot circling it, green when it finishes, red when it fails.
 */
function drawSubAgent(ctx: CanvasRenderingContext2D, x: number, y: number, sub: SubAgent, view: ViewState): void {
  const running = sub.status === 'running'
  const color = sub.status === 'error' ? FAILED_ROCK : running ? '#fbbf24' : '#34d399'
  const pulse = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now / 260)
  const R = SUB_ICON_R

  if (running) {
    ctx.fillStyle = withAlpha(color, 0.18 + 0.2 * pulse)
    ctx.beginPath()
    ctx.arc(x, y, R * 2, 0, TAU)
    ctx.fill()
  }
  ctx.fillStyle = withAlpha(CANVAS, 0.92)
  ctx.beginPath()
  ctx.arc(x, y, R, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = withAlpha(color, 0.95)
  ctx.lineWidth = 1.3
  ctx.stroke()

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(RING_TILT)
  ctx.strokeStyle = withAlpha(color, 0.9)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(0, 0, R * 0.85, R * 0.35, 0, 0, TAU)
  ctx.stroke()
  ctx.restore()

  if (running) {
    const a = view.reduced ? 0 : view.now / 180
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * (R + 3), y + Math.sin(a) * (R + 3), 1.2, 0, TAU)
    ctx.fill()
  }
}

/** Draws an agent's sub-agent icons above its planet, with a line naming what the newest running one is doing. */
function drawSubAgents(ctx: CanvasRenderingContext2D, agent: AgentSummary, s: { x: number; y: number }, r: number, view: ViewState, zoom: number): void {
  const icons = subAgentIcons(agent, s, r)
  if (icons.length === 0) return
  for (const icon of icons) drawSubAgent(ctx, icon.x, icon.y, icon.sub, view)

  if (zoom < 0.6) return
  const working = [...icons].reverse().find((i) => i.sub.status === 'running')
  if (!working) return
  const text = working.sub.detail || working.sub.name
  ctx.fillStyle = withAlpha(MUTED, 0.95)
  ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(text.length > 44 ? `${text.slice(0, 43)}…` : text, s.x, working.y - SUB_ICON_R - 5)
}

function drawRock(
  ctx: CanvasRenderingContext2D,
  k: Rock,
  planetScreen: { x: number; y: number },
  cam: Camera,
  w: number,
  h: number,
  view: ViewState,
): void {
  const s = worldToScreen(cam, w, h, k.x, k.y)
  if (!view.appearAt.has(k.key)) view.appearAt.set(k.key, view.now)
  const scale = Math.max(0.001, k.appear)
  const running = k.status === 'running'
  const failed = k.status === 'error'
  const color = failed ? FAILED_ROCK : TOOL_COLOR[k.kind]
  const pulse = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now / 260)

  // Orbit trail back to the planet, drawn faintly.
  ctx.strokeStyle = 'rgba(244,244,245,0.09)'
  ctx.beginPath()
  ctx.moveTo(planetScreen.x, planetScreen.y)
  ctx.lineTo(s.x, s.y)
  ctx.stroke()

  // A running command glows, so work in progress reads at a glance.
  const R = ROCK_RADIUS * scale
  if (running) {
    ctx.fillStyle = withAlpha(color, (0.22 + 0.2 * pulse) * scale)
    ctx.beginPath()
    ctx.arc(s.x, s.y, R * 2.4, 0, TAU)
    ctx.fill()
  }

  // An irregular stone: seven vertices with seeded radii, so each rock has its own shape.
  const rand = seeded(k.seed || 1)
  const verts = 7
  ctx.beginPath()
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * TAU
    const rr = R * (0.72 + 0.4 * rand())
    const px = s.x + Math.cos(a) * rr
    const py = s.y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  // Lit from the upper left, like the planets; a dark outline keeps it visible on the nebula.
  const grad = ctx.createRadialGradient(s.x - R * 0.35, s.y - R * 0.35, R * 0.1, s.x, s.y, R * 1.2)
  grad.addColorStop(0, withAlpha('#ffffff', 0.85 * scale))
  grad.addColorStop(0.45, withAlpha(color, 0.95 * scale))
  grad.addColorStop(1, withAlpha(mixHex(color, '#000000', 0.45), 0.95 * scale))
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = withAlpha('#0b0b10', 0.85 * scale)
  ctx.lineWidth = 1
  ctx.stroke()

  // The command's name under the rock, once zoomed in enough to read it.
  if (cam.zoom >= 0.6) {
    ctx.fillStyle = withAlpha(failed ? FAILED_ROCK : MUTED, scale)
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(k.name, s.x, s.y + R + 3)
  }
}

/** A faint, rounded dark pill behind a system's label. Kept very low-alpha so it reads as depth, not a box. */
function drawLabelBackdrop(ctx: CanvasRenderingContext2D, box: LabelBox): void {
  const x = box.x0 + 6
  const y = box.y0 - 2
  const width = box.x1 - box.x0 - 12
  const height = box.y1 - box.y0 + 4
  ctx.fillStyle = 'rgba(9,9,11,0.38)'
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 8)
  ctx.fill()
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.fillStyle = withAlpha(color, 0.92)
  ctx.beginPath()
  ctx.arc(x, y, 8, 0, TAU)
  ctx.fill()
  ctx.fillStyle = CANVAS
  ctx.font = '700 10px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
}

// ---- hit testing ------------------------------------------------------------------

/** Returns what is under a screen point. Topmost objects win: rocks, then planets, then suns. */
export function hitTest(view: ViewState, sx: number, sy: number): Hit | null {
  const { camera: cam, width: w, height: h, layout, agents } = view

  if (cam.zoom >= 0.35) {
    for (let i = layout.planets.length - 1; i >= 0; i--) {
      const p = layout.planets[i]
      const agent = agents.get(p.id)
      if (!agent) continue
      // Rocks orbit within ROCK_ORBIT of their planet. Build them only for planets the pointer is near.
      const c = planetScreen(view, p)
      if (Math.hypot(c.x - sx, c.y - sy) > (ROCK_ORBIT + 14) * cam.zoom + 8) continue
      // A sub-agent icon belongs to its planet, so clicking it selects the planet.
      const pc = planetScreen(view, p)
      for (const icon of subAgentIcons(agent, pc, Math.max(5, PLANET_RADIUS * cam.zoom))) {
        if (Math.hypot(icon.x - sx, icon.y - sy) <= SUB_ICON_R + 4) return { kind: 'planet', id: p.id }
      }
      for (const k of rocksFor(agent, p, view)) {
        const s = worldToScreen(cam, w, h, k.x, k.y)
        if (Math.hypot(s.x - sx, s.y - sy) <= ROCK_RADIUS + 4) {
          return { kind: 'rock', agentId: agent.id, name: k.name }
        }
      }
    }
  }

  for (let i = layout.planets.length - 1; i >= 0; i--) {
    const p = layout.planets[i]
    if (!agents.has(p.id)) continue
    const pos = planetPosition(p, view.t, cam.zoom)
    const s = worldToScreen(cam, w, h, pos.x, pos.y)
    const r = Math.max(9, PLANET_RADIUS * cam.zoom) + 6
    if (Math.hypot(s.x - sx, s.y - sy) <= r) return { kind: 'planet', id: p.id }
  }

  for (const sun of layout.suns) {
    const s = worldToScreen(cam, w, h, sun.x, sun.y)
    if (Math.hypot(s.x - sx, s.y - sy) <= 18) return { kind: 'sun', id: sun.id }
  }
  return null
}

/** Screen position of a planet now, for anchoring overlays. */
export function planetScreen(view: ViewState, planet: Planet): { x: number; y: number } {
  const pos = planetPosition(planet, view.t, view.camera.zoom)
  return worldToScreen(view.camera, view.width, view.height, pos.x, pos.y)
}

// ---- colour helpers -------------------------------------------------------------------

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  if (hex.startsWith('rgba') || hex.startsWith('rgb(')) return hex
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

export function statusLabel(status: Status, detail: string): string {
  const base = status.charAt(0).toUpperCase() + status.slice(1)
  if (!detail) return base
  return detail.length > 34 ? `${base} · ${detail.slice(0, 33)}…` : `${base} · ${detail}`
}
