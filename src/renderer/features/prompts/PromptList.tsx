import type { AssetSyncState, PromptListItem } from '../../../shared/contracts'
import { Badge, Button, EmptyState, Input, Select } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { syncStateMeta } from '../../lib/viewModels/assetStatus'
import {
  promptExcerpt,
  promptFolderLabel,
  promptFolderPath,
  type PromptSort,
  type PromptViewMode,
} from '../../lib/viewModels/prompt'

export interface PromptListProps {
  items: PromptListItem[]
  total: number
  view: PromptViewMode
  onViewChange: (view: PromptViewMode) => void
  sort: PromptSort
  onSortChange: (sort: PromptSort) => void
  search: string
  onSearchChange: (value: string) => void
  tags: string[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  favoriteOnly: boolean
  onFavoriteOnlyChange: (value: boolean) => void
  selectedId: string | null
  onSelect: (id: string) => void
  hasFilter: boolean
  onClearFilters: () => void
  onCreate: () => void
  isLoading: boolean
  error: string | null
  onRetry: () => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}

function SyncPill({ state }: { state: AssetSyncState }) {
  const meta = syncStateMeta(state)
  return (
    <Badge variant={meta.tone} title={meta.description} className="shrink-0 gap-1 px-1.5 font-normal">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
      {meta.shortLabel}
    </Badge>
  )
}

function SkeletonList({ view }: { view: PromptViewMode }) {
  if (view === 'table') {
    return (
      <div className="space-y-2 px-3 py-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-2.5 px-3 py-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-3.5">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted/80" />
          <div className="mt-3 h-8 animate-pulse rounded-md bg-muted/60" />
        </div>
      ))}
    </div>
  )
}

function groupByFolder(items: PromptListItem[]): Array<{ folder: string; items: PromptListItem[] }> {
  const groups = new Map<string, PromptListItem[]>()
  for (const item of items) {
    const list = groups.get(item.folder) ?? []
    list.push(item)
    groups.set(item.folder, list)
  }
  return [...groups.entries()]
    .map(([folder, groupItems]) => ({ folder, items: groupItems }))
    .sort((a, b) => {
      if (a.folder === '') return 1
      if (b.folder === '') return -1
      return a.folder.localeCompare(b.folder, 'en')
    })
}

