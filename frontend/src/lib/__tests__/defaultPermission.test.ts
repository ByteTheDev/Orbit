import { describe, expect, it } from 'vitest'
import { defaultPermissionFor, normaliseDefaultPermissions, withDefaultPermission } from '../defaultPermission'

const modes = [{ id: 'acceptEdits' }, { id: 'plan' }, { id: 'bypassPermissions' }]

describe('normaliseDefaultPermissions', () => {
  it('keeps trimmed non-empty strings and drops anything else', () => {
    expect(normaliseDefaultPermissions({ claude: ' plan ', codex: '', fx: 3, other: null })).toEqual({ claude: 'plan' })
  })

  it('returns an empty map for non-objects and arrays', () => {
    expect(normaliseDefaultPermissions(null)).toEqual({})
    expect(normaliseDefaultPermissions('plan')).toEqual({})
    expect(normaliseDefaultPermissions(['plan'])).toEqual({})
  })
})

describe('defaultPermissionFor', () => {
  it('returns the saved mode when the provider still offers it', () => {
    expect(defaultPermissionFor({ claude: 'bypassPermissions' }, 'claude', modes)).toBe('bypassPermissions')
  })

  it('returns empty when the saved mode is no longer offered or there is none', () => {
    expect(defaultPermissionFor({ claude: 'removed-mode' }, 'claude', modes)).toBe('')
    expect(defaultPermissionFor({}, 'claude', modes)).toBe('')
  })
})

describe('withDefaultPermission', () => {
  it('sets the mode for one provider without touching the others', () => {
    expect(withDefaultPermission({ codex: 'read-only' }, 'claude', 'plan')).toEqual({ codex: 'read-only', claude: 'plan' })
  })

  it('removes the provider entry when the choice is the provider default', () => {
    expect(withDefaultPermission({ claude: 'plan' }, 'claude', '')).toEqual({})
  })

  it('does not mutate the input map', () => {
    const before = { claude: 'plan' }
    withDefaultPermission(before, 'claude', '')
    expect(before).toEqual({ claude: 'plan' })
  })
})
