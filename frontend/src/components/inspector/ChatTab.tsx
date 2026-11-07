import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentSummary, Attachment, Message, ToolCall } from '../../types'
import { attachmentImage, loadDetail, resumeAgent, sendMessage, stopAgent } from '../../lib/actions'
import { addImages, toUploads, type PendingImage } from '../../lib/chatImages'
import { clock } from '../../lib/format'
import { toast, useStore } from '../../lib/store'
import { STATUS_COLOR } from '../../lib/theme'
import { parseBlocks, parseInline, type Block } from '../../lib/markdown'
import { toolKind, type ToolKind } from '../../lib/toolKind'
import { Button, IconCheck, IconPencil, IconPlay, IconX, ProviderMark } from '../ui'
import { ChatComposer } from './ChatComposer'
import { TalkShowcase } from './TalkShowcase'
import {
  IconAgent,
  IconChevronRight,
  IconCopy,
  IconFileRead,
  IconFileWrite,
  IconGlobe,
  IconPlug,
  IconRetry,
  IconSearch,
  IconTerminal,
  IconTool,
} from './inspectorIcons'

/** Messages and tool calls are shown this many at a time; older ones load on request. */
const PAGE = 120

/**
 * Unsent drafts, keyed by agent. They survive switching agents and closing the inspector,
 * so a half-written message is never lost to navigation.
 */
const drafts = new Map<string, string>()

/** Unsent images, keyed by agent, kept alongside the draft text. */
const imageDrafts = new Map<string, PendingImage[]>()

/** A message typed while the agent was working, with the images attached to it. */
interface QueuedMessage {
  text: string
  images: PendingImage[]
}

/**
 * Messages typed while the agent was working. They are sent one at a time when each reply
 * finishes. Kept per agent, so they survive switching tabs.
 */