export function PromptList({
  items,
  total,
  view,
  onViewChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  tags,
  selectedTags,
  onToggleTag,
  favoriteOnly,
  onFavoriteOnlyChange,
  selectedId,
  onSelect,
  hasFilter,
  onClearFilters,
  onCreate,
  isLoading,
  error,
  onRetry,
  page,
  pageSize,
  onPageChange,
}: PromptListProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : page * pageSize + 1
  const end = Math.min(total, page * pageSize + items.length)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2.5">
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter Prompts"
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter this list…"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear list search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon name="x" className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Select
            aria-label="Sort Prompts"
            className="h-8 flex-1 text-xs"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as PromptSort)}
          >
            <option value="updated">Last updated</option>
            <option value="created">Date created</option>
            <option value="title">Title</option>
            <option value="usage">Most used</option>
          </Select>
          <button
            type="button"
            onClick={() => onFavoriteOnlyChange(!favoriteOnly)}
            aria-pressed={favoriteOnly}
            aria-label="Favorites only"
            title="Favorites only"
            className={cn(
              'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors',
              favoriteOnly
                ? 'border-warning/50 bg-warning-soft text-warning'
                : 'border-input text-muted-foreground hover:border-border-strong hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon name="star" className="h-3.5 w-3.5" />
          </button>
          <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-input bg-card p-0.5">
            {(
              [
                { value: 'cards' as const, icon: 'grid' as const, label: 'Card view' },
                { value: 'table' as const, icon: 'sliders' as const, label: 'Table view' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onViewChange(option.value)}
                aria-label={option.label}
                aria-pressed={view === option.value}
                title={option.label}
                className={cn(
                  'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
                  view === option.value
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon name={option.icon} className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>

        <div
          role="group"
          aria-label="Tag filter"
          className="flex items-center gap-1 overflow-x-auto pb-0.5 pr-5 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]"
        >
          {tags.length === 0 && (
            <span className="text-[11px] text-muted-foreground/85">No tags yet</span>
          )}
          {tags.map((tag) => {
            const active = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                aria-pressed={active}
                className={cn(
                  'shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-[3px] text-[10.5px] transition-colors',
                  active
                    ? 'border-primary/40 bg-primary-soft font-medium text-primary'
                    : 'border-border/80 text-muted-foreground hover:border-border-strong hover:bg-muted',
                )}
              >
                #{tag}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <EmptyState
            icon="alert"
            title="Prompts could not be loaded"
            description={error}
            action={
              <Button variant="outline" size="sm" onClick={onRetry}>
                <Icon name="refresh" />
                Retry
              </Button>
            }
          />
        ) : isLoading ? (
          <SkeletonList view={view} />
        ) : items.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon="search"
              title="No Prompts match these filters"
              description="Search, tags, favorites, or the selected folder may be too narrow."
              action={
                <Button variant="outline" size="sm" onClick={onClearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="message"
              title="No Prompts yet"
              description="Prompts are reusable AI templates. Write a system and user body with {{variables}}, then copy or test them. Git sync is optional."
              action={
                <Button onClick={onCreate}>
                  <Icon name="plus" />
                  Create Prompt
                </Button>
              }
            />
          )
        ) : view === 'table' ? (
          <div className="px-3 pb-4">
            <table className="w-full table-fixed text-left text-[12.5px]">
              <colgroup>
                <col />
                <col className="w-[84px]" />
                <col className="w-[46px]" />
                <col className="w-[72px]" />
                <col className="w-[58px]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background/95 text-[10.5px] text-muted-foreground backdrop-blur">
                <tr className="border-b border-border">
                  <th className="py-2 pl-1 pr-2 font-medium">Title</th>
                  <th className="py-2 pr-2 font-medium">Folder</th>
                  <th className="py-2 pr-2 font-medium">Vars</th>
                  <th className="py-2 pr-2 font-medium">Sync</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(item.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                      selectedId === item.id && 'bg-primary-soft/50',
                    )}
                  >
                    <td className="py-2 pl-1 pr-2">
                      <span className="flex min-w-0 items-center gap-1.5 font-medium">
                        {item.isPinned && <Icon name="pin" className="h-3 w-3 shrink-0 text-primary" />}
                        {item.isFavorite && (
                          <Icon name="star" className="h-3 w-3 shrink-0 text-warning" />
                        )}
                        <span className="truncate">{item.title}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-[10.5px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Icon name="folder" className="h-3 w-3 shrink-0" />
                        <span className="truncate">{promptFolderLabel(item.folder)}</span>
                      </span>
                    </td>
                    <td className="tabular py-2 pr-2 text-[10.5px] text-muted-foreground">
                      {item.variableCount}
                    </td>
                    <td className="py-2 pr-2">
                      <SyncPill state={item.syncState} />
                    </td>
                    <td className="tabular whitespace-nowrap py-2 text-[10px] text-muted-foreground">
                      {formatDate(item.updatedAt, false).slice(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4 px-3 pb-4 pt-3">
            {groupByFolder(items).map((group) => (
              <section key={group.folder || '__unfiled__'}>
                <div className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center gap-1.5 bg-background/90 px-1 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
                  <Icon name="folder" className="h-3 w-3" />
                  <span className="truncate font-medium text-foreground/80">
                    {promptFolderLabel(group.folder)}
                  </span>
                  <span className="tabular rounded bg-muted px-1 text-[10px] leading-4">
                    {group.items.length}
                  </span>
                  <span className="ml-auto hidden truncate font-mono text-[9.5px] text-muted-foreground/85 sm:block">
                    {promptFolderPath(group.folder)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2.5">
                  {group.items.map((item) => {
                    const active = selectedId === item.id
                    const extraTags = item.tags.length - 2
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className={cn(
                          'group flex cursor-pointer flex-col rounded-xl border bg-card p-3.5 text-left transition-all duration-150',
                          'hover:-translate-y-px hover:border-primary/35 hover:shadow-md',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                          active
                            ? 'border-primary/55 bg-primary-soft/25 ring-1 ring-primary/15'
                            : 'border-border',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium leading-5">
                                {item.title}
                              </span>
                              {item.isPinned && (
                                <Icon name="pin" className="h-3 w-3 shrink-0 text-primary" />
                              )}
                              {item.isFavorite && (
                                <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-warning" />
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {item.description || '(No description)'}
                            </p>
                          </div>
                          <span className="tabular mt-0.5 shrink-0 text-[10px] text-muted-foreground">
                            {formatDate(item.updatedAt, false)}
                          </span>
                        </div>

                        <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 transition-colors group-hover:bg-muted/70">
                          <p className="line-clamp-2 font-mono text-[10.5px] leading-4 text-muted-foreground">
                            {promptExcerpt(item)}
                          </p>
                        </div>

                        <div className="mt-2.5 flex flex-nowrap items-center gap-1.5 overflow-hidden">
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            {item.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="primary" className="shrink-0 font-normal">
                                {tag}
                              </Badge>
                            ))}
                            {extraTags > 0 && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                +{extraTags}
                              </span>
                            )}
                            {item.variableCount > 0 && (
                              <Badge variant="info" className="shrink-0 px-1.5 font-normal">
                                {`{{}}×${item.variableCount}`}
                              </Badge>
                            )}
                            <SyncPill state={item.syncState} />
                          </div>
                          <span
                            className="tabular ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground"
                            title={`Used ${item.usageCount} times · ${item.versionCount} revisions`}
                          >
                            Used {item.usageCount} · v{item.currentVersion}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="tabular">
          {total === 0 ? '0 of 0' : `${start}–${end} of ${total}`}
        </span>
        {hasFilter && (
          <button
            type="button"
            onClick={onClearFilters}
            className="cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5"
            aria-label="Previous page"
            disabled={page <= 0}
            onClick={() => onPageChange(page - 1)}
          >
            <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          </Button>
          <span className="tabular">
            {page + 1} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5"
            aria-label="Next page"
            disabled={page + 1 >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="ml-1 h-7" onClick={onCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </div>
    </div>
  )
}
