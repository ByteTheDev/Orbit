// The built-in browser. On Windows it shows real pages (HTML, CSS and JavaScript) in a WebView2
// view placed over the viewport below the toolbar. The toolbar, tab strip and address bar are
// ours. Where the native view is not available, the page's readable text and links are shown
// instead, and "Open in browser" hands the address to the system browser.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  browsePage,
  openInSystemBrowser,
  pageViewCommand,
  pageViewMove,
  pageViewNavigate,
  pageViewOpen,
  pageViewSupported,
} from '../../lib/actions'
import { canGoBack, canGoForward, currentPage, emptyHistory, goBack, goForward, settle, visit, withScheme, type BrowserHistory } from '../../lib/browserNav'
import { addressParts, landed, physicalBounds, type Intent } from '../../lib/browserPane'
import { onBrowserPane, type BrowserPaneState } from '../../lib/bridge'
import type { BrowserPage } from '../../types'
import { Button, Dialog, EmptyState, IconAlert, IconGlobe, IconInfo, IconShield, IconStop, Input, Spinner } from '../ui'

/** How long the dialog's entrance takes. The native view appears after it, so it does not slide. */
const ENTRANCE_MS = 280

const idle: BrowserPaneState = { url: '', title: '', loading: false }

export function BrowserDialog({ initialUrl, onClose }: { initialUrl?: string; onClose: () => void }) {
  const [history, setHistory] = useState<BrowserHistory>(emptyHistory)
  const [address, setAddress] = useState(initialUrl ?? '')
  const [focused, setFocused] = useState(false)

  // Native mode: the WebView2 view reports its own state.
  const [native, setNative] = useState<boolean | null>(null)
  const [pane, setPane] = useState<BrowserPaneState>(idle)

  // Text mode: the backend fetches the page and the dialog shows its text.
  const [page, setPage] = useState<BrowserPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const viewport = useRef<HTMLDivElement>(null)
  const nativeRef = useRef<boolean | null>(null)
  const paneOpened = useRef(false)
  const focusedRef = useRef(false)
  // What the user did that led to the next landing: typed, back, forward, or a click in the page.
  const intent = useRef<Intent>('navigate')
  const lastLanded = useRef('')
  // Each text load gets a number. An answer for an older load is dropped.
  const latest = useRef(0)

  const current = currentPage(history)
  const busy = native ? pane.loading : loading
  const shownUrl = native ? pane.url || current || '' : current || ''
  const title = native ? pane.title : page?.title ?? ''

  // ---- native view ---------------------------------------------------------------------

  /** Where the viewport is on screen, in the physical pixels the native view needs. */
  const measure = useCallback(() => {
    const el = viewport.current
    if (!el) return null
    return physicalBounds(el.getBoundingClientRect(), window.devicePixelRatio)
  }, [])

  const followViewport = useCallback(() => {
    if (!paneOpened.current) return
    const b = measure()
    if (b) pageViewMove(b)
  }, [measure])

  // Landings decide the history. Loading events only update the progress line.
  useEffect(
    () =>
      onBrowserPane((s) => {
        setPane(s)
        if (s.loading || !s.url || s.url === lastLanded.current) return
        lastLanded.current = s.url
        setHistory((h) => landed(h, s.url, intent.current))
        intent.current = 'page'
        if (!focusedRef.current) setAddress(s.url)
      }),
    [],
  )

  // Keep the native view on the viewport as it resizes or the window moves.
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const ro = new ResizeObserver(followViewport)
    ro.observe(el)
    window.addEventListener('resize', followViewport)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', followViewport)
    }
  }, [followViewport, native])

  // ---- text view ---------------------------------------------------------------------------

  const load = useCallback(async (url: string) => {
    const id = ++latest.current
    setLoading(true)
    const next = await browsePage(url)
    if (id !== latest.current) return
    setLoading(false)
    setFailed(next === null)
    setPage(next)
    if (next) {
      setAddress(next.url)
      setHistory((h) => settle(h, next.url))
    }
  }, [])

  // ---- navigation ----------------------------------------------------------------------------

  /** Opens an address. The native view is created the first time, then navigates. */
  const open = useCallback(
    (raw: string, how: Intent = 'navigate') => {
      const url = withScheme(raw)
      if (!url) return
      intent.current = how
      setHistory((h) => visit(h, url))
      setAddress(url)
      if (nativeRef.current) {
        if (paneOpened.current) {
          void pageViewNavigate(url)
        } else {
          const b = measure()
          if (!b) return
          paneOpened.current = true
          void pageViewOpen(url, b)
        }
      } else {
        void load(url)
      }
    },
    [load, measure],
  )

  // Starts once. Native mode waits for the entrance animation, so the view does not land mid-slide.
  useEffect(() => {
    let timer: number | undefined
    let cancelled = false
    void pageViewSupported().then((ok) => {
      if (cancelled) return
      nativeRef.current = ok
      setNative(ok)
      if (!initialUrl) return
      if (ok) {
        timer = window.setTimeout(() => open(initialUrl), ENTRANCE_MS)
      } else {
        open(initialUrl)
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [initialUrl, open])

  const back = () => {
    if (native) {
      intent.current = 'back'
      setAddress(currentPage(goBack(history)) ?? '')
      void pageViewCommand('back')
      return
    }
    const h = goBack(history)
    if (h === history) return
    setHistory(h)
    setAddress(currentPage(h) ?? '')
    void load(currentPage(h) as string)
  }

  const forward = () => {
    if (native) {
      intent.current = 'forward'
      setAddress(currentPage(goForward(history)) ?? '')
      void pageViewCommand('forward')
      return
    }
    const h = goForward(history)
    if (h === history) return
    setHistory(h)
    setAddress(currentPage(h) ?? '')
    void load(currentPage(h) as string)
  }

  const reloadOrStop = () => {
    if (busy) {
      if (native) void pageViewCommand('stop')
      return
    }
    if (native) void pageViewCommand('reload')
    else if (current) void load(current)
  }

  // Hides the native view before the dialog goes, so it never floats over the next screen.
  const close = useCallback(() => {
    if (nativeRef.current && paneOpened.current) void pageViewCommand('hide')
    onClose()
  }, [onClose])

  // Also hide when this dialog is replaced or unmounted by any other route.
  useEffect(
    () => () => {
      if (nativeRef.current && paneOpened.current) void pageViewCommand('hide')
    },
    [],
  )

  // ---- render --------------------------------------------------------------------------------

  const parts = addressParts(shownUrl)
  const hasPage = !!shownUrl
  const description = title || (hasPage ? shownUrl : 'Read a web page without leaving Orbit.')

  return (
    <Dialog title="Browser" description={description} onClose={close} width="max-w-6xl">
      <div className="flex h-[68vh] min-h-[26rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas">
        {/* Tab strip. One tab for now; it names the page and shows its progress. */}
        <div className="flex h-9 shrink-0 items-end gap-1 bg-sidebar px-2 pt-1.5" role="tablist" aria-label="Pages">
          <div role="tab" aria-selected="true" className="flex h-8 min-w-[9rem] max-w-[18rem] items-center gap-2 rounded-t-lg bg-surface px-3 text-caption text-ink">
            <span className="flex shrink-0 text-faint">
              {busy ? <Spinner /> : <IconGlobe size={13} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{title || (hasPage ? parts.host : 'New tab')}</span>
          </div>
        </div>

        {/* Toolbar: history, reload or stop, and the address bar. */}
        <form
          className="flex shrink-0 items-center gap-1 border-y border-line bg-surface px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            open(address)
          }}
        >
          <ToolButton label="Back" disabled={!canGoBack(history)} onClick={back}>
            <ArrowIcon direction="left" />
          </ToolButton>
          <ToolButton label="Forward" disabled={!canGoForward(history)} onClick={forward}>
            <ArrowIcon direction="right" />
          </ToolButton>
          <ToolButton label={busy ? 'Stop' : 'Reload'} disabled={!hasPage} onClick={reloadOrStop}>
            {busy ? <IconStop size={11} /> : <ReloadIcon />}
          </ToolButton>

          <div
            className={`group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border bg-canvas pl-3 pr-1 transition-colors duration-150 ${
              focused ? 'border-line-strong ring-2 ring-focus/40' : 'border-line hover:border-line-strong'
            }`}
          >
            {hasPage && (parts.secure ? <IconShield size={12} className="shrink-0 text-ok" /> : <IconInfo size={12} className="shrink-0 text-warn" />)}
            {focused || !hasPage ? (
              <Input
                aria-label="Web address"
                placeholder="Search or enter an address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onFocus={() => {
                  focusedRef.current = true
                  setFocused(true)
                }}
                onBlur={() => {
                  focusedRef.current = false
                  setFocused(false)
                }}
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 focus-visible:outline-none"
                spellCheck={false}
                autoComplete="off"
                autoFocus={!hasPage}
              />
            ) : (
              <button
                type="button"
                aria-label={`Address ${shownUrl}. Click to edit.`}
                onClick={() => {
                  setAddress(shownUrl)
                  setFocused(true)
                  focusedRef.current = true
                }}
                className="flex h-7 min-w-0 flex-1 items-center truncate text-left text-body"
              >
                <span className="truncate">
                  <span className="text-muted">{parts.scheme}</span>
                  <span className="text-ink">{parts.host}</span>
                  <span className="text-muted">{parts.rest}</span>
                </span>
              </button>
            )}
          </div>

          <Button type="submit" variant="secondary" size="sm" disabled={!address.trim()} className="rounded-full px-3">
            Go
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Open in browser" disabled={!hasPage} onClick={() => shownUrl && void openInSystemBrowser(shownUrl)}>
            Open in browser
          </Button>
        </form>

        {/* Progress line under the toolbar. It sweeps while a page loads. */}
        <div className="relative h-0.5 shrink-0 overflow-hidden bg-transparent" aria-hidden="true">
          {busy && <span className="absolute inset-y-0 left-0 block h-full w-1/3 animate-[activity-sweep_1.2s_linear_infinite] bg-ink/70 motion-reduce:hidden" />}
        </div>

        {/* The viewport. The native view sits exactly over this box; text mode fills it. */}
        <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
          {!hasPage && (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                title={failed ? 'This page did not load' : 'Enter an address'}
                body={failed ? 'Check the address and your connection, then try again.' : 'Type a web address above. Pages open here, with their styles and scripts.'}
              />
            </div>
          )}

          {native === false && hasPage && <TextView loading={loading} page={page} onOpen={(u) => open(u)} />}

          {native === false && !hasPage && failed && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3 text-caption text-warn-soft">
              <IconAlert size={12} /> The page view is unavailable on this system.
            </div>
          )}
        </div>

        {/* Status bar. */}
        <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-line bg-sidebar px-3 text-label text-faint">
          <span className="min-w-0 truncate">{busy ? 'Loading…' : hasPage ? 'Done' : ''}</span>
          <span className="shrink-0">{native === null ? '' : native ? 'WebView2 · JavaScript on' : 'Text view'}</span>
        </div>
      </div>
    </Dialog>
  )
}

