import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import {
  UNFILED_KEY,
  buildFolderTree,
  countUnfiled,
  type FolderNode,
} from '../../lib/folders'
import { Input } from '../ui/core'

/**
 * Nested folder tree.
 * Selecting a parent folder includes all its subfolders; repo paths follow the same hierarchy.
 */
export function FolderTree<T>({
  items,
  getFolder,
  selected,
  onSelect,
  className,
  title = 'Folders',
}: {
  items: T[]
  getFolder: (item: T) => string | null | undefined
  selected: string
  onSelect: (folder: string) => void
  className?: string
  title?: string
}) {
  const folders = useMemo(() => buildFolderTree(items, getFolder), [items, getFolder])
  const unfiled = useMemo(() => countUnfiled(items, getFolder), [items, getFolder])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!selected || selected === UNFILED_KEY) return
    const parts = selected.split('/')
    setExpanded((prev) => {
      const next = new Set(prev)
      let path = ''
      for (const part of parts) {
        path = path ? `${path}/${part}` : part
        next.add(path)
      }
      return next
    })
  }, [selected])

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderNode = (node: FolderNode, depth: number): ReactNode => {
    const active = selected === node.path
    const hasChildren = node.children.length > 0
    const open = expanded.has(node.path)
    return (
      <div key={node.path}>
        <div
          className={cn(
            'group flex items-center gap-0.5 rounded-md pr-1 transition-colors',
            active
              ? 'bg-primary-soft text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          style={{ paddingLeft: 2 + depth * 12 }}
        >
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:text-foreground',
              !hasChildren && 'invisible',
            )}
            onClick={() => toggle(node.path)}
            aria-label={open ? 'Collapse' : 'Expand'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              onSelect(node.path)
              if (hasChildren && !open) toggle(node.path)
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
            title={node.path}
          >
            <Icon name="folder" className={cn('h-3.5 w-3.5 shrink-0', active && 'text-primary')} />
            <span className={cn('truncate text-[12px]', active && 'font-medium')}>{node.name}</span>
            <span
              className={cn(
                'tabular ml-auto shrink-0 rounded px-1 text-[9.5px] leading-4',
                active ? 'bg-primary/10 text-primary' : 'bg-muted/80 text-muted-foreground',
              )}
            >
              {node.count}
            </span>
          </button>
        </div>
        {open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon name="folder" className="h-3.5 w-3.5" />
        <span className="truncate">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={() => onSelect('')}
          className={cn(
            'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
            !selected
              ? 'bg-primary-soft font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon name="grid" className="h-3.5 w-3.5" />
          All
          <span
            className={cn(
              'tabular ml-auto rounded px-1 text-[9.5px] leading-4',
              !selected ? 'bg-primary/10 text-primary' : 'bg-muted/80 text-muted-foreground',
            )}
          >
            {items.length}
          </span>
        </button>
        <div className="mt-1 space-y-0.5">{folders.map((node) => renderNode(node, 0))}</div>
        {unfiled > 0 && (
          <button
            type="button"
            onClick={() => onSelect(UNFILED_KEY)}
            className={cn(
              'mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
              selected === UNFILED_KEY
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon name="file" className="h-3.5 w-3.5" />
            Uncategorized
            <span
              className={cn(
                'tabular ml-auto rounded px-1 text-[9.5px] leading-4',
                selected === UNFILED_KEY
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/80 text-muted-foreground',
              )}
            >
              {unfiled}
            </span>
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1.5 border-t border-border px-3.5 py-2 text-[9.5px] leading-4 text-muted-foreground/85">
        <Icon name="gitBranch" className="mt-px h-3 w-3 shrink-0" />
        Folders map directly to repo directories
      </div>
    </div>
  )
}

/** Folder input in edit dialogs: nested paths, autocomplete from existing folders, live repo path preview */
export function FolderField({
  value,
  onChange,
  options,
  pathPreview,
  label = 'Folder',
  hint,
}: {
  value: string | null
  onChange: (value: string | null) => void
  options: string[]
  pathPreview?: string
  label?: string
  hint?: string
}) {
  const listId = useId()
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        aria-label={label}
        list={listId}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
        placeholder="e.g. engineering/frontend"
        className="font-mono text-xs"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        Use <code className="rounded bg-muted px-1">/</code> for nested directories; leave empty for Uncategorized.
        {hint ? ` ${hint}` : ''}
      </p>
      {pathPreview && (
        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">→ {pathPreview}</p>
      )}
    </div>
  )
}
