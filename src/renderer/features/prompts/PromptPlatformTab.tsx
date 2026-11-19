import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDetail, PromptStoreItem } from '../../../shared/contracts'
import { Badge, Button, EmptyState, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { copyToClipboard } from '../../lib/clipboard'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { useToast } from '../../components/ui/toast'
import { Markdown } from '../../components/shared/Markdown'
import { VariableFormModal } from '../../components/shared/VariableForm'
import { combineSearch } from '../../lib/viewModels/prompt'
import { renderTemplate } from '../../../shared/domain/variables'
import { safePathSegment } from '../../../shared/domain/folders'

const PAGE_SIZE = 24

type SaveOutcome =
  | { status: 'duplicate'; title: string }
  | { status: 'created'; prompt: PromptDetail }

export function PromptPlatformTab({
  query,
  onSaved,
}: {
  query: string
  onSaved?: (prompt: PromptDetail) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [category, setCategory] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detailOf, setDetailOf] = useState<PromptStoreItem | null>(null)
  const [copyOf, setCopyOf] = useState<PromptStoreItem | null>(null)
  const [duplicateTitle, setDuplicateTitle] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(localSearch), 250)
    return () => clearTimeout(timer)
  }, [localSearch])

  useEffect(() => {
    setPage(0)
  }, [query, debouncedSearch, category])

  const combinedSearch = combineSearch(query, debouncedSearch)

  const facetsQuery = useQuery({
    queryKey: queryKeys.prompts.list({ source: 'store', facet: true }),
    queryFn: () => ipc.prompts.storeList({ limit: 200, offset: 0 }),
    staleTime: 60_000,
  })

  const storeQuery = useQuery({
    queryKey: queryKeys.prompts.list({
      source: 'store',
      search: combinedSearch || undefined,
      category: category || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    queryFn: () =>
      ipc.prompts.storeList({
        search: combinedSearch || undefined,
        category: category || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const libraryQuery = useQuery({
    queryKey: queryKeys.prompts.list({ source: 'library-titles', limit: 500 }),
    queryFn: () => ipc.prompts.list({ limit: 500, offset: 0, sort: 'title', order: 'asc' }),
    staleTime: 30_000,
  })

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of facetsQuery.data?.items ?? []) set.add(item.category)
    return [...set].sort((a, b) => a.localeCompare(b, 'en'))
  }, [facetsQuery.data])

  const savedTitles = useMemo(() => {
    const set = new Set<string>()
    for (const item of libraryQuery.data?.items ?? []) set.add(item.title.trim().toLowerCase())
    return set
  }, [libraryQuery.data])

  const saveMutation = useMutation({
    mutationFn: async (item: PromptStoreItem): Promise<SaveOutcome> => {
      const existing = await ipc.prompts.list({ search: item.title, limit: 50 })
      const duplicate = existing.items.some(
        (prompt) => prompt.title.trim().toLowerCase() === item.title.trim().toLowerCase(),
      )
      if (duplicate) return { status: 'duplicate', title: item.title }
      const created = await ipc.prompts.create({
        title: item.title,
        description: item.description,
        folder: `platform/${safePathSegment(item.category, 'general')}`,
        tags: item.tags,
        systemPrompt: item.systemPrompt,
        userPrompt: item.userPrompt,
        variables: item.variables,
        syncPolicy: 'inherit',
      })
      return { status: 'created', prompt: created }
    },
    onSuccess: (outcome) => {
      if (outcome.status === 'duplicate') {
        setDuplicateTitle(outcome.title)
        toast.warning(
          `A Prompt titled "${outcome.title}" already exists in your library. Rename the existing Prompt or copy this one instead.`,
        )
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['prompts'] })
      setDetailOf(null)
      setDuplicateTitle(null)
      toast.success(
        `Saved "${outcome.prompt.title}" to the local library. Its sync policy follows the repository by default.`,
      )
      onSaved?.(outcome.prompt)
    },
    onError: (error) => toast.error(`Could not save this Prompt: ${errorMessage(error)}`),
  })

  const openDetail = (item: PromptStoreItem) => {
    setDetailOf(item)
    setDuplicateTitle(savedTitles.has(item.title.trim().toLowerCase()) ? item.title : null)
  }

  const doLocalCopy = async (item: PromptStoreItem, values?: Record<string, string>) => {
    const system = values ? renderTemplate(item.systemPrompt, values) : { text: item.systemPrompt, unresolved: [] as string[] }
    const user = values ? renderTemplate(item.userPrompt, values) : { text: item.userPrompt, unresolved: [] as string[] }
    const text = [system.text, user.text].filter(Boolean).join('\n\n').trim()
    const ok = await copyToClipboard(text)
    if (ok) toast.success(`Copied "${item.title}" to clipboard.`)
    else toast.error('Copy failed; check clipboard permissions.')
    return {
      unresolvedVariables: [...new Set([...system.unresolved, ...user.unresolved])],
    }
  }

  const total = storeQuery.data?.total ?? 0
  const items = storeQuery.data?.items ?? []
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1
  const end = Math.min(total, page * PAGE_SIZE + items.length)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Curated demo catalog.</b> These sample Prompts are bundled with this application, not
            fetched from a live service. Previewing and copying are free; saving copies the content
            into your local library. The saved Prompt follows repository sync policy unless you change
            it later.
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategory('')}
            aria-pressed={!category}
            className={cn(
              'cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors',
              !category
                ? 'border-primary/40 bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted',
            )}
          >
            All categories
          </button>
          {categories.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setCategory(entry)}
              aria-pressed={category === entry}
              className={cn(
                'cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors',
                category === entry
                  ? 'border-primary/40 bg-primary-soft font-medium text-primary'
                  : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted',
              )}
            >
              {entry}
            </button>
          ))}
          <div className="ml-auto flex min-w-[180px] items-center gap-2">
            <div className="relative flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search curated Prompts"
                className="h-8 pl-8 text-xs"
                value={localSearch}
                onChange={(event) => setLocalSearch(event.target.value)}
                placeholder="Search the catalog…"
              />
            </div>
            <span className="tabular whitespace-nowrap text-[11px] text-muted-foreground">
              {total} item{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {storeQuery.isError ? (
          <EmptyState
            icon="alert"
            title="The curated catalog could not be loaded"
            description={errorMessage(storeQuery.error)}
            action={
              <Button variant="outline" size="sm" onClick={() => void storeQuery.refetch()}>
                <Icon name="refresh" />
                Retry
              </Button>
            }
          />
        ) : storeQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-border bg-card p-4">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted/80" />
                <div className="mt-4 h-10 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="search"
            title="No curated Prompts match"
            description="Try a different keyword or category. Catalog search matches titles, descriptions, and tags."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCategory('')
                  setLocalSearch('')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const saved = savedTitles.has(item.title.trim().toLowerCase())
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openDetail(item)}
                  className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft text-primary">
                      <Icon name="message" className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium leading-5">{item.title}</div>
                      <div className="truncate text-[10.5px] text-muted-foreground">
                        {item.author} · {item.category}
                      </div>
                    </div>
                    {saved && (
                      <Badge variant="success" className="shrink-0">
                        In library
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">
                    {item.description}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                    {item.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="primary">
                        {tag}
                      </Badge>
                    ))}
                    {item.variables.length > 0 && (
                      <Badge variant="info">{`{{}} × ${item.variables.length}`}</Badge>
                    )}
                    <span className="tabular ml-auto text-[10.5px] text-muted-foreground">
                      {item.uses.toLocaleString('en-US')} uses
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="tabular">
          {total === 0 ? '0 of 0' : `${start}–${end} of ${total}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5"
            aria-label="Previous page"
            disabled={page <= 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
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
            onClick={() => setPage((current) => current + 1)}
          >
            <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {detailOf && (
        <Modal
          open
          onClose={() => {
            setDetailOf(null)
            setDuplicateTitle(null)
          }}
          width="max-w-3xl"
          title={detailOf.title}
          subtitle={`${detailOf.author} · ${detailOf.category} · Updated ${formatDate(detailOf.updatedAt, false)} · ${detailOf.uses.toLocaleString('en-US')} uses`}
          footer={
            <>
              <span className="mr-auto text-[11px] text-muted-foreground">
                Curated demo content; saving is optional
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setDetailOf(null)
                  setDuplicateTitle(null)
                }}
              >
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (detailOf.variables.length > 0) {
                    setCopyOf(detailOf)
                    setDetailOf(null)
                    setDuplicateTitle(null)
                  } else {
                    void doLocalCopy(detailOf)
                  }
                }}
              >
                <Icon name="copy" />
                Copy to use
              </Button>
              <Button
                disabled={saveMutation.isPending}
                onClick={() => {
                  setDuplicateTitle(null)
                  saveMutation.mutate(detailOf)
                }}
              >
                {saveMutation.isPending ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Icon name="download" />
                )}
                Save to library
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {duplicateTitle && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  A Prompt titled "{duplicateTitle}" already exists in your library. Rename the
                  existing Prompt in the library first, or use copy without saving a duplicate.
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {detailOf.tags.map((tag) => (
                <Badge key={tag} variant="primary">
                  {tag}
                </Badge>
              ))}
              {detailOf.variables.map((variable) => (
                <Badge
                  key={variable.name}
                  variant="info"
                  title={variable.required ? 'Required' : 'Optional'}
                >
                  {`{{${variable.name}}}`}
                  {variable.required && <span className="text-danger">*</span>}
                </Badge>
              ))}
            </div>
            {detailOf.systemPrompt && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  System Prompt
                  <span className="h-px flex-1 bg-border/70" />
                </h3>
                <Markdown
                  text={detailOf.systemPrompt}
                  className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
                />
              </section>
            )}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                User Prompt
                <span className="h-px flex-1 bg-border/70" />
              </h3>
              <Markdown
                text={detailOf.userPrompt}
                className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
              />
            </section>
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              Saving creates a local Prompt in `{detailOf.category}` under platform/. It is never
              written to an Agent directory. The eventual repository path is{' '}
              <code className="font-mono">{`prompts/platform/${safePathSegment(detailOf.category, 'general')}/…`}</code>{' '}
              after sync is enabled.
            </p>
          </div>
        </Modal>
      )}

      {copyOf && (
        <VariableFormModal
          open
          title={`Copy "${copyOf.title}"`}
          variables={copyOf.variables}
          onClose={() => setCopyOf(null)}
          onSubmit={(values) => doLocalCopy(copyOf, values)}
        />
      )}
    </div>
  )
}