/** Fallback when the native view is not available: the page's readable text and links. */
function TextView({ loading, page, onOpen }: { loading: boolean; page: BrowserPage | null; onOpen: (url: string) => void }) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading the page…" />
      </div>
    )
  }
  if (!page) return null
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-faint">
        <span className={page.status >= 400 ? 'text-danger-soft' : 'text-ok'}>HTTP {page.status}</span>
        <span>{page.contentType || 'unknown type'}</span>
        {page.truncated && <span>Only the start of this page is shown.</span>}
        {!page.text && <span>No readable text. The page may need JavaScript; try “Open in browser”.</span>}
      </div>
      {page.text && <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">{page.text}</p>}
      {page.links.length > 0 && (
        <div className="mt-5 border-t border-line pt-3">
          <h3 className="mb-1 text-caption font-medium uppercase tracking-wide text-faint">Links ({page.links.length})</h3>
          <ul className="flex flex-col">
            {page.links.map((l) => (
              <li key={l.url}>
                <button type="button" onClick={() => onOpen(l.url)} className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover">
                  <span className="max-w-full truncate text-body text-ink">{l.text}</span>
                  <span className="max-w-full truncate text-caption text-faint">{l.url}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'left' ? <path d="M19 12H5M12 19l-7-7 7-7" /> : <path d="M5 12h14M12 5l7 7-7 7" />}
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
    </svg>
  )
}
