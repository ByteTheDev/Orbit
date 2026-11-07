import { describe, expect, it } from 'vitest'
import { BUILD_CHANNEL, IS_DEV_BUILD, channelFor } from '../buildChannel'

describe('channelFor', () => {
  it('treats the dev server as a development build, in any mode', () => {
    expect(channelFor('serve', 'development')).toBe('dev') // bun run dev, wails3 dev
    expect(channelFor('serve', 'production')).toBe('dev')
  })

  it('treats the build:dev script as a development build', () => {
    expect(channelFor('build', 'development')).toBe('dev') // wails3 build DEV=true
  })

  it('treats a production build as an official release', () => {
    expect(channelFor('build', 'production')).toBe('release') // npm run build, release workflow
  })
})

describe('BUILD_CHANNEL', () => {
  it('is the channel Vite injected for this run', () => {
    // Vitest loads the same config as a dev server, so the define resolves to the serve channel.
    expect(BUILD_CHANNEL).toBe(channelFor('serve', 'test'))
    expect(IS_DEV_BUILD).toBe(BUILD_CHANNEL === 'dev')
  })
})
