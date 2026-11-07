import { describe, expect, it } from 'vitest'
import { mentionAt } from '../mention'

describe('mentionAt', () => {
  it('finds a mention at the start of the text and after a space', () => {
    expect(mentionAt('@src', 4)).toEqual({ start: 0, dir: '', prefix: 'src' })
    expect(mentionAt('see @src/app', 12)).toEqual({ start: 4, dir: 'src', prefix: 'app' })
  })

  it('reads the folder and the partial name separately', () => {
    expect(mentionAt('@internal/agent/ma', 18)).toEqual({ start: 0, dir: 'internal/agent', prefix: 'ma' })
  })

  it('ignores an @ inside a word, such as an address', () => {
    expect(mentionAt('mail me@host', 12)).toBeNull()
  })

  it('ends the mention at whitespace', () => {
    expect(mentionAt('@a file b', 9)).toBeNull()
  })

  it('uses the cursor position, not the end of the text', () => {
    // The cursor sits just after the first mention, so the later text does not count.
    expect(mentionAt('@app and more', 4)).toEqual({ start: 0, dir: '', prefix: 'app' })
  })

  it('returns null when there is no @ before the cursor', () => {
    expect(mentionAt('hello', 5)).toBeNull()
  })
})
