// Reads a file edit out of a tool call's raw input, so the chat can show what changed. Pure.
// The input is the JSON the agent sent. It is truncated for very large calls, so a broken JSON
// simply gives no preview and the raw input is shown instead.

export interface EditHunk {
  before: string
  after: string
}

export interface EditPreview {
  /** The file the edit touches, as the agent wrote it. Empty when the input did not name one. */
  path: string
  hunks: EditHunk[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The change a file-editing tool call makes, or null when the call is not an edit or its input is
 * not readable. Understands single edits (old and new text), multi-edits (a list of them), and
 * whole-file writes (new content only).
 */
export function editPreview(name: string, input: string): EditPreview | null {
  let data: unknown
  try {
    data = JSON.parse(input)
  } catch {
    return null
  }
  if (!isRecord(data)) return null

  const path = typeof data.file_path === 'string' ? data.file_path : typeof data.path === 'string' ? data.path : ''
  const hunks: EditHunk[] = []

  if (typeof data.old_string === 'string' && typeof data.new_string === 'string') {
    hunks.push({ before: data.old_string, after: data.new_string })
  } else if (Array.isArray(data.edits)) {
    for (const e of data.edits) {
      if (isRecord(e) && typeof e.old_string === 'string' && typeof e.new_string === 'string') {
        hunks.push({ before: e.old_string, after: e.new_string })
      }
    }
  } else if (typeof data.content === 'string' && /write|create/i.test(name)) {
    hunks.push({ before: '', after: data.content })
  }

  return hunks.length > 0 ? { path, hunks } : null
}
