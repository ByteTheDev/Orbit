import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentSummary, Message, ToolCall } from '../../types'
import { loadDetail, resumeAgent, sendMessage, stopAgent } from '../../lib/actions'
import { clock } from '../../lib/format'
import { toast } from '../../lib/store'
import { STATUS_COLOR } from '../../lib/theme'
import { Button, IconPlay, IconStop, IconX, ProviderMark } from '../ui'
import { IconChevronDown, IconChevronRight, IconCopy, IconRetry, IconSend, IconTool } from './inspectorIcons'

/** Messages and tool calls are shown this many at a time; older ones load on request. */
const PAGE = 120

/**
 * Unsent drafts, keyed by agent. They survive switching agents and closing the inspector,
 * so a half-written message is never lost to navigation.
 */
const drafts = new Map<string, string>()

/**
 * Messages typed while the agent was working. They are sent one at a time when each reply
 * finishes. Kept per agent, so they survive switching tabs.
 */
const queues = new Map<string, string[]>()

interface Props {
  agent: AgentSummary
  messages?: Message[]
  tools?: ToolCall[]
  loaded: boolean
  /** Set when the history could not be loaded. Shown in place of the conversation. */
  error?: string
}

type TimelineItem =
  | { key: string; at: number; kind: 'message'; message: Message }
  | { key: string; at: number; kind: 'tool'; tool: ToolCall }

/**
 * Interleaves replies and tool calls in the order they happened. Both inputs arrive in
 * time order, so a single merge pass is enough.
 */
function mergeTimeline(messages: Message[], tools: ToolCall[]): TimelineItem[] {
  const out: TimelineItem[] = []
  let i = 0
  let j = 0
  while (i < messages.length || j < tools.length) {
    const m = messages[i]
    const t = tools[j]
    if (m && (!t || (m.at || 0) <= (t.at || 0))) {
      out.push({ key: `m:${m.id}`, at: m.at || 0, kind: 'message', message: m })
      i++
    } else {
      out.push({ key: `t:${t.id}`, at: t.at || 0, kind: 'tool', tool: t })
      j++
    }
  }
  return out
}

