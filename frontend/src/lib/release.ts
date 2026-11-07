/**
 * Release metadata for the release dialog. Pure data and helpers, no Wails or React.
 *
 * APP_VERSION mirrors release.Version in internal/release. A Go test fails if they differ.
 */

import type { ReleaseInfo } from '../types'

export type { ReleaseInfo }

export const APP_VERSION = '1.0.1'

/** True when version `a` is newer than `b`. Compares dotted numbers, so "1.0.10" is newer than "1.0.9". */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((p) => Number(p) || 0)
  const pb = b.split('.').map((p) => Number(p) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Human-readable line for the release state shown in the dialog. */
export function releaseSummary(latest: ReleaseInfo | null, current: string = APP_VERSION): string {
  if (!latest) return `You're on Orbit ${current}. No release information is available yet.`
  if (isNewer(latest.version, current)) return `Version ${latest.version} is available. You're on ${current}.`
  return `You're on the latest release, ${current}.`
}
