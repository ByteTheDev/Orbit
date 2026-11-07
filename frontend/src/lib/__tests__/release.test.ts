import { describe, expect, it } from 'vitest'
import { APP_VERSION, isNewer, releaseSummary, type ReleaseInfo } from '../release'

const release = (version: string): ReleaseInfo => ({
  version,
  publishedAt: 0,
  notes: '',
  url: '',
})

describe('releaseSummary', () => {
  it('says no release info is available when the lookup returned nothing', () => {
    expect(releaseSummary(null)).toBe(`You're on Orbit ${APP_VERSION}. No release information is available yet.`)
  })

  it('reports the current version as latest when they match', () => {
    expect(releaseSummary(release('0.2.0'), '0.2.0')).toBe("You're on the latest release, 0.2.0.")
  })

  it('reports a newer release when one exists', () => {
    expect(releaseSummary(release('0.2.0'), '0.1.0')).toBe('Version 0.2.0 is available. You\'re on 0.1.0.')
  })

  it('does not offer an older release as an update', () => {
    expect(releaseSummary(release('1.0.0'), '1.0.1')).toBe("You're on the latest release, 1.0.1.")
  })
})

describe('isNewer', () => {
  it('compares numbers part by part', () => {
    expect(isNewer('1.0.10', '1.0.9')).toBe(true)
    expect(isNewer('1.1', '1.0.9')).toBe(true)
    expect(isNewer('1.0.9', '1.0.9')).toBe(false)
    expect(isNewer('1.0', '1.0.0')).toBe(false)
  })
})