export function ChatTab({ agent, messages, tools, loaded, error }: Props) {
  const [draft, setDraft] = useState(() => drafts.get(agent.id) ?? '')
  const draftRef = useRef(draft)
  const [sending, setSending] = useState(false)
  const [queue, setQueue] = useState<string[]>(() => queues.get(agent.id) ?? [])
  const queueRef = useRef(queue)
  // Set by Stop: a stopped reply should not send the messages queued behind it.
  const stoppedRef = useRef(false)
  const [limit, setLimit] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const timeline = useMemo(() => mergeTimeline(messages ?? [], tools ?? []), [messages, tools])
  const shown = timeline.length > limit ? timeline.slice(timeline.length - limit) : timeline
  const hidden = timeline.length - shown.length
  const last = timeline[timeline.length - 1]
  // Changes whenever the newest item grows, so streamed text keeps the view pinned to the bottom.
  const lastSignature = last ? (last.kind === 'message' ? `${last.key}:${last.message.text.length}` : `${last.key}:${last.tool.status}`) : ''
  const busy = agent.running
  const caps = agent.capabilities
  const awaitingReply = busy && last?.kind === 'message' && last.message.role === 'user'

  const setQueueFor = (next: string[]) => {
    queueRef.current = next
    setQueue(next)
    if (next.length) queues.set(agent.id, next)
    else queues.delete(agent.id)
  }

  // When a turn ends, send the next queued message. Acting only on the busy -> idle edge stops
  // two queued messages from racing into one turn, which the backend would reject as busy.
  const wasBusy = useRef(busy)
  useEffect(() => {
    const was = wasBusy.current
    wasBusy.current = busy
    if (!was || busy) return
    if (stoppedRef.current) {
      stoppedRef.current = false
      setQueueFor([])
      return
    }
    const [next, ...rest] = queueRef.current
    if (next === undefined) return
    setQueueFor(rest)
    setSending(true)
    void sendMessage(agent.id, next).then((ok) => {
      setSending(false)
      // Put a failed message back in the draft so it is not lost.
      if (!ok && !draftRef.current.trim()) updateDraft(next)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the busy edge should trigger a send.
  }, [busy])

  const onStop = () => {
    stoppedRef.current = true
    void stopAgent(agent.id)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [shown.length, lastSignature])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const updateDraft = (value: string) => {
    draftRef.current = value
    setDraft(value)
    if (value) drafts.set(agent.id, value)
    else drafts.delete(agent.id)
  }

  const submit = async () => {
    const text = draftRef.current.trim()
    if (!text || sending || !caps.send) return
    if (busy) {
      // Queue it. It is sent when this reply finishes.
      setQueueFor([...queueRef.current, text])
      updateDraft('')
      return
    }
    stoppedRef.current = false
    setSending(true)
    const ok = await sendMessage(agent.id, text)
    setSending(false)
    // Only clear the draft if it has not changed while the send was in flight.
    if (ok) {
      pinned.current = true
      if (draftRef.current.trim() === text) updateDraft('')
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    // Enter sends. Shift+Enter inserts a line. Ctrl/⌘+Enter sends too, for muscle memory from other tools.
    if (!e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      void submit()
    }
  }

  const canSend = caps.send

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={`Conversation with ${agent.name}`}
        aria-live="off"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {!loaded && error && <LoadError agentId={agent.id} message={error} />}
        {!loaded && !error && <ChatSkeleton />}

        {loaded && timeline.length === 0 && (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
            <div className="mb-3 opacity-80">
              <ProviderMark provider={agent.provider} size={30} />
            </div>
            <p className="text-[13px] font-medium text-ink/85">No messages yet</p>
            <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-faint">
              {canSend
                ? 'Send a message to give this agent work. Its replies and tool calls appear here as it works.'
                : `${agent.providerName} does not accept messages from Orbit. Watch its activity instead.`}
            </p>
          </div>
        )}

        {loaded && hidden > 0 && (
          <div className="mb-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, hidden)} earlier
            </Button>
          </div>
        )}

        {loaded && timeline.length > 0 && (
          <div className="space-y-4">
            {shown.map((item) =>
              item.kind === 'message' ? (
                <MessageView key={item.key} message={item.message} providerName={agent.providerName} provider={agent.provider} />
              ) : (
                <ToolRow key={item.key} tool={item.tool} />
              ),
            )}
            {awaitingReply && <Thinking name={agent.providerName} />}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-sidebar p-3">
        {busy && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-status-thinking/20 bg-status-thinking/[0.05] py-1.5 pl-3 pr-1.5 text-[12px] text-status-thinking">
            <span className="flex min-w-0 items-center gap-2" role="status">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-status-thinking/60 motion-reduce:animate-none" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-status-thinking" />
              </span>
              <span className="truncate">Working{agent.statusDetail ? ` · ${agent.statusDetail}` : ''}</span>
            </span>
            {caps.stop && (
              <Button variant="danger" size="sm" onClick={onStop} className="h-6 px-2 text-[11px]">
                <IconStop size={9} />
                Stop
              </Button>
            )}
          </div>
        )}
        {!busy && caps.resume && agent.turns > 0 && (
          <div className="mb-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void resumeAgent(agent.id)} className="h-6 px-2 text-[11px]">
              <IconPlay size={9} />
              Continue where it stopped
            </Button>
          </div>
        )}

        {canSend && queue.length > 0 && (
          <ul aria-label="Queued messages" className="mb-2 space-y-1">
            {queue.map((q, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-line bg-canvas/60 py-1 pl-3 pr-1 text-[12px]">
                <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">Queued</span>
                <span className="min-w-0 flex-1 truncate text-ink/85">{q}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove queued message"
                  title="Remove"
                  onClick={() => setQueueFor(queueRef.current.filter((_, j) => j !== i))}
                  className="h-6 w-6 shrink-0 rounded-md px-0"
                >
                  <IconX size={11} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canSend ? (
          <div className="rounded-xl border border-line bg-surface p-2 transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-within:border-white/25 focus-within:ring-[3px] focus-within:ring-white/[0.06]">
            <textarea
              value={draft}
              onChange={(e) => updateDraft(e.target.value)}
              onKeyDown={onKey}
              aria-busy={sending}
              placeholder={busy ? `${agent.name} is working. Type to queue your next message.` : `Message ${agent.name}…`}
              aria-label={`Message ${agent.name}`}
              rows={2}
              className="block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
            />
            <div className="mt-1 flex items-center justify-between gap-2 px-1">
              <span className="truncate text-[10.5px] text-faint">
                {busy ? 'Sends when this reply finishes' : 'Enter to send · Shift+Enter for a new line'}
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void submit()}
                disabled={!draft.trim() || sending}
                aria-label={busy ? 'Queue message' : 'Send message'}
                className="h-7 shrink-0 rounded-md px-3"
              >
                <IconSend size={12} />
                {busy ? 'Queue' : sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-faint">Messages are not available for {agent.providerName}.</p>
        )}
      </div>
    </div>
  )
}

// ---- messages ----------------------------------------------------------------------------

/** Memoised: a streamed delta re-renders only the message that changed, not the whole conversation. */
const MessageView = memo(function MessageView({ message: m, providerName, provider }: { message: Message; providerName: string; provider: string }) {
  if (m.role === 'system') {
    return <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{m.text}</p>
  }

  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
          You <span className="ml-1 font-mono normal-case tracking-normal text-faint/80">{clock(m.at)}</span>
        </span>
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm border border-line bg-white/[0.05] px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
          {m.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <ProviderMark provider={provider} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
          {providerName} <span className="ml-1 font-mono normal-case tracking-normal text-faint/80">{clock(m.at)}</span>
        </span>
        <div className="mt-1 break-words text-[13px] leading-relaxed text-ink/90">
          {m.text ? <Markdownish text={m.text} /> : m.streaming ? null : <span className="text-faint">No reply text.</span>}
          {m.streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink/70 align-middle motion-reduce:animate-none" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
})

function Thinking({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      {name} is working on a reply…
    </div>
  )
}

/**
 * Renders the two things agent replies actually use: fenced code blocks and inline code.
 * Everything else is plain text. Nothing is parsed as HTML, so a reply cannot inject markup.
 */
const Markdownish = memo(function Markdownish({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const body = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
          return (
            <pre key={i} className="my-2 max-h-72 overflow-auto whitespace-pre rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink/85">
              {body}
            </pre>
          )
        }
        return <Fragment key={i}>{renderInline(part)}</Fragment>
      })}
    </>
  )
})

function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((chunk, i) =>
    chunk.length > 2 && chunk.startsWith('`') && chunk.endsWith('`') ? (
      <code key={i} className="rounded bg-white/[0.07] px-1 py-px font-mono text-[12px] text-ink">
        {chunk.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{chunk}</Fragment>
    ),
  )
}

// ---- tool calls ----------------------------------------------------------------------------

const TOOL_TONE: Record<ToolCall['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: STATUS_COLOR.thinking },
  ok: { label: 'Done', color: STATUS_COLOR.completed },
  error: { label: 'Failed', color: STATUS_COLOR.failed },
}

/** A tool call in the conversation. Collapsed to one line; expands to its input and result. */
const ToolRow = memo(function ToolRow({ tool: t }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const tone = TOOL_TONE[t.status] ?? TOOL_TONE.running
  const id = `tool-${t.id}`
  return (
    <div className={`rounded-lg border bg-surface/50 ${t.status === 'error' ? 'border-danger/25' : 'border-line'}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-white/[0.03]"
      >
        <span className="text-faint">{open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</span>
        <span className="text-faint">
          <IconTool size={12} />
        </span>
        <span className="shrink-0 font-mono text-[11px] font-medium text-ink">{t.name || 'Tool'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{t.summary}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: tone.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} />
          {tone.label}
        </span>
      </button>
      {open && (
        <div id={id} className="space-y-2.5 border-t border-line px-3 py-2.5">
          <CodeBlock label="Input" text={t.input} />
          <CodeBlock label="Result" text={t.output} placeholder={t.status === 'running' ? 'Waiting for result…' : 'No output'} danger={t.status === 'error'} />
        </div>
      )}
    </div>
  )
})

/** Labelled, monospace block with a copy action. Shared by the chat tool rows and the Tools tab. */
export function CodeBlock({ label, text, placeholder = 'Empty', danger = false }: { label: string; text: string; placeholder?: string; danger?: boolean }) {
  const value = text || ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied to the clipboard', 'success')
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
        {value && (
          <button onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-faint transition-colors hover:text-ink">
            <IconCopy size={11} />
            Copy
          </button>
        )}
      </div>
      <pre
        className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-2.5 font-mono text-[11px] leading-relaxed ${
          danger ? 'text-danger-soft' : 'text-ink/80'
        }`}
      >
        {value || placeholder}
      </pre>
    </div>
  )
}

// ---- loading & error ---------------------------------------------------------------------------

function ChatSkeleton() {
  return (
    <div className="space-y-5 py-2" role="status" aria-label="Loading conversation">
      {[70, 90, 55].map((w, i) => (
        <div key={i} className={`flex flex-col gap-2 ${i % 2 ? 'items-end' : ''}`}>
          <div className="h-2 w-16 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
          <div className="h-8 animate-pulse rounded-xl bg-white/[0.04] motion-reduce:animate-none" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

function LoadError({ agentId, message }: { agentId: string; message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
      <p className="text-[13px] font-medium text-ink/85">Couldn’t load this conversation</p>
      <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-faint">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadDetail(agentId)}>
        <IconRetry size={12} />
        Try again
      </Button>
    </div>
  )
}
