/**
 * Release metadata for the release dialog. Pure data and helpers, no Wails or React.
 *
 * APP_VERSION mirrors the Version set in app.go. The latest-release lookup is not
 * wired yet, so callers pass `null` until the backend exists.
 */

export const APP_VERSION = '0.1.0'

/** The shape the backend will return for the latest published release. */
export interface ReleaseInfo {
  version: string
  publishedAt: number
  notes: string
  url: string
}

/** Human-readable line for the release state shown in the dialog. */
export function releaseSummary(latest: ReleaseInfo | null, current: string = APP_VERSION): string {
  if (!latest) return `You're on Orbit ${current}. No release information is available yet.`
  if (latest.version === current) return `You're on the latest release, ${current}.`
  return `Version ${latest.version} is available. You're on ${current}.`
}
