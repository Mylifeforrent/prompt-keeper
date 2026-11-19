import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SkillStoreItem } from '../../../shared/contracts'
import { safePathSegment } from '../../../shared/domain/folders'
import { Badge, Button, Checkbox, EmptyState, Select, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { useToast } from '../../components/ui/toast'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn } from '../../lib/cn'
import { formatBytes } from '../../lib/format'
import {
  SKILL_ENTRY_FILE,
  SCRIPT_ACK_NOTICE,
  isScriptFile,
  skillSourceMeta,
} from '../../lib/viewModels/skill'

const SOURCE_FILTERS = [
  { value: 'all', label: 'All sources' },
  { value: 'official', label: 'Official' },
  { value: 'community', label: 'Community' },
] as const

type StoreSourceFilter = (typeof SOURCE_FILTERS)[number]['value']

export function SkillStoreTab({ query, onAdded }: { query: string; onAdded: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [source, setSource] = useState<StoreSourceFilter>('all')
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState<SkillStoreItem | null>(null)

  const store = useQuery({
    queryKey: ['skills', 'store', { query: query.trim(), category }],
    queryFn: () =>
      ipc.skills.storeList({
        search: query.trim() || undefined,
        category: category || undefined,
        limit: 100,
      }),
  })

  const library = useQuery({
    queryKey: queryKeys.skills.list({ scope: 'store-check', limit: 200 }),
    queryFn: () => ipc.skills.list({ limit: 200 }),
  })

  const categories = useMemo(() => {
    const values = new Set<string>()
    for (const item of store.data?.items ?? []) {
      if (item.category) values.add(item.category)
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'en'))
  }, [store.data])

  const installedTitles = useMemo(
    () => new Set((library.data?.items ?? []).map((item) => item.title)),
    [library.data],
  )

  const items = (store.data?.items ?? []).filter(
    (item) => source === 'all' || item.source === source,
  )

  const addToLibrary = useMutation({
    mutationFn: async (item: SkillStoreItem) => {
      const entry = `# ${item.name}

${item.description}

## Catalog notes

This Skill was added from curated catalog entry \`${item.id}\` (v${item.version} by ${item.author}).
The curated catalog ships metadata and file names only, so this \`SKILL.md\` was generated from the
entry description. Review and complete the instructions before installing it to an Agent.
`
      return ipc.skills.create({
        title: item.name,
        description: item.description,
        folder: item.category ? safePathSegment(item.category, 'store') : 'store',
        icon: item.icon,
        author: item.author,
        versionLabel: item.version,
        category: item.category,
        tags: ['store', ...(item.category ? [item.category] : [])],
        files: [{ path: SKILL_ENTRY_FILE, content: entry }],
      })
    },
    onSuccess: (created) => {
      toast.success(`Added "${created.title}" to the library. Review SKILL.md before installing it.`)
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      setDetail(null)
      onAdded()
    },
    onError: (error) => {
      if (isIpcError(error) && error.code === 'CONFLICT') {
        toast.error('A Skill with this name already exists. Rename or delete the existing entry first.')
        return
      }
      toast.error(`Could not add the Skill: ${errorMessage(error)}`)
    },
  })

  if (store.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Loading the curated Skill catalog…
      </div>
    )
  }

  if (store.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Icon name="alert" className="h-6 w-6 text-danger" />
        <p className="text-sm font-medium">The curated catalog could not be loaded</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          {errorMessage(store.error)}
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void store.refetch()}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {SOURCE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setSource(filter.value)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                source === filter.value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <Select
          aria-label="Filter by category"
          className="w-[180px]"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Badge variant="info" className="font-normal">
          Curated demo catalog
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Bundled with the app · no network request · installs go through review
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching catalog entries"
          description={
            query.trim() || category || source !== 'all'
              ? 'Try another keyword, source, or category.'
              : 'The curated catalog is empty in this build.'
          }
          action={
            query.trim() || category || source !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSource('all')
                  setCategory('')
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const sourceMeta = skillSourceMeta(item.source)
            const installed = installedTitles.has(item.name)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDetail(item)}
                className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/70 text-lg">
                    {item.icon || item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-5">{item.name}</div>
                    <div className="tabular flex items-center gap-1 text-[10.5px] text-muted-foreground">
                      <span className="truncate">{item.author}</span>
                      <span>·</span>
                      <span>v{item.version}</span>
                      <span>·</span>
                      <Icon name="download" className="h-3 w-3" />
                      {item.downloads.toLocaleString('en-US')}
                    </div>
                  </div>
                  <Badge variant={sourceMeta.variant} className="shrink-0 font-normal">
                    {sourceMeta.label}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">
                  {item.description}
                </p>
                <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2.5">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item.category || 'Uncategorized'}
                  </span>
                  <Badge variant="outline" className="font-normal">
                    {item.files.length} files
                  </Badge>
                  {installed ? (
                    <Badge variant="success" className="ml-auto font-normal">
                      <Icon name="check" className="h-3 w-3" />
                      In library
                    </Badge>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      Review
                      <Icon name="arrowRight" className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {detail && (
        <SkillStoreDetail
          item={detail}
          installed={installedTitles.has(detail.name)}
          pending={addToLibrary.isPending}
          onClose={() => setDetail(null)}
          onAdd={() => addToLibrary.mutate(detail)}
        />
      )}
    </div>
  )
}

function SkillStoreDetail({
  item,
  installed,
  pending,
  onClose,
  onAdd,
}: {
  item: SkillStoreItem
  installed: boolean
  pending: boolean
  onClose: () => void
  onAdd: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const extraFiles = item.files.filter((file) => file.path !== SKILL_ENTRY_FILE)
  const scripts = item.files.some(isScriptFile)
  const sourceMeta = skillSourceMeta(item.source)

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">{item.icon || item.name.slice(0, 1).toUpperCase()}</span>
          {item.name}
          <Badge variant={sourceMeta.variant}>{sourceMeta.label}</Badge>
        </span>
      }
      subtitle={`v${item.version} · ${item.author} · ${item.category || 'Uncategorized'} · ${item.downloads.toLocaleString('en-US')} downloads`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={installed || pending || !acknowledged} onClick={onAdd}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
            {installed ? 'Already in library' : 'Add to library'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2.5 text-[11px] leading-5 text-info">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Curated demo catalog. Entries ship with the app and no registry is contacted. Adding an entry
            creates a local Skill; installing to Agents is a separate reviewed step.
          </span>
        </div>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Description</h3>
          <p className="text-sm leading-6 text-foreground/90">{item.description}</p>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
            File list ({item.files.length})
          </h3>
          {item.files.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              The catalog entry does not enumerate any files.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              {item.files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0"
                >
                  <Icon name="file" className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                  {file.isExecutable && <Badge variant="warning">exec</Badge>}
                  {isScriptFile(file) && <Badge variant="outline">script</Badge>}
                  <span className="tabular text-[10px] text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11px] leading-5 text-warning">
          <p className="flex items-start gap-1.5">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The catalog provides file names only, not file contents.
              {extraFiles.length > 0
                ? ` ${extraFiles.length} supporting file${extraFiles.length === 1 ? '' : 's'} cannot be created from this entry.`
                : ''}{' '}
              Adding creates <code className="font-mono">SKILL.md</code> from the description; complete it
              before installing.
            </span>
          </p>
          {scripts && <p className="mt-1.5 pl-5">{SCRIPT_ACK_NOTICE}</p>}
        </div>

        <Checkbox
          checked={acknowledged}
          onChange={setAcknowledged}
          disabled={installed}
          label={
            <span className="text-xs leading-5">
              I reviewed this entry and understand that only <code className="font-mono">SKILL.md</code> is
              generated from the catalog description.
            </span>
          }
        />
      </div>
    </Modal>
  )
}
