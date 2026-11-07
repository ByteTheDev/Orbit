// Static-markup check for the diff viewer. Row layout and folding are covered by diffLayout.test.ts;
// this confirms the viewer renders each kind of diff without crashing and shows the right controls.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeDiff } from './CodeDiff'

const GIT = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@ export function f() {',
  ' const x = 1',
  '-const y = 0',
  '+const y = "two"',
  ' return x',
].join('\n')

describe('CodeDiff', () => {
  it('renders a git diff with its hunk, counts and change controls', () => {
    const html = renderToStaticMarkup(<CodeDiff text={GIT} path="src/a.ts" kind="git" emptyTitle="None" emptyBody="" />)
    expect(html).toContain('Working tree against HEAD')
    expect(html).toContain('@@ -1,3 +1,3 @@')
    expect(html).toContain('aria-label="Copy hunk"')
    expect(html).toContain('aria-label="Next change"')
    expect(html).toContain('aria-label="Side by side"')
    // Keywords are coloured by highlight.js.
    expect(html).toContain('hljs-keyword')
  })

  it('renders an agent edit without line numbers', () => {
    const html = renderToStaticMarkup(
      <CodeDiff text={'- old line\n+ new line\n'} path="x.txt" kind="edit" emptyTitle="None" emptyBody="" />,
    )
    expect(html).toContain('Recorded agent edit')
    expect(html).toContain('Edit 1')
    // The changed word is marked on its own, and the unchanged words follow it.
    expect(html).toContain('<mark class="diff-word">old</mark> line')
  })

  it('shows the empty state when there is nothing to compare', () => {
    const html = renderToStaticMarkup(<CodeDiff text="" path="x.ts" kind="git" emptyTitle="No changes" emptyBody="Matches HEAD." />)
    expect(html).toContain('No changes')
    expect(html).toContain('Matches HEAD.')
    expect(html).not.toContain('aria-label="Next change"')
  })

  it('shows a whole file without folding or change markers', () => {
    const html = renderToStaticMarkup(<CodeDiff text={'one\ntwo'} path="notes.txt" kind="file" emptyTitle="Empty" emptyBody="" />)
    expect(html).toContain('File content')
    expect(html).toContain('two')
    expect(html).not.toContain('Show ')
  })
})
