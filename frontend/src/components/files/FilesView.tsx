import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { api, errorText } from '../../lib/bridge'
import { listenFileChanges, useRepoStatus } from '../../lib/repoState'
import { attachToChat, getState, openFileEditor, setExplorerExpanded, toast, useStore } from '../../lib/store'
import {
  changedFolders,
  compareNames,
  marksByPath,
  nameProblem,
  nextIndex,
  parentRel,
  pickAttachTarget,
  TONE_COLOR,
  visibleRows,
  writerLabel,
  writersByPath,
  type GitMark,
  type Writer,
} from '../../lib/sourceView'
import { copyText, createEntry, deleteEntries, openEntry, renameEntry, revealEntry } from '../../lib/sourceActions'
import { baseName, dirName } from '../../lib/format'
import type { AgentSummary, FileEntry } from '../../types'
import { Button, Dialog, EmptyState, Spinner } from '../ui'
import { FileIcon } from '../ui/FileIcon'
import { OutlinedIcon } from '../ui/OutlinedIcon'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { Tooltip } from '../navigation/Tooltip'
import { FileEditor } from './FileEditor'

/** One line in the tree: a real entry, or the input row of a file or folder being created. */
type Item = { kind: 'entry'; entry: FileEntry; depth: number } | { kind: 'draft'; depth: number; dir: string; isDir: boolean }

interface Menu {
  x: number
  y: number
  paths: string[]
}

interface Renaming {
  path: string
  value: string
}

interface Creating {
  dir: string
  isDir: boolean
  value: string
}

/**
 * The Files sidebar: the selected project's folders and files, as git and the agents see them. Folders
 * load when opened, git-ignored entries stay hidden, and the tree refreshes from the file watcher. Files
 * open in the editor; the context menu and keyboard cover create, rename and delete.
 */
