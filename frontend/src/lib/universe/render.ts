// Canvas renderer and hit-testing for the universe. Drawing reads from a view
// snapshot and has no side effects, which keeps frames cheap and testable.
//
// Cost model: each planet's body (surface, bands, craters, atmosphere, rings) is drawn
// once into a cached sprite. Per frame a planet costs one drawImage, a directional
// lighting overlay that follows its sun, and its status and selection marks.
import type { AgentSummary, FileActivity, ProjectSummary, Status } from '../../types'
import { DEFAULT_BODY, PROVIDER_BODY, STATUS_COLOR, type PlanetBody } from '../theme'
import { worldToScreen, type Camera } from './camera'
import { planetPosition, type Layout, type Planet } from './layout'
import { projectIconImage } from '../icons'
import { identityFor } from '../projectIdentity'

const PLANET_RADIUS = 22 // world units: large enough that surface detail reads at fit zoom
const SUN_RADIUS = 34 // world units: the star body, sized so its surface still reads when zoomed out
const MOON_ORBIT = 44
const MAX_MOONS = 7
const TAU = Math.PI * 2
const RING_TILT = -0.32
export const PULSE_MS = 900

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

export interface Moon {
  key: string
  agentId: string
  /** null for the "+N more" cluster. */
  path: string | null
  state: string
  x: number
  y: number
  count: number
  appear: number
}

export type Hit =
  | { kind: 'planet'; id: string }
  | { kind: 'moon'; agentId: string; path: string | null; count: number }
  | { kind: 'sun'; id: string }

// ---- moons ------------------------------------------------------------------

/**
 * Miniature planets for the files an agent touched. Active files come first;
 * when there are more than fit, the rest collapse into one "+N" moon.
 */
