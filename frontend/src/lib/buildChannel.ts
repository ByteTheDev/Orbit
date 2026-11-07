/**
 * Which kind of build this is. A development build is the Vite dev server (`bun run dev` through
 * `wails3 dev`), the `build:dev` script (`wails3 build DEV=true`), or any development-mode build.
 * An official release is a production build (`npm run build`, as in the release workflow).
 *
 * Vite replaces __ORBIT_CHANNEL__ with a string at build time (see vite.config.ts), so the choice
 * is fixed in the bundle and nothing has to be set in the environment. Pure: no React, no Wails.
 */

export type BuildChannel = 'dev' | 'release'

/** The channel for one Vite run. `command` is Vite's own: 'serve' for the dev server, 'build' for a build. */
export function channelFor(command: 'build' | 'serve', mode: string): BuildChannel {
  if (command === 'serve') return 'dev'
  return mode === 'development' ? 'dev' : 'release'
}

declare const __ORBIT_CHANNEL__: string | undefined

/**
 * The channel of this bundle. Anything other than 'dev' counts as a release, so a bundle that was
 * not built with the define (for example a plain Node run) never shows the dev tag by mistake.
 */
export const BUILD_CHANNEL: BuildChannel =
  typeof __ORBIT_CHANNEL__ !== 'undefined' && __ORBIT_CHANNEL__ === 'dev' ? 'dev' : 'release'

export const IS_DEV_BUILD = BUILD_CHANNEL === 'dev'
