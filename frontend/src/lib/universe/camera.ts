// Camera math for the universe. The camera is a world point at the centre of the
// canvas plus a zoom factor. Zoom is about the cursor, so the point under the
// pointer stays put.
import type { Point } from '../../types'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.12
export const MAX_ZOOM = 2.6

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export function worldToScreen(cam: Camera, w: number, h: number, x: number, y: number): Point {
  return { x: (x - cam.x) * cam.zoom + w / 2, y: (y - cam.y) * cam.zoom + h / 2 }
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): Point {
  return { x: (sx - w / 2) / cam.zoom + cam.x, y: (sy - h / 2) / cam.zoom + cam.y }
}

export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number): Camera {
  const zoom = clampZoom(cam.zoom * factor)
  const before = screenToWorld(cam, w, h, sx, sy)
  // Solve for the camera position that keeps `before` under (sx, sy) at the new zoom.
  const x = before.x - (sx - w / 2) / zoom
  const y = before.y - (sy - h / 2) / zoom
  return { x, y, zoom }
}

/** Camera that shows every point with padding, at a zoom that fits. */
export function fitPoints(points: Point[], w: number, h: number, pad = 120): Camera {
  if (points.length === 0 || w <= 0 || h <= 0) return { x: 0, y: 0, zoom: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const spanX = Math.max(1, maxX - minX) + pad * 2
  const spanY = Math.max(1, maxY - minY) + pad * 2
  const zoom = clampZoom(Math.min(w / spanX, h / spanY, 1.2))
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }
}

export interface Tween {
  from: Camera
  to: Camera
  start: number
  duration: number
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Returns the camera at time now, and whether the tween has finished. */
export function tweenAt(tw: Tween, now: number): { camera: Camera; done: boolean } {
  if (tw.duration <= 0) return { camera: tw.to, done: true }
  const t = Math.min(1, (now - tw.start) / tw.duration)
  const e = easeOutCubic(t)
  return {
    camera: {
      x: tw.from.x + (tw.to.x - tw.from.x) * e,
      y: tw.from.y + (tw.to.y - tw.from.y) * e,
      zoom: tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e,
    },
    done: t >= 1,
  }
}
