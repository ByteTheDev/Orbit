import type { KeyboardEvent } from 'react'
import { IconX, MaterialIcon } from '../ui'
import { AGENT_BUCKETS, BUCKET_LABEL, type AgentBucket } from './agentStatus'

interface Props {
  query: string
  onQuery: (q: string) => void
  provider: string | null
  providers: { id: string; name: string }[]
  onProvider: (id: string | null) => void
  bucket: AgentBucket | null
  bucketCounts: Record<AgentBucket, number>
  /** Every agent, shown on the All chip. Omit to show the chip without a count. */
  total?: number
  onBucket: (b: AgentBucket | null) => void
  onReset: () => void
}

/**
 * Search for projects and agents, with two rows of chips beneath. Status chips show how many
 * agents each group holds. Provider chips appear only when more than one provider is in use.
 * Escape clears the text first, then the chips.
 */
export function SidebarFilters({ query, onQuery, provider, providers, onProvider, bucket, bucketCounts, total, onBucket, onReset }: Props) {
  const filtering = query.trim() !== '' || provider !== null || bucket !== null

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    if (query) {
      e.preventDefault()
      e.stopPropagation()
      onQuery('')
    } else if (filtering) {
      e.preventDefault()
      e.stopPropagation()
      onReset()
    }
  }

  return (
    <div className="space-y-1.5 px-3 pb-2">
      <label className="group relative block">
        <span className="sr-only">Search projects and agents</span>
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search projects, agents, tasks"
          className="h-8 w-full rounded-md bg-tint/[0.04] pl-8 pr-8 text-caption text-ink placeholder:text-faint outline-none transition-colors duration-150 hover:bg-tint/[0.06] focus:bg-canvas [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-tint/[0.07] hover:text-ink"
          >
            <IconX size={10} />
          </button>
        )}
      </label>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
        <Chip active={bucket === null} onClick={() => onBucket(null)} count={total}>
          All
        </Chip>
        {AGENT_BUCKETS.map((b) => (
          <Chip key={b} active={bucket === b} onClick={() => onBucket(bucket === b ? null : b)} count={bucketCounts[b]} disabled={bucketCounts[b] === 0 && bucket !== b}>
            {BUCKET_LABEL[b]}
          </Chip>
        ))}
      </div>

      {providers.length > 1 && (
        <div role="group" aria-label="Filter by provider" className="flex flex-wrap gap-1">
          <Chip active={provider === null} onClick={() => onProvider(null)}>
            Any provider
          </Chip>
          {providers.map((p) => (
            <Chip key={p.id} active={provider === p.id} onClick={() => onProvider(provider === p.id ? null : p.id)}>
              {p.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  count,
  disabled = false,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  disabled?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={`nav-item flex h-6 items-center gap-1.5 px-2 text-label leading-none transition-[background-color,color] duration-150 disabled:opacity-35 ${
        active ? 'bg-nav-active text-ink' : 'text-muted hover:bg-nav-hover hover:text-ink'
      }`}
    >
      {children}
      {count !== undefined && <span className={`tabular-nums ${active ? 'text-muted' : 'text-faint'}`}>{count}</span>}
    </button>
  )
}

function SearchIcon() {
  return <MaterialIcon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
}
