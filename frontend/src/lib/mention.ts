// Detects an `@file` mention being typed before the cursor. Pure, so the rules can be tested without a DOM.

export interface Mention {
  /** Index of the `@` in the text. */
  start: number
  /** The folder typed so far, without the trailing slash. Empty at the project root. */
  dir: string
  /** The partial name after the last slash, used to filter suggestions. */
  prefix: string
}

/**
 * The mention being typed at `cursor`, or null. A mention starts at an `@` at the beginning of the
 * text or after whitespace, so an address such as `me@host` is not treated as one. It ends at the
 * first whitespace.
 */
export function mentionAt(value: string, cursor: number): Mention | null {
  const at = value.lastIndexOf('@', cursor - 1)
  if (at < 0) return null
  if (at > 0 && !/\s/.test(value[at - 1])) return null
  const token = value.slice(at + 1, cursor)
  if (/\s/.test(token)) return null
  const slash = token.lastIndexOf('/')
  return {
    start: at,
    dir: slash >= 0 ? token.slice(0, slash) : '',
    prefix: slash >= 0 ? token.slice(slash + 1) : token,
  }
}