export function moonsFor(agent: AgentSummary, planet: Planet, view: ViewState): Moon[] {
  const files = agent.recentFiles ?? []
  if (files.length === 0) return []
  const active = files.filter((f) => f.state !== 'recent')
  const recent = files.filter((f) => f.state === 'recent')
  const ordered = [...active, ...recent]
  const overflow = ordered.length > MAX_MOONS ? ordered.length - (MAX_MOONS - 1) : 0
  const shown: (FileActivity | null)[] = overflow > 0 ? ordered.slice(0, MAX_MOONS - 1) : ordered
  if (overflow > 0) shown.push(null)

  const center = planetPosition(planet, view.t)
  const moons: Moon[] = []
  shown.forEach((f, i) => {
    const state = f ? f.state : 'cluster'
    const lane = i % 2 === 0 ? 0 : 1
    const radius = MOON_ORBIT + lane * 9 + (state === 'writing' ? 3 : 0)
    const speed = (state === 'writing' ? 0.9 : state === 'reading' ? 0.5 : 0.22) * (lane === 0 ? 1 : -1)
    const base = (i / shown.length) * Math.PI * 2 + hashAngle(f?.path ?? 'more')
    const a = base + (view.reduced ? 0 : speed * view.t)
    const appearKey = `${agent.id}|${f?.path ?? 'more'}`
    const seen = view.appearAt.get(appearKey)
    const appear = seen === undefined ? 0 : easeOut(Math.min(1, (view.now - seen) / 380))
    moons.push({
      key: appearKey,
      agentId: agent.id,
      path: f ? f.path : null,
      state,
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
      count: f ? 1 : overflow,
      appear,
    })
  })
  return moons
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
    const r = p.radius * cam.zoom
    if (!onScreen(sun, r + 4, w, h)) continue
    const selected = p.id === view.selectedId
    ctx.lineWidth = selected ? 1 : 0.6
    ctx.setLineDash(selected ? [] : [1.5, 5])
    ctx.strokeStyle = selected ? 'rgba(244,244,245,0.42)' : 'rgba(244,244,245,0.13)'
    ctx.beginPath()
    ctx.arc(sun.x, sun.y, r, 0, TAU)
    ctx.stroke()
  }
  ctx.setLineDash([])

  for (const sun of layout.suns) {
    const s = worldToScreen(cam, w, h, sun.x, sun.y)
    if (!onScreen(s, 260, w, h)) continue
    drawSun(ctx, s.x, s.y, identityFor(sun.id).accent, cam.zoom, view.now, view.reduced)
    const project = view.projects.get(sun.id)
    const label = project?.name ?? sun.name
    const labelY = s.y + Math.max(8, SUN_RADIUS * cam.zoom) + 8
    ctx.font = '600 12px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(244,244,245,0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (project) drawProjectBadge(ctx, s.x - ctx.measureText(label).width / 2 - 14, labelY + 7, project)
    ctx.fillText(label, s.x, labelY)
    if (project && project.conflicts.length > 0) {
      drawBadge(ctx, s.x + ctx.measureText(label).width / 2 + 12, labelY + 8, `${project.conflicts.length}`, '#f59e0b')
    }
    if (project && project.agentCount === 0) {
      ctx.font = '11px "Segoe UI", system-ui, sans-serif'
      ctx.fillStyle = MUTED
      ctx.fillText('No agents yet', s.x, labelY + 18)
    }
  }

  for (const p of layout.planets) {
    const agent = agents.get(p.id)
    if (!agent) continue
    const pos = planetPosition(p, view.t)
    const s = worldToScreen(cam, w, h, pos.x, pos.y)
    // Off-screen planets cost nothing: their sprite, lighting and labels are skipped.
    if (!onScreen(s, MOON_ORBIT * cam.zoom + 60, w, h)) continue
    const sunS = worldToScreen(cam, w, h, p.sunX, p.sunY)
    const r = Math.max(5, PLANET_RADIUS * cam.zoom)

    if (cam.zoom >= 0.35) {
      for (const m of moonsFor(agent, p, view)) drawMoon(ctx, m, s, cam, w, h, view)
    }
    drawPlanet(ctx, agent, sunS, s, r, view)
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

/** True when a disc of radius `pad` around a screen point touches the canvas. */
function onScreen(p: { x: number; y: number }, pad: number, w: number, h: number): boolean {
  return p.x + pad >= 0 && p.x - pad <= w && p.y + pad >= 0 && p.y - pad <= h
}

/**
 * The galaxy layer. A faint haze covers every project, and each project is a universe:
 * a soft disc sized to its outermost orbit, headed by its name and agent counts.
 * Drawn under the orbits, so suns and planets stay the focus.
 */
function drawGalaxy(ctx: CanvasRenderingContext2D, view: ViewState): void {
  const { width: w, height: h, camera: cam, layout, projects } = view
  if (layout.suns.length === 0) return

  if (layout.suns.length > 1) {
    let cx = 0
    let cy = 0
    for (const sun of layout.suns) {
      cx += sun.x
      cy += sun.y
    }
    cx /= layout.suns.length
    cy /= layout.suns.length
    let extent = 0
    for (const sun of layout.suns) extent = Math.max(extent, Math.hypot(sun.x - cx, sun.y - cy) + sun.reach)
    const g = worldToScreen(cam, w, h, cx, cy)
    const R = extent * cam.zoom
    const haze = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R)
    haze.addColorStop(0, 'rgba(244,244,245,0.035)')
    haze.addColorStop(1, 'rgba(244,244,245,0)')
    ctx.fillStyle = haze
    ctx.beginPath()
    ctx.arc(g.x, g.y, R, 0, TAU)
    ctx.fill()
  }

  for (const sun of layout.suns) {
    const s = worldToScreen(cam, w, h, sun.x, sun.y)
    const R = sun.reach * cam.zoom
    if (R < 8 || !onScreen(s, R, w, h)) continue
    const project = projects.get(sun.id)

    const disc = ctx.createRadialGradient(s.x, s.y, R * 0.3, s.x, s.y, R)
    disc.addColorStop(0, withAlpha(identityFor(sun.id).accent, 0.012))
    disc.addColorStop(0.85, withAlpha(identityFor(sun.id).accent, 0.022))
    disc.addColorStop(1, withAlpha(identityFor(sun.id).accent, 0))
    ctx.fillStyle = disc
    ctx.beginPath()
    ctx.arc(s.x, s.y, R, 0, TAU)
    ctx.fill()

    ctx.setLineDash([1, 7])
    ctx.strokeStyle = withAlpha(identityFor(sun.id).accent, 0.1)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(s.x, s.y, R, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])

    if (project) {
      const running = project.runningCount > 0 ? ` · ${project.runningCount} running` : ''
      const agentsText = `${project.agentCount} agent${project.agentCount === 1 ? '' : 's'}`
      ctx.font = '600 11px "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = withAlpha(identityFor(sun.id).accent, 0.85)
      ctx.fillText(`${project.name.toUpperCase()}  ·  ${agentsText}${running}`, s.x, s.y - R - 6)
    }
  }
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
  g.beginPath()
  g.arc(cx, cx, r, 0, TAU)
  g.clip()

  // Body: hottest a little up and to the left, cooling toward the limb.
  const hot = mixHex(accent, '#ffffff', 0.7)
  const warm = mixHex(accent, '#ffffff', 0.3)
  const cool = mixHex(accent, '#000000', 0.45)
  const body = g.createRadialGradient(cx - r * 0.26, cx - r * 0.3, r * 0.04, cx, cx, r)
  body.addColorStop(0, withAlpha(hot, 1))
  body.addColorStop(0.38, withAlpha(warm, 1))
  body.addColorStop(0.72, withAlpha(accent, 1))
  body.addColorStop(1, withAlpha(cool, 1))
  g.fillStyle = body
  g.fillRect(0, 0, side, side)

  // Granulation: small convection cells, drawn with a seeded PRNG so every star of one accent matches.
  const rand = seeded(hashString(accent))
  for (let i = 0; i < 260; i++) {
    const a = rand() * TAU
    const d = Math.sqrt(rand()) * r * 0.94
    const rad = r * (0.02 + rand() * 0.05)
    const lit = rand() < 0.55
    g.fillStyle = lit ? `rgba(255,255,255,${(0.05 + rand() * 0.08).toFixed(3)})` : `rgba(0,0,0,${(0.05 + rand() * 0.1).toFixed(3)})`
    g.beginPath()
    g.arc(cx + Math.cos(a) * d, cx + Math.sin(a) * d, rad, 0, TAU)
    g.fill()
  }

  // A few darker spots, as sunspots are.
  for (let i = 0; i < 3; i++) {
    const a = rand() * TAU
    const d = r * (0.2 + rand() * 0.45)
    const sx = cx + Math.cos(a) * d
    const sy = cx + Math.sin(a) * d
    const sr = r * (0.05 + rand() * 0.05)
    const spot = g.createRadialGradient(sx, sy, 0, sx, sy, sr)
    spot.addColorStop(0, 'rgba(0,0,0,0.26)')
    spot.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = spot
    g.beginPath()
    g.arc(sx, sy, sr, 0, TAU)
    g.fill()
  }

  // Limb darkening: the edge of a star is cooler and dimmer than its face.
  const limb = g.createRadialGradient(cx, cx, r * 0.7, cx, cx, r)
  limb.addColorStop(0, 'rgba(0,0,0,0)')
  limb.addColorStop(1, 'rgba(0,0,0,0.42)')
  g.fillStyle = limb
  g.fillRect(0, 0, side, side)

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
  const bloom = Math.max(core * 5.5, 84 * zoom)
  const glow = ctx.createRadialGradient(x, y, 0, x, y, bloom)
  glow.addColorStop(0, withAlpha(accent, 0.3 * breath))
  glow.addColorStop(0.22, withAlpha(accent, 0.1 * breath))
  glow.addColorStop(1, withAlpha(accent, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, bloom, 0, TAU)
  ctx.fill()

  const corona = core * 2.3
  const halo = ctx.createRadialGradient(x, y, core * 0.6, x, y, corona)
  halo.addColorStop(0, withAlpha(SUN_CORE, 0.36 * breath))
  halo.addColorStop(0.45, withAlpha(accent, 0.2 * breath))
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
 * The project's symbol, set beside its name: the uploaded icon if there is one, otherwise the
 * custom letter, otherwise the project's glyph. Centred on (x, y), at the left edge of the label.
 */
function drawProjectBadge(ctx: CanvasRenderingContext2D, x: number, y: number, project: ProjectSummary): void {
  const identity = identityFor(project.id)
  const size = 14
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
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = identity.accent
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(identity.glyphPath))
  ctx.restore()
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

  // The cached body: atmosphere, back ring, surface, front ring.
  const sprite = planetSprite(agent, body, view.dpr)
  const scale = r / SPRITE_R
  const half = SPRITE_EXTENT * scale
  ctx.drawImage(sprite, s.x - half, s.y - half, half * 2, half * 2)

  // Lighting from the sun: shadow falls away from the light, a soft specular sits toward it.
  if (r >= 6) drawLighting(ctx, s.x, s.y, r, lx, ly, body.glow)

  // Status ring. Its style carries the state even without colour.
  const ringR = r + 5
  ctx.lineWidth = status === 'idle' ? 1.2 : 2
  ctx.strokeStyle = withAlpha(color, status === 'idle' ? 0.6 : status === 'thinking' ? 0.7 + 0.3 * pulse : 1)
  if (status === 'waiting' || status === 'stopped') ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.arc(s.x, s.y, ringR, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([])

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

  if (status === 'failed' && r >= 7) {
    ctx.fillStyle = STATUS_COLOR.failed
    ctx.beginPath()
    ctx.arc(s.x + r * 0.72, s.y - r * 0.72, Math.max(3, r * 0.3), 0, TAU)
    ctx.fill()
  }

  // Labels: always for the selected or hovered planet, and for the rest when zoomed in.
  if (selected || hovered || view.camera.zoom >= 0.85) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = '600 12px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = selected || hovered ? INK : 'rgba(244,244,245,0.82)'
    ctx.fillText(agent.name, s.x, s.y + ringR + 9)
    ctx.font = '11px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = withAlpha(color, 0.92)
    ctx.fillText(statusLabel(status, agent.statusDetail), s.x, s.y + ringR + 25)
  }
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

function drawMoon(
  ctx: CanvasRenderingContext2D,
  m: Moon,
  planetScreen: { x: number; y: number },
  cam: Camera,
  w: number,
  h: number,
  view: ViewState,
): void {
  const s = worldToScreen(cam, w, h, m.x, m.y)
  if (!view.appearAt.has(m.key)) view.appearAt.set(m.key, view.now)
  const scale = Math.max(0.001, m.appear)
  const color = m.state === 'cluster' ? MUTED : STATUS_COLOR[m.state === 'writing' ? 'writing' : m.state === 'reading' ? 'reading' : 'idle']
  const pulse = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now / 260)

  // Orbit trail back to the planet, drawn faintly.
  ctx.strokeStyle = 'rgba(244,244,245,0.07)'
  ctx.beginPath()
  ctx.moveTo(planetScreen.x, planetScreen.y)
  ctx.lineTo(s.x, s.y)
  ctx.stroke()

  if (m.state === 'cluster') {
    ctx.fillStyle = MUTED
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`+${m.count}`, s.x, s.y)
    return
  }

  const r = (m.state === 'writing' ? 4.2 + 1.2 * pulse : m.state === 'reading' ? 3.6 : 2.8) * scale
  if (m.state === 'writing') {
    ctx.fillStyle = withAlpha(color, (0.2 + 0.18 * pulse) * scale)
    ctx.beginPath()
    ctx.arc(s.x, s.y, r * 2.6, 0, TAU)
    ctx.fill()
  }
  // A tiny lit sphere: a highlight toward the upper left gives moons the same material as planets.
  const grad = ctx.createRadialGradient(s.x - r * 0.35, s.y - r * 0.35, r * 0.1, s.x, s.y, r)
  grad.addColorStop(0, withAlpha('#ffffff', (m.state === 'recent' ? 0.5 : 0.95) * scale))
  grad.addColorStop(1, withAlpha(color, (m.state === 'recent' ? 0.4 : 0.85) * scale))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(s.x, s.y, r, 0, TAU)
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

/** Returns what is under a screen point. Topmost objects win: moons, then planets, then suns. */
export function hitTest(view: ViewState, sx: number, sy: number): Hit | null {
  const { camera: cam, width: w, height: h, layout, agents } = view

  if (cam.zoom >= 0.35) {
    for (let i = layout.planets.length - 1; i >= 0; i--) {
      const p = layout.planets[i]
      const agent = agents.get(p.id)
      if (!agent) continue
      // Moons orbit within MOON_ORBIT of their planet. Build them only for planets the pointer is near.
      const c = planetScreen(view, p)
      if (Math.hypot(c.x - sx, c.y - sy) > (MOON_ORBIT + 14) * cam.zoom + 8) continue
      for (const m of moonsFor(agent, p, view)) {
        const s = worldToScreen(cam, w, h, m.x, m.y)
        if (Math.hypot(s.x - sx, s.y - sy) <= 8) {
          return { kind: 'moon', agentId: agent.id, path: m.path, count: m.count }
        }
      }
    }
  }

  for (let i = layout.planets.length - 1; i >= 0; i--) {
    const p = layout.planets[i]
    if (!agents.has(p.id)) continue
    const pos = planetPosition(p, view.t)
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
  const pos = planetPosition(planet, view.t)
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
