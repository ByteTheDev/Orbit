import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { AgentSummary, Point, ProjectSummary, Status } from '../../types'
import { ACTIVE_STATUSES } from '../../types'
import { STATUS_COLOR } from '../../lib/theme'
import { fitPoints, screenToWorld, tweenAt, zoomAt, clampZoom, type Camera, type Tween } from '../../lib/universe/camera'
import { computeLayout, displayOrbit, planetPosition, systemBounds, worldToStored, type Layout } from '../../lib/universe/layout'
import { PULSE_MS, drawUniverse, hitTest, makeBackdrop, onLogoLoaded, planetScreen, type Hit, type Pulse, type ViewState } from '../../lib/universe/render'
import { setIconListener } from '../../lib/icons'
import { createGalaxy, type Galaxy } from '../../lib/universe/galaxyGL'
import { buildGalaxyField, type GalaxyField } from '../../lib/universe/galaxyShape'
import { HoverCard } from './HoverCard'

/** Milliseconds between frames while only idle planets are drifting (30 fps). Culling keeps this cheap. */
const IDLE_FRAME_MS = 33
const DRAG_THRESHOLD = 4
const FOCUS_MS = 650
/** Two clicks on the same star within this window count as a double-click. */
const DOUBLE_CLICK_MS = 380

export interface UniverseHandle {
  fit(): void
  focusAgent(agentId: string): void
  focusProject(projectId: string): void
  /** Frames a whole solar system. */
  focusSystem(projectId: string): void
  /** Leaves a focused solar system for the full galaxy. Returns false when no system was focused. */
  returnToGalaxy(): boolean
  zoomBy(factor: number): void
  pan(dx: number, dy: number): void
}

export interface UniverseProps {
  projects: ProjectSummary[]
  agents: AgentSummary[]
  selectedId: string | null
  reducedMotion: boolean
  /**
   * The active theme is light. The WebGL sky is dark space, so a light theme draws the 2D backdrop instead.
   * Read on mount only: the parent keys this component by theme, so a theme change remounts it.
   */
  lightTheme?: boolean
  onSelectAgent: (id: string | null) => void
  onSelectProject: (projectId: string) => void
  /** A double-click on a planet asks for that agent's conversation in focus mode. */
  onEnterFocus: (agentId: string) => void
  onOpenMenu: (agentId: string, x: number, y: number) => void
  onOpenProjectMenu: (projectId: string, x: number, y: number) => void
  onMovePlanet: (agentId: string, x: number, y: number) => void
}

/**
 * What the camera last framed. When the canvas changes size (the chat panel is resized or
 * focus mode hides the galaxy), the camera re-frames the same target, so planets are not cut off.
 */
type Anchor = { kind: 'galaxy' } | { kind: 'agent' | 'project' | 'system'; id: string }

interface DragState {
  pointerId: number
  mode: 'planet' | 'pan'
  agentId?: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
  hit: Hit | null
}

