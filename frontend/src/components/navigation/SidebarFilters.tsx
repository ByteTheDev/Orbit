import type { KeyboardEvent } from 'react'
import { IconX } from '../ui'
import { AGENT_BUCKETS, BUCKET_LABEL, type AgentBucket } from './agentStatus'

interface Props {
  query: string
  onQuery: (q: string) => void
  provider: string | null
  providers: { id: string; name: string }[]
  onProvider: (id: string | null) => void
  bucket: AgentBucket | null
  bucketCounts: Record<AgentBucket, number>
  onBucket: (b: AgentBucket | null) => void
  onReset: () => void
}

/**
 * Search for projects and agents, with two rows of chips beneath. Status chips show how many
 * agents each group holds. Provider chips appear only when more than one provider is in use.
 * Escape clears the text first, then the chips.
 */
export function SidebarFilters({ query, onQuery, provider, providers, onProvider, bucket, bucketCounts, onBucket, onReset }: Props) {
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
    <div className="space-y-2 px-3 pb-2.5">
      <label className="group relative block">
        <span className="sr-only">Search projects and agents</span>
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search projects, agents, tasks"
          className="h-8 w-full rounded-lg border border-transparent bg-white/[0.035] pl-8 pr-8 text-caption text-ink placeholder:text-faint outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:bg-white/[0.055] focus:border-line-strong focus:bg-canvas focus:ring-[3px] focus:ring-white/[0.06] [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-white/[0.07] hover:text-ink"
          >
            <IconX size={10} />
          </button>
        )}
      </label>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
        <Chip active={bucket === null} onClick={() => onBucket(null)}>
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
      className={`flex h-6 items-center gap-1 rounded-full px-2 text-label leading-none transition-[background-color,color,border-color] duration-150 disabled:opacity-35 ${
        active
          ? 'border border-line-strong bg-white/[0.1] text-ink'
          : 'border border-transparent bg-white/[0.03] text-muted hover:bg-white/[0.07] hover:text-ink'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && <span className={`tabular-nums ${active ? 'text-muted' : 'text-faint'}`}>{count}</span>}
    </button>
  )
}

function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  )
}
