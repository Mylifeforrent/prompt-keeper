import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { FolderNode } from '../../../shared/contracts'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { Input } from '../ui/primitives'

/**
 * Nested folder tree rendered from `prompts.folders` (or `AssetListResult.folders`).
 * Selecting a folder includes its descendants; the empty path means all assets.
 */
export function FolderTree({
  nodes,
  selected,
  onSelect,
  totalCount,
  title = 'Folders',
}: {
  nodes: FolderNode[]
  selected: string
  onSelect: (folder: string) => void
  totalCount: number
  title?: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!selected) return
    const parts = selected.split('/')
    setExpanded((current) => {
      const next = new Set(current)
      let path = ''
      for (const part of parts) {
        path = path ? `${path}/${part}` : part
        next.add(path)
      }
      return next
    })
  }, [selected])

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const countClass = (active: boolean) =>
    cn(
      'tabular ml-auto shrink-0 rounded px-1 text-[9.5px] leading-4',
      active ? 'bg-primary/10 text-primary' : 'bg-muted/80 text-muted-foreground',
    )

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
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={hasChildren ? open : undefined}
            title={open ? 'Collapse' : 'Expand'}
            tabIndex={hasChildren ? 0 : -1}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              onSelect(node.path)
              if (hasChildren && !open) toggle(node.path)
            }}
            aria-pressed={active}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
            title={node.path}
          >
            <Icon name="folder" className={cn('h-3.5 w-3.5 shrink-0', active && 'text-primary')} />
            <span className={cn('truncate text-[12px]', active && 'font-medium')}>{node.name}</span>
            <span className={countClass(active)}>{node.totalCount}</span>
          </button>
        </div>
        {open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon name="folder" className="h-3.5 w-3.5" />
        <span className="truncate">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={() => onSelect('')}
          aria-pressed={selected === ''}
          className={cn(
            'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
            !selected
              ? 'bg-primary-soft font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon name="grid" className="h-3.5 w-3.5" />
          <span className="truncate">All assets</span>
          <span className={cn('tabular ml-auto rounded px-1 text-[9.5px] leading-4', !selected ? 'bg-primary/10 text-primary' : 'bg-muted/80 text-muted-foreground')}>
            {totalCount}
          </span>
        </button>
        <div className="mt-1 space-y-0.5">
          {nodes.length === 0 ? (
            <p className="px-2 py-2 text-[11px] leading-4 text-muted-foreground/85">
              No folders yet. The folder you set while creating a Prompt appears here and becomes a
              repository directory on the next push.
            </p>
          ) : (
            nodes.map((node) => renderNode(node, 0))
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1.5 border-t border-border px-3.5 py-2 text-[9.5px] leading-4 text-muted-foreground/85">
        <Icon name="gitBranch" className="mt-px h-3 w-3 shrink-0" />
        Folders map 1:1 to repository directories
      </div>
    </div>
  )
}

/**
 * Folder input used by edit dialogs. Kept in this module because it shares the
 * folder vocabulary; it takes plain path options instead of building a tree.
 */
export function FolderField({
  value,
  onChange,
  options,
  pathPreview,
  label = 'Folder',
  hint,
  disabled,
}: {
  value: string | null
  onChange: (value: string | null) => void
  options: string[]
  pathPreview?: string
  label?: string
  hint?: string
  disabled?: boolean
}) {
  const listId = useId()
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        aria-label={label}
        list={listId}
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value.trim() ? event.target.value : null)}
        placeholder="e.g. engineering/frontend"
        className="font-mono text-xs"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        Use <code className="rounded bg-muted px-1">/</code> for nested directories; leave empty for
        Unfiled.
        {hint ? ` ${hint}` : ''}
      </p>
      {pathPreview && (
        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">→ {pathPreview}</p>
      )}
    </div>
  )
}