const queues = new Map<string, QueuedMessage[]>()

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
  const [queue, setQueue] = useState<QueuedMessage[]>(() => queues.get(agent.id) ?? [])
  const queueRef = useRef(queue)
  const [images, setImages] = useState<PendingImage[]>(() => imageDrafts.get(agent.id) ?? [])
  const imagesRef = useRef(images)
  // Why the last attach attempt was refused, shown under the composer.
  const [imageNote, setImageNote] = useState('')
  const [dragging, setDragging] = useState(false)
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

  const setQueueFor = (next: QueuedMessage[]) => {
    queueRef.current = next
    setQueue(next)
    if (next.length) queues.set(agent.id, next)
    else queues.delete(agent.id)
  }

  const setImagesFor = (next: PendingImage[]) => {
    imagesRef.current = next
    setImages(next)
    if (next.length) imageDrafts.set(agent.id, next)
    else imageDrafts.delete(agent.id)
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
    // The user may have scrolled up while the reply streamed. Pin to the bottom so the sent message is visible.
    pinned.current = true
    setSending(true)
    void sendMessage(agent.id, next.text, toUploads(next.images)).then((ok) => {
      setSending(false)
      // Put a failed message back in the composer so it is not lost.
      if (!ok && !draftRef.current.trim() && imagesRef.current.length === 0) {
        updateDraft(next.text)
        setImagesFor(next.images)
      }
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
    const attached = imagesRef.current
    if ((!text && attached.length === 0) || sending || !caps.send) return
    if (busy) {
      // Queue it. It is sent when this reply finishes.
      setQueueFor([...queueRef.current, { text, images: attached }])
      updateDraft('')
      setImagesFor([])
      return
    }
    stoppedRef.current = false
    setSending(true)
    const ok = await sendMessage(agent.id, text, toUploads(attached))
    setSending(false)
    // Only clear the composer if it has not changed while the send was in flight.
    if (ok) {
      pinned.current = true
      if (draftRef.current.trim() === text) updateDraft('')
      if (imagesRef.current === attached) setImagesFor([])
    }
  }

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return
    const { added, problems } = await addImages(files, imagesRef.current.length)
    if (added.length) setImagesFor([...imagesRef.current, ...added])
    setImageNote(problems.join(' '))
  }

  // Pasting an image attaches it. Text pastes behave as usual.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    void attachFiles(files)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    void attachFiles(Array.from(e.dataTransfer.files))
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (enterToSend) {
      // Enter sends. Shift+Enter inserts a line. Ctrl/⌘+Enter sends too, for muscle memory from other tools.
      if (!e.shiftKey) {
        e.preventDefault()
        void submit()
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        void submit()
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Enter-to-send is off: Enter adds a line, and Ctrl/⌘+Enter sends.
      e.preventDefault()
      void submit()
    }
  }

  const canSend = caps.send

  const enterToSend = useStore((s) => s.settings.enterToSend)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TalkShowcase agent={agent} />
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
            <p className="text-body font-medium text-ink/85">No messages yet</p>
            <p className="mt-1 max-w-[260px] text-caption leading-relaxed text-faint">
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
            {groupRuns(shown).map((unit) => {
              if (unit.kind === 'group') return <ToolGroup key={unit.key} tools={unit.tools} />
              const item = unit.item
              return item.kind === 'message' ? (
                <MessageView
                  key={item.key}
                  agentId={agent.id}
                  message={item.message}
                  providerName={agent.providerName}
                  provider={agent.provider}
                />
              ) : (
                <ToolRow key={item.key} tool={item.tool} />
              )
            })}
            {awaitingReply && <Thinking name={agent.providerName} />}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {!busy && caps.resume && agent.turns > 0 && (
          <div className="mb-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void resumeAgent(agent.id)} className="h-6 px-2 text-label">
              <IconPlay size={9} />
              Continue where it stopped
            </Button>
          </div>
        )}

        {canSend && queue.length > 0 && (
          <ul aria-label="Queued messages" className="mb-2 space-y-1">
            {queue.map((q, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong py-1 pl-2.5 pr-1 text-caption">
                <span className="shrink-0 rounded bg-tint/[0.06] px-1.5 py-px text-label text-muted">Queued</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {q.text || 'Image'}
                  {q.images.length > 0 && <span className="ml-1.5 text-faint">· {q.images.length} image{q.images.length === 1 ? '' : 's'}</span>}
                </span>
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
          <ChatComposer
            agent={agent}
            draft={draft}
            onDraftChange={updateDraft}
            onKeyDown={onKey}
            onPaste={onPaste}
            images={images}
            onRemoveImage={(id) => setImagesFor(imagesRef.current.filter((i) => i.id !== id))}
            imageNote={imageNote}
            dragging={dragging}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onPickFiles={(files) => void attachFiles(files)}
            busy={busy}
            sending={sending}
            onSubmit={() => void submit()}
            onStop={onStop}
            enterToSend={enterToSend}
          />
        ) : (
          <p className="text-caption text-faint">Messages are not available for {agent.providerName}.</p>
        )}
      </div>
    </div>
  )
}

// ---- messages ----------------------------------------------------------------------------

/** Memoised: a streamed delta re-renders only the message that changed, not the whole conversation. */
const MessageView = memo(function MessageView({
  agentId,
  message: m,
  providerName,
  provider,
}: {
  agentId: string
  message: Message
  providerName: string
  provider: string
}) {
  if (m.role === 'system') {
    return <p className="text-center text-label text-faint">{m.text}</p>
  }

  if (m.role === 'user') {
    const attachments = m.attachments ?? []
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-label text-faint">
          <span className="font-medium text-muted">You</span>
          <span className="ml-1.5 font-mono tabular-nums">{clock(m.at)}</span>
        </span>
        {attachments.length > 0 && (
          <ul aria-label="Attached images" className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <li key={a.id}>
                <ChatImage agentId={agentId} attachment={a} />
              </li>
            ))}
          </ul>
        )}
        {m.text && (
          <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-tint/[0.06] px-3.5 py-2.5 text-body leading-[1.6] text-ink">
            {m.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <ProviderMark provider={provider} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-label text-faint">
          <span className="font-medium text-muted">{providerName}</span>
          <span className="ml-1.5 font-mono tabular-nums">{clock(m.at)}</span>
        </span>
        <div className="mt-1 break-words text-body leading-[1.6] text-ink/90">
          {m.text ? <Markdownish text={m.text} /> : m.streaming ? null : <span className="text-faint">No reply text.</span>}
          {m.streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink/70 align-middle motion-reduce:animate-none" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
})

/** Loaded chat images, keyed by agent and attachment. Bounded, so a long session cannot grow without limit. */
const attachmentCache = new Map<string, string>()
const ATTACHMENT_CACHE_MAX = 40

/** A picture in a sent message. Its pixels come from the backend once, then are reused. */
function ChatImage({ agentId, attachment }: { agentId: string; attachment: Attachment }) {
  const key = `${agentId}:${attachment.id}`
  const [src, setSrc] = useState<string | null>(() => attachmentCache.get(key) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (src) return
    let live = true
    void attachmentImage(agentId, attachment.id).then((url) => {
      if (!live) return
      if (url) {
        if (attachmentCache.size >= ATTACHMENT_CACHE_MAX) attachmentCache.delete(attachmentCache.keys().next().value as string)
        attachmentCache.set(key, url)
        setSrc(url)
      } else {
        setFailed(true)
      }
    })
    return () => {
      live = false
    }
  }, [agentId, attachment.id, key, src])

  if (failed) {
    return <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-line px-2 text-center text-label text-faint">Image unavailable</div>
  }
  if (!src) {
    return <div role="status" aria-label={`Loading ${attachment.name}`} className="h-24 w-24 animate-pulse rounded-lg border border-line bg-tint/[0.04] motion-reduce:animate-none" />
  }
  return <img src={src} alt={attachment.name} title={attachment.name} className="max-h-48 max-w-[16rem] rounded-lg border border-line object-contain" />
}

function Thinking({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 text-caption text-muted" role="status">
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
 * Renders the Markdown subset agent replies use (see lib/markdown.ts). Everything becomes React
 * elements, never HTML, so a reply cannot inject markup.
 */
const Markdownish = memo(function Markdownish({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
})

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case 'heading': {
      const cls = b.level === 1 ? 'text-title font-semibold' : 'text-body font-semibold'
      return <p className={`${cls} pt-1 text-ink`}>{inline(b.text)}</p>
    }
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag className={`space-y-1.5 pl-4 marker:text-faint ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((item, i) => (
            <li key={i} className="pl-1 leading-relaxed">
              {inline(item)}
            </li>
          ))}
        </Tag>
      )
    }
    case 'quote':
      return <blockquote className="border-l-2 border-line pl-3 text-muted">{b.lines.map((l, i) => <p key={i}>{inline(l)}</p>)}</blockquote>
    case 'code':
      return (
        <div>
          {b.lang && <div className="mb-1 font-mono text-label uppercase tracking-[0.1em] text-faint">{b.lang}</div>}
          <pre className="max-h-72 overflow-auto whitespace-pre rounded-lg border border-line bg-canvas p-3 font-mono text-caption leading-relaxed text-ink/85">
            {b.text}
          </pre>
        </div>
      )
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          {b.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      )
  }
}

function inline(text: string): ReactNode[] {
  return parseInline(text).map((run, i) => {
    switch (run.kind) {
      case 'code':
        return (
          <code key={i} className="rounded bg-tint/[0.07] px-1 py-px font-mono text-caption text-ink">
            {run.text}
          </code>
        )
      case 'bold':
        return (
          <strong key={i} className="font-semibold text-ink">
            {run.text}
          </strong>
        )
      case 'italic':
        return <em key={i}>{run.text}</em>
      default:
        return <Fragment key={i}>{run.text}</Fragment>
    }
  })
}

// ---- tool calls ----------------------------------------------------------------------------

const TOOL_TONE: Record<ToolCall['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: STATUS_COLOR.thinking },
  ok: { label: 'Done', color: STATUS_COLOR.completed },
  error: { label: 'Failed', color: STATUS_COLOR.failed },
}

/** One glyph per tool kind, so a glance at the chat shows whether the agent read, edited, ran or searched. */
const TOOL_GLYPH: Record<ToolKind, (p: { size?: number }) => ReactNode> = {
  read: IconFileRead,
  write: IconFileWrite,
  edit: (p) => <IconPencil size={p.size} />,
  shell: IconTerminal,
  search: IconSearch,
  web: IconGlobe,
  agent: IconAgent,
  mcp: IconPlug,
  other: IconTool,
}

/** Status glyph: spinner while running, check when done, cross when failed. */
function ToolStatusIcon({ status, color }: { status: ToolCall['status']; color: string }) {
  if (status === 'running') {
    return (
      <span
        className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none"
        style={{ color }}
        aria-hidden="true"
      />
    )
  }
  if (status === 'error') return <IconX size={12} aria-hidden="true" />
  return <IconCheck size={12} aria-hidden="true" />
}

/**
 * A tool call in the conversation. One quiet line by default. Completed calls show only a faint check,
 * while running and failed calls keep their label. Expanding shows the input and result.
 */
const ToolRow = memo(function ToolRow({ tool: t }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const tone = TOOL_TONE[t.status] ?? TOOL_TONE.running
  const Glyph = TOOL_GLYPH[toolKind(t.name)]
  const id = `tool-${t.id}`
  const done = t.status === 'ok'
  return (
    <div className={`rounded-md ${t.status === 'error' ? 'bg-danger/[0.06]' : ''}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption transition-colors duration-150 hover:bg-tint/[0.04]"
      >
        <IconChevronRight size={11} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        <span className={`shrink-0 ${done ? 'text-faint' : 'text-muted'}`}>
          <Glyph size={12} />
        </span>
        <span className={`shrink-0 font-mono text-caption ${done ? 'text-muted' : 'text-ink'}`}>{t.name || 'Tool'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-faint">{t.summary}</span>
        <span className={`flex shrink-0 items-center gap-1.5 text-label ${done ? 'text-faint' : ''}`} style={done ? undefined : { color: tone.color }}>
          <ToolStatusIcon status={t.status} color={done ? 'currentColor' : tone.color} />
          {done ? <span className="sr-only">{tone.label}</span> : tone.label}
        </span>
      </button>
      {open && (
        <div id={id} className="ml-[26px] mb-1 mt-0.5 space-y-2.5 pr-2">
          <CodeBlock label="Input" text={t.input} />
          <CodeBlock label="Result" text={t.output} placeholder={t.status === 'running' ? 'Waiting for result…' : 'No output'} danger={t.status === 'error'} />
        </div>
      )}
    </div>
  )
})

/** Words for a summary, per tool kind: [singular, plural]. */
const KIND_WORDS: Record<ToolKind, [string, string]> = {
  read: ['file read', 'files read'],
  write: ['file written', 'files written'],
  edit: ['edit', 'edits'],
  shell: ['command', 'commands'],
  search: ['search', 'searches'],
  web: ['web request', 'web requests'],
  agent: ['agent call', 'agent calls'],
  mcp: ['tool call', 'tool calls'],
  other: ['tool call', 'tool calls'],
}

/** "Completed 3 files read · 2 commands", so a collapsed run still says what happened. */
function summarizeTools(tools: ToolCall[]): string {
  const counts = new Map<ToolKind, number>()
  for (const t of tools) {
    const k = toolKind(t.name)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${n === 1 ? KIND_WORDS[k][0] : KIND_WORDS[k][1]}`)
  return `Completed ${parts.join(' · ')}`
}

/** A run of completed tool calls, collapsed behind one line. Expands to the individual rows. */
const ToolGroup = memo(function ToolGroup({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const id = `tools-${tools[0].id}`
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption text-muted transition-colors duration-150 hover:bg-tint/[0.04] hover:text-ink"
      >
        <IconChevronRight size={11} className={`shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{summarizeTools(tools)}</span>
        <IconCheck size={11} aria-hidden="true" className="shrink-0 text-faint" />
      </button>
      {open && (
        <div id={id} className="ml-[11px] mt-0.5 space-y-0.5 border-l border-line pl-1.5">
          {tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  )
})

type RenderUnit = { key: string; kind: 'item'; item: TimelineItem } | { key: string; kind: 'group'; tools: ToolCall[] }

/**
 * Collapses each run of two or more completed tool calls into one group. Anything else passes
 * through unchanged, so running, failed, and messages are never hidden.
 */
function groupRuns(items: TimelineItem[]): RenderUnit[] {
  const out: RenderUnit[] = []
  let run: Extract<TimelineItem, { kind: 'tool' }>[] = []
  const flush = () => {
    if (run.length >= 2) out.push({ key: `g:${run[0].tool.id}`, kind: 'group', tools: run.map((r) => r.tool) })
    else for (const r of run) out.push({ key: r.key, kind: 'item', item: r })
    run = []
  }
  for (const it of items) {
    if (it.kind === 'tool' && it.tool.status === 'ok') {
      run.push(it)
      continue
    }
    flush()
    out.push({ key: it.key, kind: 'item', item: it })
  }
  flush()
  return out
}

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
        <span className="text-label font-medium text-faint">{label}</span>
        {value && (
          <button onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-label text-faint transition-colors hover:text-ink">
            <IconCopy size={11} />
            Copy
          </button>
        )}
      </div>
      <pre
        className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-2.5 font-mono text-label leading-relaxed ${
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
          <div className="h-2 w-16 animate-pulse rounded bg-tint/[0.06] motion-reduce:animate-none" />
          <div className="h-8 animate-pulse rounded-xl bg-tint/[0.04] motion-reduce:animate-none" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

function LoadError({ agentId, message }: { agentId: string; message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
      <p className="text-body font-medium text-ink/85">Couldn’t load this conversation</p>
      <p className="mt-1 max-w-[280px] text-caption leading-relaxed text-faint">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadDetail(agentId)}>
        <IconRetry size={12} />
        Try again
      </Button>
    </div>
  )
}