export const Universe = forwardRef<UniverseHandle, UniverseProps>(function Universe(props, ref) {
  const { projects, agents, selectedId, reducedMotion } = props
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const tweenRef = useRef<Tween | null>(null)
  const layoutRef = useRef<Layout>(computeLayout([], [], new Map(), 0))
  const agentsRef = useRef<Map<string, AgentSummary>>(new Map())
  const projectsRef = useRef<Map<string, ProjectSummary>>(new Map())
  const overridesRef = useRef<Map<string, Point>>(new Map())
  const pulsesRef = useRef<Pulse[]>([])
  const appearRef = useRef<Map<string, number>>(new Map())
  const prevStatusRef = useRef<Map<string, Status>>(new Map())
  const backdropRef = useRef<HTMLCanvasElement | null>(null)
  const galaxyRef = useRef<Galaxy | null>(null)
  useEffect(() => {
    galaxyRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])
  const startRef = useRef(performance.now())
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const fittedRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const hoverIdRef = useRef<string | null>(null)
  const lastSunClickRef = useRef<{ id: string; at: number } | null>(null)
  const lastPlanetClickRef = useRef<{ id: string; at: number } | null>(null)
  const anchorRef = useRef<Anchor>({ kind: 'galaxy' })
  const fieldRef = useRef<GalaxyField | null>(null)
  const fieldKeyRef = useRef<string | null>(null)
  /** The solar system the camera is framing, or null while showing the whole galaxy. */
  const focusedSystemRef = useRef<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const timeAt = useCallback((now: number) => (propsRef.current.reducedMotion ? 0 : (now - startRef.current) / 1000), [])

  const buildView = useCallback(
    (now: number): ViewState => {
      const { w, h, dpr } = sizeRef.current
      return {
        width: w,
        height: h,
        dpr,
        camera: cameraRef.current,
        layout: layoutRef.current,
        agents: agentsRef.current,
        projects: projectsRef.current,
        selectedId: propsRef.current.selectedId,
        hoverId: hoverIdRef.current,
        t: timeAt(now),
        now,
        reduced: propsRef.current.reducedMotion,
        pulses: pulsesRef.current,
        appearAt: appearRef.current,
      }
    },
    [timeAt],
  )

  // ---- scheduling -------------------------------------------------------------

  const frameRef = useRef<(now: number) => void>(() => {})

  const schedule = useCallback((delay: number) => {
    if (document.hidden) return
    if (delay <= 0) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = 0
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame((now) => frameRef.current(now))
      return
    }
    if (rafRef.current || timerRef.current) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      if (!rafRef.current) rafRef.current = requestAnimationFrame((now) => frameRef.current(now))
    }, delay)
  }, [])

  const requestDraw = useCallback(() => schedule(0), [schedule])

  useEffect(() => {
    frameRef.current = (now: number) => {
      rafRef.current = 0
      const { w, h } = sizeRef.current
      const canvas = canvasRef.current
      if (!canvas || w === 0 || h === 0) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      if (tweenRef.current) {
        const r = tweenAt(tweenRef.current, now)
        cameraRef.current = r.camera
        if (r.done) tweenRef.current = null
      }

      const view = buildView(now)
      galaxyRef.current?.setView({ camX: view.camera.x, camY: view.camera.y, zoom: view.camera.zoom })
      drawUniverse(ctx, view, backdropRef.current)
      updateHoverCard(view)

      pulsesRef.current = pulsesRef.current.filter((p) => now - p.start < PULSE_MS)
      let appearing = false
      appearRef.current.forEach((at) => {
        if (now - at < 420) appearing = true
      })

      const reduced = propsRef.current.reducedMotion
      let active = false
      agentsRef.current.forEach((a) => {
        if (a.running || ACTIVE_STATUSES.includes(a.status)) active = true
      })
      const animating = !!tweenRef.current || pulsesRef.current.length > 0 || appearing || (active && !reduced)
      if (animating) schedule(0)
      else if (!reduced && agentsRef.current.size > 0) schedule(IDLE_FRAME_MS)
    }
  }, [buildView, schedule])

  // ---- hover card -------------------------------------------------------------------

  const updateHoverCard = (view: ViewState) => {
    const el = hoverCardRef.current
    if (!el) return
    const id = hoverIdRef.current
    const planet = id ? view.layout.planetById.get(id) : undefined
    if (!planet) {
      el.style.opacity = '0'
      return
    }
    const s = planetScreen(view, planet)
    el.style.opacity = '1'
    el.style.transform = `translate3d(${Math.round(s.x + 26)}px, ${Math.round(s.y - 18)}px, 0)`
  }

  // ---- layout & data ----------------------------------------------------------------

  useEffect(() => {
    agentsRef.current = new Map(agents.map((a) => [a.id, a]))
    projectsRef.current = new Map(projects.map((p) => [p.id, p]))
    for (const id of [...overridesRef.current.keys()]) {
      if (!agentsRef.current.has(id)) overridesRef.current.delete(id)
    }
    const t0 = timeAt(performance.now())
    layoutRef.current = computeLayout(projects, agents, overridesRef.current, t0, layoutRef.current, dragRef.current?.moved ? dragRef.current.agentId : undefined)

    // The galactic structure depends on where the suns are, not on agents, so rebuild it only when they move.
    const sunKey = layoutRef.current.suns.map((s) => `${s.id}:${Math.round(s.x)},${Math.round(s.y)}`).join('|')
    if (sunKey !== fieldKeyRef.current) {
      fieldKeyRef.current = sunKey
      fieldRef.current = buildGalaxyField(layoutRef.current.suns)
      galaxyRef.current?.setField(fieldRef.current)
    }

    // A finished or failed run pulses once, so the outcome is noticed without a modal.
    if (!reducedMotion) {
      const now = performance.now()
      for (const a of agents) {
        const prev = prevStatusRef.current.get(a.id)
        if (prev && prev !== a.status && (a.status === 'completed' || a.status === 'failed')) {
          const planet = layoutRef.current.planetById.get(a.id)
          if (planet) {
            const pos = planetPosition(planet, t0)
            pulsesRef.current.push({ x: pos.x, y: pos.y, color: STATUS_COLOR[a.status], start: now })
          }
        }
      }
    }
    prevStatusRef.current = new Map(agents.map((a) => [a.id, a.status]))

    if (!fittedRef.current && projects.length > 0 && sizeRef.current.w > 0) {
      fitNow(false)
      fittedRef.current = true
    }
    if (hoverIdRef.current && !agentsRef.current.has(hoverIdRef.current)) {
      hoverIdRef.current = null
      setHoverId(null)
    }
    requestDraw()
    // fitNow is stable enough; it reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, projects, reducedMotion, requestDraw, timeAt])

  // Keep the selected planet highlighted and redraw when selection changes.
  useEffect(() => {
    requestDraw()
  }, [selectedId, requestDraw])

  // Redraw when an uploaded project icon or a provider's brand image finishes loading.
  useEffect(() => {
    setIconListener(requestDraw)
    const unsubscribeLogos = onLogoLoaded(requestDraw)
    return () => {
      setIconListener(null)
      unsubscribeLogos()
    }
  }, [requestDraw])

  // ---- camera ----------------------------------------------------------------------

  // The camera targets below are computed from refs only, so reframe() can call them from the resize observer.

  const galaxyCamera = (): Camera => {
    const { w, h } = sizeRef.current
    const points = [
      ...layoutRef.current.suns.flatMap((s) => [
        { x: s.x - s.reach, y: s.y - s.reach },
        { x: s.x + s.reach, y: s.y + s.reach },
      ]),
      ...layoutRef.current.planets.map((p) => planetPosition(p, timeAt(performance.now()))),
    ]
    return fitPoints(points, w, h, 140)
  }

  const fitNow = (animate: boolean) => {
    focusedSystemRef.current = null
    anchorRef.current = { kind: 'galaxy' }
    startTween(galaxyCamera(), animate ? 500 : 0)
  }

  /** Frames a planet's whole orbit, centred on its sun, so the star and the neighbouring planets stay in context. */
  const agentCamera = (id: string): Camera | null => {
    const planet = layoutRef.current.planetById.get(id)
    if (!planet) return null
    // The zoom is capped: focus never zooms in past a readable level, and never out to a blur.
    const { w, h } = sizeRef.current
    const R = displayOrbit(planet, 1)
    const pos = planetPosition(planet, timeAt(performance.now()))
    const orbit = [
      { x: planet.sunX - R, y: planet.sunY - R },
      { x: planet.sunX + R, y: planet.sunY + R },
      pos,
    ]
    const fit = fitPoints(orbit, w, h, 110)
    return { x: fit.x, y: fit.y, zoom: clampZoom(Math.min(Math.max(fit.zoom, 0.9), 1.6)) }
  }

  const projectCamera = (projectId: string): Camera | null => {
    const sun = layoutRef.current.sunById.get(projectId)
    if (!sun) return null
    return { x: sun.x, y: sun.y, zoom: clampZoom(Math.max(cameraRef.current.zoom, 0.8)) }
  }

  const systemCamera = (projectId: string): Camera | null => {
    const sun = layoutRef.current.sunById.get(projectId)
    if (!sun) return null
    const { w, h } = sizeRef.current
    return fitPoints(systemBounds(sun), w, h, 90)
  }

  /** Re-applies the last framing for the current canvas size. Duration 0 snaps, so a live resize tracks the panel. */
  const reframe = (duration: number) => {
    const a = anchorRef.current
    const cam = a.kind === 'galaxy' ? galaxyCamera() : a.kind === 'agent' ? agentCamera(a.id) : a.kind === 'project' ? projectCamera(a.id) : systemCamera(a.id)
    if (cam) startTween(cam, duration)
  }

  const startTween = (to: Camera, duration: number) => {
    const from = cameraRef.current
    if (duration <= 0 || propsRef.current.reducedMotion) {
      cameraRef.current = to
      tweenRef.current = null
    } else {
      tweenRef.current = { from: { ...from }, to, start: performance.now(), duration }
    }
    requestDraw()
  }

  const focusAgent = (id: string) => {
    const cam = agentCamera(id)
    if (!cam) return
    anchorRef.current = { kind: 'agent', id }
    startTween(cam, FOCUS_MS)
  }

  const focusProject = (projectId: string) => {
    const cam = projectCamera(projectId)
    if (!cam) return
    anchorRef.current = { kind: 'project', id: projectId }
    startTween(cam, FOCUS_MS)
  }

  const focusSystem = (projectId: string) => {
    const cam = systemCamera(projectId)
    if (!cam) return
    focusedSystemRef.current = projectId
    anchorRef.current = { kind: 'system', id: projectId }
    startTween(cam, FOCUS_MS)
  }

  useImperativeHandle(
    ref,
    () => ({
      fit: () => fitNow(true),
      focusAgent,
      focusProject,
      focusSystem,
      returnToGalaxy: () => {
        if (!focusedSystemRef.current) return false
        fitNow(true)
        return true
      },
      zoomBy: (factor: number) => {
        const { w, h } = sizeRef.current
        tweenRef.current = null
        cameraRef.current = zoomAt(cameraRef.current, w, h, w / 2, h / 2, factor)
        requestDraw()
      },
      pan: (dx: number, dy: number) => {
        tweenRef.current = null
        const cam = cameraRef.current
        cameraRef.current = { ...cam, x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom }
        requestDraw()
      },
    }),
    // Handle methods read refs only, so they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestDraw],
  )

  // ---- sizing, visibility, input ---------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const galaxy = propsRef.current.lightTheme ? null : createGalaxy(container)
    galaxyRef.current = galaxy
    galaxy?.setField(fieldRef.current)
    galaxy?.setReducedMotion(propsRef.current.reducedMotion)

    const resize = () => {
      const rect = container.getBoundingClientRect()
      // A hidden galaxy (focus mode) reports no size. Keep the last real size instead of collapsing to 1px.
      if (rect.width < 1 || rect.height < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(rect.width))
      const h = Math.max(1, Math.floor(rect.height))
      const prev = sizeRef.current
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      // With the WebGL galaxy behind the canvas, the 2D backdrop is not needed.
      galaxyRef.current?.resize(w, h, dpr)
      backdropRef.current = galaxyRef.current ? null : makeBackdrop(w, h, dpr)
      if (!fittedRef.current && projectsRef.current.size > 0) {
        fitNow(false)
        fittedRef.current = true
      } else if (prev.w > 0 && (prev.w !== w || prev.h !== h)) {
        // The chat panel moved or the window changed size: scale and re-centre on the same target, without a tween.
        reframe(0)
      }
      requestDraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const onVisibility = () => {
      if (!document.hidden) requestDraw()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const p = local(e)
      const view = buildView(performance.now())
      const hit = hitTest(view, p.x, p.y)
      const mode: DragState['mode'] = hit?.kind === 'planet' ? 'planet' : 'pan'
      dragRef.current = {
        pointerId: e.pointerId,
        mode,
        agentId: hit?.kind === 'planet' ? hit.id : undefined,
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        hit,
      }
      canvas.setPointerCapture(e.pointerId)
      tweenRef.current = null
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      const drag = dragRef.current
      if (!drag) {
        const view = buildView(performance.now())
        const hit = hitTest(view, p.x, p.y)
        const next = hit?.kind === 'planet' ? hit.id : null
        canvas.style.cursor = hit ? (hit.kind === 'planet' ? 'grab' : 'pointer') : 'default'
        if (next !== hoverIdRef.current) {
          hoverIdRef.current = next
          setHoverId(next)
          requestDraw()
        }
        return
      }

      const dx = p.x - drag.lastX
      const dy = p.y - drag.lastY
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < DRAG_THRESHOLD) return
      drag.moved = true
      drag.lastX = p.x
      drag.lastY = p.y
      const { w, h } = sizeRef.current

      if (drag.mode === 'planet' && drag.agentId) {
        canvas.style.cursor = 'grabbing'
        const world = screenToWorld(cameraRef.current, w, h, p.x, p.y)
        overridesRef.current.set(drag.agentId, world)
        layoutRef.current = computeLayout(
          [...projectsRef.current.values()],
          [...agentsRef.current.values()],
          overridesRef.current,
          timeAt(performance.now()),
          layoutRef.current,
          drag.agentId,
        )
      } else {
        canvas.style.cursor = 'grabbing'
        const cam = cameraRef.current
        cameraRef.current = { ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom }
      }
      requestDraw()
    }

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      dragRef.current = null
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      canvas.style.cursor = 'default'

      if (drag.moved && drag.mode === 'planet' && drag.agentId) {
        const world = overridesRef.current.get(drag.agentId)
        // Saved positions are in the frame the suns were first placed in, so convert before persisting.
        const projectId = agentsRef.current.get(drag.agentId)?.projectId
        const sun = projectId ? layoutRef.current.sunById.get(projectId) : undefined
        if (world && sun) {
          const stored = worldToStored(sun, world)
          propsRef.current.onMovePlanet(drag.agentId, stored.x, stored.y)
        }
        return
      }
      if (drag.moved) return

      const hit = drag.hit
      if (!hit) {
        propsRef.current.onSelectAgent(null)
      } else if (hit.kind === 'planet') {
        // A second click on the same planet within the window opens its conversation in focus mode.
        const now = performance.now()
        const last = lastPlanetClickRef.current
        if (last && last.id === hit.id && now - last.at < DOUBLE_CLICK_MS) {
          lastPlanetClickRef.current = null
          propsRef.current.onEnterFocus(hit.id)
          return
        }
        lastPlanetClickRef.current = { id: hit.id, at: now }
        focusAgent(hit.id)
        propsRef.current.onSelectAgent(hit.id)
      } else if (hit.kind === 'rock') {
        propsRef.current.onSelectAgent(hit.agentId)
      } else {
        propsRef.current.onSelectProject(hit.id)
        // A second click on the same star within the window enters its solar system.
        const now = performance.now()
        const last = lastSunClickRef.current
        if (last && last.id === hit.id && now - last.at < DOUBLE_CLICK_MS) {
          lastSunClickRef.current = null
          focusSystem(hit.id)
        } else {
          lastSunClickRef.current = { id: hit.id, at: now }
          focusProject(hit.id)
        }
      }
    }

    const onLeave = () => {
      if (hoverIdRef.current) {
        hoverIdRef.current = null
        setHoverId(null)
        requestDraw()
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      const scale = e.deltaMode === 1 ? 16 : 1
      const factor = Math.exp(-e.deltaY * scale * 0.0016)
      const { w, h } = sizeRef.current
      tweenRef.current = null
      cameraRef.current = zoomAt(cameraRef.current, w, h, p.x, p.y, factor)
      requestDraw()
    }

    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      const p = local(e)
      const hit = hitTest(buildView(performance.now()), p.x, p.y)
      if (hit?.kind === 'planet') propsRef.current.onOpenMenu(hit.id, e.clientX, e.clientY)
      else if (hit?.kind === 'sun') propsRef.current.onOpenProjectMenu(hit.id, e.clientX, e.clientY)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContext)

    return () => {
      ro.disconnect()
      galaxy?.destroy()
      galaxyRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContext)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      rafRef.current = 0
      timerRef.current = 0
    }
    // Listeners read current values through refs and propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildView, requestDraw, timeAt])

  const hoverAgent = hoverId ? agents.find((a) => a.id === hoverId) : undefined

  return (
    <div ref={containerRef} className="universe relative h-full w-full overflow-hidden" role="application" aria-label="Agent universe">
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden="true" />
      <HoverCard ref={hoverCardRef} agent={hoverAgent} />
    </div>
  )
})