export function FilesView({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId])
  const agents = useStore((s) => s.agents)
  const agentOrder = useStore((s) => s.agentOrder)
  const selectedId = useStore((s) => s.selectedId)
  const fileEditor = useStore((s) => s.fileEditor)
  const { status } = useRepoStatus(projectId)

  const [listings, setListings] = useState<Record<string, FileEntry[]>>({})
  const [truncated, setTruncated] = useState<Record<string, boolean>>({})
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({})
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(getState().explorerExpanded[projectId] ?? []))
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ entries: FileEntry[]; truncated: boolean } | null>(null)
  const [searching, setSearching] = useState(false)

  const treeRef = useRef<HTMLDivElement>(null)
  const loaded = useRef<Set<string>>(new Set())
  const searchSeq = useRef(0)

  // ---- loading -------------------------------------------------------------------------

  const loadDir = useCallback(
    async (dir: string) => {
      setLoadingDirs((prev) => ({ ...prev, [dir]: true }))
      try {
        const l = await api.listProjectDirectory(projectId, dir)
        loaded.current.add(dir)
        setListings((prev) => ({ ...prev, [dir]: l.entries }))
        setTruncated((prev) => ({ ...prev, [dir]: l.truncated }))
        setDirErrors((prev) => withoutKey(prev, dir))
      } catch (err) {
        // A folder that vanished is dropped from the tree; anything else is shown on the folder.
        const message = errorText(err)
        if (/no longer exists|not a folder/i.test(message) && dir !== '') {
          loaded.current.delete(dir)
          setListings((prev) => withoutKey(prev, dir))
          setExpanded((prev) => dropPrefixSet(prev, dir, true))
        } else {
          setDirErrors((prev) => ({ ...prev, [dir]: message }))
        }
      } finally {
        setLoadingDirs((prev) => withoutKey(prev, dir))
      }
    },
    [projectId],
  )

  // Root and every folder that was open when the sidebar mounted.
  useEffect(() => {
    void loadDir('')
    for (const dir of expanded) void loadDir(dir)
    // Runs once per mount: the parent remounts this view when the project changes.
  }, [])

  // Keep the tree in step with the disk: reload only the folders the watcher named.
  useEffect(
    () =>
      listenFileChanges((change) => {
        if (change.projectId !== projectId) return
        for (const dir of change.dirs) if (loaded.current.has(dir)) void loadDir(dir)
      }),
    [projectId, loadDir],
  )

  const setExpandedAndStore = (next: Set<string>) => {
    setExpanded(next)
    setExplorerExpanded(projectId, [...next])
  }

  const expand = (dir: string) => {
    if (expanded.has(dir)) return
    const next = new Set(expanded)
    next.add(dir)
    setExpandedAndStore(next)
    void loadDir(dir)
  }

  const collapse = (dir: string) => {
    if (!expanded.has(dir)) return
    setExpandedAndStore(dropPrefixSet(expanded, dir, true))
  }

  const toggle = (dir: string) => (expanded.has(dir) ? collapse(dir) : expand(dir))

  // ---- search --------------------------------------------------------------------------

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = window.setTimeout(() => {
      api
        .findProjectFiles(projectId, q)
        .then((m) => {
          if (seq === searchSeq.current) setResults({ entries: m.entries ?? [], truncated: m.truncated })
        })
        .catch((err) => {
          if (seq === searchSeq.current) toast(errorText(err), 'error')
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false)
        })
    }, 160)
    return () => window.clearTimeout(t)
  }, [query, projectId])

  // ---- derived -------------------------------------------------------------------------

  const agentList = useMemo(
    () => agentOrder.map((id) => agents[id]).filter((a): a is AgentSummary => !!a && a.projectId === projectId),
    [agentOrder, agents, projectId],
  )
  const marks = useMemo(() => marksByPath(status?.changes ?? []), [status])
  const folders = useMemo(() => changedFolders(status?.changes ?? []), [status])
  const writers = useMemo(() => writersByPath(agentList), [agentList])

  const items: Item[] = useMemo(() => {
    const rows = visibleRows(listings, expanded)
    const out: Item[] = rows.map((r) => ({ kind: 'entry', entry: r.entry, depth: r.depth }))
    if (!creating) return out
    // The new-entry row sits at the top of its folder's children, or the top of the tree for the root.
    const at = creating.dir === '' ? -1 : out.findIndex((i) => i.kind === 'entry' && i.entry.path === creating.dir)
    const depth = creating.dir === '' ? 0 : (at >= 0 && out[at].kind === 'entry' ? out[at].depth + 1 : 1)
    const draft: Item = { kind: 'draft', depth, dir: creating.dir, isDir: creating.isDir }
    out.splice(at + 1, 0, draft)
    return out
  }, [listings, expanded, creating])

  const entryItems = items.filter((i): i is Extract<Item, { kind: 'entry' }> => i.kind === 'entry')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const focusedEntry = items[focusIdx]?.kind === 'entry' ? (items[focusIdx] as Extract<Item, { kind: 'entry' }>).entry : null

  // ---- selection ------------------------------------------------------------------------

  const selectOne = (path: string) => {
    setSelected([path])
    setAnchor(path)
  }

  const onRowClick = (e: MouseEvent, entry: FileEntry, index: number) => {
    setFocusIdx(index)
    if (e.shiftKey && anchor) {
      const paths = entryItems.map((i) => i.entry.path)
      const a = paths.indexOf(anchor)
      const b = paths.indexOf(entry.path)
      if (a >= 0 && b >= 0) setSelected(paths.slice(Math.min(a, b), Math.max(a, b) + 1))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => (prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path]))
      setAnchor(entry.path)
      return
    }
    selectOne(entry.path)
    if (entry.isDir) toggle(entry.path)
  }

  // ---- create, rename, delete -----------------------------------------------------------------

  const startCreate = (isDir: boolean) => {
    // New entries go in the selected folder, or beside the selected file.
    const target = focusedEntry ?? null
    let dir = ''
    if (target) dir = target.isDir ? target.path : parentRel(target.path)
    if (dir !== '') expand(dir)
    setRenaming(null)
    setCreateError(null)
    setCreating({ dir, isDir, value: '' })
  }

  const finishCreate = async () => {
    if (!creating) return
    const problem = nameProblem(creating.value)
    if (problem) {
      setCreateError(problem)
      return
    }
    const rel = await createEntry(projectId, creating.dir, creating.value.trim(), creating.isDir)
    if (rel === null) return
    setCreating(null)
    setCreateError(null)
    await loadDir(creating.dir)
    selectOne(rel)
    if (!creating.isDir) openFileEditor(projectId, rel)
  }

  const startRename = (entry: FileEntry) => {
    setCreating(null)
    setRenameError(null)
    setRenaming({ path: entry.path, value: entry.name })
  }

  const finishRename = async () => {
    if (!renaming) return
    const original = renaming.path
    const name = renaming.value.trim()
    if (name === baseName(original)) {
      setRenaming(null)
      return
    }
    const problem = nameProblem(name)
    if (problem) {
      setRenameError(problem)
      return
    }
    const next = await renameEntry(projectId, original, name)
    if (next === null) return
    setRenaming(null)
    setRenameError(null)
    const parent = parentRel(original)
    await loadDir(parent)
    // A renamed folder keeps its expansion and its loaded children under the new name.
    if (expanded.has(original)) {
      setExpandedAndStore(remapSet(expanded, original, next))
      loaded.current.delete(original)
      setListings((prev) => withoutKey(prev, original))
      await loadDir(next)
    }
    selectOne(next)
  }

  const askDelete = (paths: string[]) => {
    if (paths.length) setConfirmDelete(paths)
  }

  const runDelete = async () => {
    if (!confirmDelete) return
    const paths = confirmDelete
    setConfirmDelete(null)
    // Delete the outermost paths only: removing a folder takes its contents with it.
    const top = paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(q + '/')))
    const ok = await deleteEntries(projectId, top)
    if (!ok) return
    let next = expanded
    for (const p of top) next = dropPrefixSet(next, p, true)
    setExpandedAndStore(next)
    setSelected([])
    setAnchor(null)
    const parents = new Set(top.map(parentRel))
    for (const p of parents) await loadDir(p)
  }

  // ---- context menu -------------------------------------------------------------------------

  const openMenu = (e: MouseEvent, entry: FileEntry, index: number) => {
    e.preventDefault()
    setFocusIdx(index)
    const paths = selectedSet.has(entry.path) ? selected : [entry.path]
    if (!selectedSet.has(entry.path)) selectOne(entry.path)
    setMenu({ x: e.clientX, y: e.clientY, paths })
  }

  const menuItems = (paths: string[]): MenuItem[] => {
    const single = paths.length === 1 ? entryFor(paths[0]) : null
    const root = project?.repoPath ?? ''
    const items: MenuItem[] = []
    if (single && !single.isDir) {
      items.push({ label: 'Open in editor', icon: <OutlinedIcon name="edit_note" size={14} />, onSelect: () => openFileEditor(projectId, single.path) })
    }
    // Attach the selected files to the chat of the agent they are most relevant to.
    const files = paths.filter((p) => entryFor(p) && !entryFor(p)?.isDir)
    const target = pickAttachTarget(agentList, selectedId)
    if (files.length && target) {
      items.push({
        label: `Attach to ${target.name}'s chat`,
        icon: <OutlinedIcon name="attach_file" size={14} />,
        onSelect: () => {
          attachToChat(target.id, files)
          toast(files.length === 1 ? `Attached ${baseName(files[0])} to ${target.name}’s chat.` : `Attached ${files.length} files to ${target.name}’s chat.`, 'success')
        },
      })
    }
    if (single) {
      items.push({ label: 'Open in default app', icon: <OutlinedIcon name="open_in_new" size={14} />, onSelect: () => void openEntry(projectId, single.path) })
      items.push({ label: 'Show in folder', icon: <OutlinedIcon name="folder_open" size={14} />, onSelect: () => void revealEntry(projectId, single.path) })
    }
    if (single) {
      items.push({ label: 'Rename', icon: <OutlinedIcon name="drive_file_rename_outline" size={14} />, onSelect: () => startRename(single) })
    }
    items.push({ label: 'New file', icon: <OutlinedIcon name="note_add" size={14} />, onSelect: () => startCreate(false) })
    items.push({ label: 'New folder', icon: <OutlinedIcon name="create_new_folder" size={14} />, onSelect: () => startCreate(true) })
    if (single) {
      items.push({
        label: 'Copy relative path',
        icon: <OutlinedIcon name="content_copy" size={14} />,
        onSelect: () => void copyText(single.path, 'Relative path'),
      })
      items.push({
        label: 'Copy full path',
        icon: <OutlinedIcon name="content_copy" size={14} />,
        onSelect: () => void copyText(absolute(root, single.path), 'Full path'),
      })
    }
    items.push({
      label: paths.length > 1 ? `Delete ${paths.length} items` : 'Delete',
      icon: <OutlinedIcon name="delete" size={14} />,
      danger: true,
      onSelect: () => askDelete(paths),
    })
    return items
  }

  const entryFor = (path: string): FileEntry | undefined => {
    for (const list of Object.values(listings)) {
      const hit = list.find((e) => e.path === path)
      if (hit) return hit
    }
    return undefined
  }

  // ---- keyboard ------------------------------------------------------------------------------

  const focusRow = (index: number) => {
    setFocusIdx(index)
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.focus())
  }

  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming || creating) return
    const current = items[focusIdx]
    const entry = current?.kind === 'entry' ? current.entry : null
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        e.preventDefault()
        focusRow(nextIndex(focusIdx, items.length, e.key))
        return
      case 'ArrowRight':
        if (!entry) return
        e.preventDefault()
        if (entry.isDir && !expanded.has(entry.path)) expand(entry.path)
        else if (entry.isDir && focusIdx + 1 < items.length) focusRow(focusIdx + 1)
        return
      case 'ArrowLeft':
        if (!entry) return
        e.preventDefault()
        if (entry.isDir && expanded.has(entry.path)) collapse(entry.path)
        else {
          const parent = parentRel(entry.path)
          const idx = items.findIndex((i) => i.kind === 'entry' && i.entry.path === parent)
          if (idx >= 0) {
            selectOne(parent)
            focusRow(idx)
          }
        }
        return
      case 'Enter':
        if (!entry) return
        e.preventDefault()
        if (entry.isDir) toggle(entry.path)
        else openFileEditor(projectId, entry.path)
        return
      case 'F2':
        if (entry) {
          e.preventDefault()
          startRename(entry)
        }
        return
      case 'Delete':
        if (selected.length) {
          e.preventDefault()
          askDelete(selected)
        }
        return
      case 'Escape':
        setSelected([])
        setAnchor(null)
        return
      case 'ContextMenu':
        if (entry) {
          e.preventDefault()
          const el = treeRef.current?.querySelector<HTMLElement>(`[data-idx="${focusIdx}"]`)
          const r = el?.getBoundingClientRect()
          setMenu({ x: (r?.left ?? 0) + 24, y: (r?.bottom ?? 0), paths: selectedSet.has(entry.path) ? selected : [entry.path] })
        }
        return
      default:
        return
    }
  }

  // ---- render --------------------------------------------------------------------------------

  if (!project) {
    return <EmptyState title="No project selected" body="Choose a project to see its files." />
  }

  const rootError = dirErrors['']
  // Before the first read lands the root is not loaded yet, which is loading, not an empty folder.
  const rootLoading = !listings[''] && !rootError

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search files</span>
          <OutlinedIcon name="search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            aria-label="Search files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                treeRef.current?.querySelector<HTMLElement>('[data-search-result]')?.focus()
              }
            }}
            placeholder="Search files"
            className="h-7 w-full rounded-md border border-line bg-canvas pl-7 pr-2 text-caption text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
        </label>
        <Tooltip label="New file">
          <button type="button" onClick={() => startCreate(false)} aria-label="New file" className={iconButton}>
            <OutlinedIcon name="note_add" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="New folder">
          <button type="button" onClick={() => startCreate(true)} aria-label="New folder" className={iconButton}>
            <OutlinedIcon name="create_new_folder" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Collapse all">
          <button
            type="button"
            onClick={() => setExpandedAndStore(new Set())}
            aria-label="Collapse all folders"
            disabled={expanded.size === 0}
            className={`${iconButton} disabled:opacity-40`}
          >
            <OutlinedIcon name="unfold_less" size={15} />
          </button>
        </Tooltip>
      </div>

      {query.trim() ? (
        <SearchResults
          results={results}
          searching={searching}
          marks={marks}
          writers={writers}
          onOpen={(path) => openFileEditor(projectId, path)}
          onContextMenu={(e, path) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, paths: [path] })
          }}
          onBackToTree={() => setQuery('')}
        />
      ) : rootLoading ? (
        <div className="px-3 py-6">
          <Spinner label="Reading the folder…" />
        </div>
      ) : rootError ? (
        <div className="space-y-3 px-4 py-6">
          <p className="text-caption text-danger-soft">{rootError}</p>
          <Button size="sm" onClick={() => void loadDir('')}>
            Try again
          </Button>
        </div>
      ) : (
        <div
          ref={treeRef}
          role="tree"
          aria-label="Project files"
          tabIndex={0}
          onKeyDown={onTreeKey}
          onFocus={() => {
            if (items.length && focusIdx >= items.length) setFocusIdx(0)
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRenaming(null)
          }}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-tint/[0.12]"
        >
          {items.length === 0 && (
            <p className="px-4 py-6 text-caption text-faint">This folder is empty. Right-click to add a file or folder.</p>
          )}
          {items.map((item, idx) => {
            if (item.kind === 'draft') {
              return (
                <DraftRow
                  key="draft"
                  depth={item.depth}
                  isDir={item.isDir}
                  value={creating?.value ?? ''}
                  error={createError}
                  onChange={(value) => {
                    setCreateError(null)
                    setCreating((c) => (c ? { ...c, value } : c))
                  }}
                  onSubmit={() => void finishCreate()}
                  onCancel={() => {
                    setCreating(null)
                    setCreateError(null)
                  }}
                />
              )
            }
            const { entry, depth } = item
            const isExpanded = expanded.has(entry.path)
            const writing = writers.get(entry.path)
            const mark = marks.get(entry.path)
            const dirHasChanges = entry.isDir && folders.has(entry.path)
            const isRenaming = renaming?.path === entry.path
            const sel = selectedSet.has(entry.path)
            const loadingThis = loadingDirs[entry.path]
            const err = dirErrors[entry.path]
            return (
              <div key={entry.path}>
                <div
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-selected={sel}
                  aria-expanded={entry.isDir ? isExpanded : undefined}
                  aria-label={entry.name}
                  data-idx={idx}
                  tabIndex={idx === focusIdx ? 0 : -1}
                  title={entry.path}
                  onClick={(e) => onRowClick(e, entry, idx)}
                  onDoubleClick={() => !entry.isDir && openFileEditor(projectId, entry.path)}
                  onContextMenu={(e) => openMenu(e, entry, idx)}
                  onFocus={() => setFocusIdx(idx)}
                  style={{ paddingLeft: 6 + depth * 14 }}
                  className={`group mx-1 flex h-[26px] cursor-default select-none items-center gap-1.5 rounded-md pr-2 text-caption outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-tint/[0.2] ${
                    sel ? 'bg-tint/[0.08] text-ink' : 'text-ink/90 hover:bg-tint/[0.04]'
                  }`}
                >
                  {entry.isDir ? (
                    <OutlinedIcon name={isExpanded ? 'expand_more' : 'chevron_right'} size={14} className="shrink-0 text-faint" />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {entry.isDir ? (
                    <OutlinedIcon name={isExpanded ? 'folder_open' : 'folder'} size={15} className="shrink-0 text-muted" />
                  ) : (
                    <FileIcon path={entry.path} size={14} />
                  )}

                  {isRenaming ? (
                    <RenameInput
                      value={renaming!.value}
                      error={renameError}
                      onChange={(value) => {
                        setRenameError(null)
                        setRenaming((r) => (r ? { ...r, value } : r))
                      }}
                      onSubmit={() => void finishRename()}
                      onCancel={() => {
                        setRenaming(null)
                        setRenameError(null)
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate" style={mark ? { color: TONE_COLOR[mark.tone] } : undefined}>
                      {entry.name}
                    </span>
                  )}

                  {loadingThis && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-tint/30 motion-reduce:animate-none" aria-label="Loading" role="status" />}
                  {err && !loadingThis && (
                    <Tooltip label={err}>
                      <OutlinedIcon name="error" size={13} className="shrink-0 text-danger-soft" />
                    </Tooltip>
                  )}
                  {writing && <WriterDot writers={writing} />}
                  {dirHasChanges && !writing && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-writing/80" title="Contains changes" aria-label="Contains changes" />}
                  {mark && !isRenaming && <MarkLetter mark={mark} />}
                </div>
                {entry.isDir && isExpanded && truncated[entry.path] && (
                  <p style={{ paddingLeft: 26 + depth * 14 }} className="py-1 text-label text-faint">
                    Showing the first {(listings[entry.path] ?? []).length.toLocaleString()} items.
                  </p>
                )}
              </div>
            )
          })}
          {truncated[''] && <p className="px-4 py-2 text-label text-faint">Showing the first {(listings[''] ?? []).length.toLocaleString()} items.</p>}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.paths)} onClose={() => setMenu(null)} label="File actions" />
      )}

      {confirmDelete && (
        <Dialog
          title={confirmDelete.length === 1 ? `Delete ${baseName(confirmDelete[0])}?` : `Delete ${confirmDelete.length} items?`}
          description="This removes them from disk. Folders are deleted with everything in them, and this cannot be undone."
          onClose={() => setConfirmDelete(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={() => void runDelete()}>
                Delete
              </Button>
            </div>
          }
        >
          <ul className="max-h-40 space-y-1 overflow-auto font-mono text-caption text-muted">
            {confirmDelete.slice(0, 8).map((p) => (
              <li key={p} className="truncate">
                {p}
              </li>
            ))}
            {confirmDelete.length > 8 && <li className="text-faint">and {confirmDelete.length - 8} more</li>}
          </ul>
        </Dialog>
      )}

      {fileEditor && fileEditor.projectId === projectId && <FileEditor projectId={projectId} path={fileEditor.path} />}
    </div>
  )
}

const iconButton =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink focus-visible:ring-1 focus-visible:ring-tint/[0.2] outline-none'

function MarkLetter({ mark }: { mark: GitMark }) {
  return (
    <span className="shrink-0 font-mono text-label font-semibold" style={{ color: TONE_COLOR[mark.tone] }} title={mark.label} aria-label={mark.label}>
      {mark.letter}
    </span>
  )
}

function WriterDot({ writers }: { writers: Writer[] }) {
  const label = `${writerLabel(writers)} ${writers.length === 1 ? 'is' : 'are'} writing this file`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
      style={{ background: 'var(--color-status-writing)' }}
    />
  )
}

function DraftRow({
  depth,
  isDir,
  value,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number
  isDir: boolean
  value: string
  error: string | null
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ paddingLeft: 6 + depth * 14 }} className="mx-1 py-0.5 pr-2">
      <div className="flex items-center gap-1.5">
        <span className="w-3.5 shrink-0" aria-hidden="true" />
        <OutlinedIcon name={isDir ? 'folder' : 'draft'} size={15} className="shrink-0 text-muted" />
        <input
          autoFocus
          value={value}
          aria-label={isDir ? 'New folder name' : 'New file name'}
          aria-invalid={!!error}
          placeholder={isDir ? 'Folder name' : 'File name'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onSubmit()
            if (e.key === 'Escape') onCancel()
          }}
          onBlur={() => {
            if (!value.trim()) onCancel()
          }}
          className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1.5 text-caption text-ink focus:outline-none"
        />
      </div>
      {error && <p className="mt-1 pl-6 text-label text-danger-soft">{error}</p>}
    </div>
  )
}

