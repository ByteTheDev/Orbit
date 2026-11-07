import { describe, expect, it } from 'vitest'
import { editPreview } from '../toolEdit'

describe('editPreview', () => {
  it('reads a single edit as one before and after pair with its path', () => {
    const input = JSON.stringify({ file_path: 'src/a.ts', old_string: 'x = 1', new_string: 'x = 2' })
    expect(editPreview('Edit', input)).toEqual({ path: 'src/a.ts', hunks: [{ before: 'x = 1', after: 'x = 2' }] })
  })

  it('reads every edit of a multi-edit call', () => {
    const input = JSON.stringify({
      file_path: 'b.go',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    })
    expect(editPreview('MultiEdit', input)?.hunks).toEqual([
      { before: 'a', after: 'b' },
      { before: 'c', after: 'd' },
    ])
  })

  it('shows a whole-file write as additions only', () => {
    const input = JSON.stringify({ file_path: 'new.md', content: '# hi' })
    expect(editPreview('Write', input)).toEqual({ path: 'new.md', hunks: [{ before: '', after: '# hi' }] })
  })

  it('returns null for input that is truncated or not an edit', () => {
    expect(editPreview('Edit', '{"file_path":"a","old_str')).toBeNull()
    expect(editPreview('Bash', JSON.stringify({ command: 'ls' }))).toBeNull()
    expect(editPreview('Write', JSON.stringify({ file_path: 'a' }))).toBeNull()
  })
})