function RenameInput({
  value,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  error: string | null
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the name without its extension, so typing replaces the name and keeps ".go".
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
    // Selection is set once, when the input opens.
  }, [])
  return (
    <span className="relative min-w-0 flex-1">
      <input
        ref={ref}
        value={value}
        aria-label="Rename"
        aria-invalid={!!error}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={onCancel}
        className="h-5 w-full min-w-0 rounded border border-line-strong bg-canvas px-1 text-caption text-ink focus:outline-none"
      />
      {error && <span className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-canvas px-1 text-label text-danger-soft">{error}</span>}
    </span>
  )
}

function SearchResults({
  results,
  searching,
  marks,
  writers,
  onOpen,
  onContextMenu,
  onBackToTree,
}: {
  results: { entries: FileEntry[]; truncated: boolean } | null
  searching: boolean
  marks: Map<string, GitMark>
  writers: Map<string, Writer[]>
  onOpen: (path: string) => void
  onContextMenu: (e: MouseEvent, path: string) => void
  onBackToTree: () => void
}) {
  if (!results) {
    return searching ? <div className="px-3 py-6"><Spinner label="Searching…" /></div> : null
  }
  if (results.entries.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-caption text-ink/85">No files match.</p>
        <button type="button" onClick={onBackToTree} className="mt-2 text-caption text-muted underline-offset-4 hover:text-ink hover:underline">
          Back to the tree
        </button>
      </div>
    )
  }
  const sorted = [...results.entries].sort((a, b) => compareNames(a.name, b.name))
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <ul role="listbox" aria-label="Search results" className="space-y-px px-1">
        {sorted.map((e) => {
          const mark = marks.get(e.path)
          const w = writers.get(e.path)
          return (
            <li key={e.path}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                data-search-result
                onClick={() => onOpen(e.path)}
                onDoubleClick={() => onOpen(e.path)}
                onContextMenu={(ev) => onContextMenu(ev, e.path)}
                onKeyDown={(ev) => {
                  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault()
                    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-search-result]'))
                    const i = all.indexOf(ev.currentTarget)
                    all[Math.max(0, Math.min(all.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))]?.focus()
                  }
                }}
                title={e.path}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-tint/[0.04] focus-visible:bg-tint/[0.06] focus-visible:outline-none"
              >
                <FileIcon path={e.path} size={14} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption" style={mark ? { color: TONE_COLOR[mark.tone] } : undefined}>
                    {e.name}
                  </span>
                  {dirName(e.path) && <span className="block truncate font-mono text-label text-faint">{dirName(e.path)}</span>}
                </span>
                {w && <WriterDot writers={w} />}
                {mark && <MarkLetter mark={mark} />}
              </button>
            </li>
          )
        })}
      </ul>
      {results.truncated && <p className="px-4 py-2 text-label text-faint">Showing the best matches. Narrow the search to see more.</p>}
    </div>
  )
}

/** The absolute path of a root-relative one, using the separator the project folder uses. */
export function absolute(root: string, rel: string): string {
  if (!root) return rel
  const sep = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + (sep === '\\' ? rel.split('/').join('\\') : rel)
}

function withoutKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj
  const next = { ...obj }
  delete next[key]
  return next
}

/** Removes a folder and every folder beneath it from a set. */
function dropPrefixSet(set: Set<string>, dir: string, includeSelf: boolean): Set<string> {
  const next = new Set<string>()
  for (const d of set) if (!(d === dir ? includeSelf : d.startsWith(dir + '/'))) next.add(d)
  return next
}

/** Renames a folder inside an expansion set, along with the folders beneath it. */
function remapSet(set: Set<string>, from: string, to: string): Set<string> {
  const next = new Set<string>()
  for (const d of set) {
    if (d === from) next.add(to)
    else if (d.startsWith(from + '/')) next.add(to + d.slice(from.length))
    else next.add(d)
  }
  return next
}
