import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  PromptDetail as PromptDetailDto,
  PromptFolderQuery,
  PromptQuery,
} from '../../../shared/contracts'
import type { WorkspaceProps } from '../../app/navigation'
import { Select } from '../../components/ui/primitives'
import { ConfirmDialog } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { useToast } from '../../components/ui/toast'
import { FolderTree } from '../../components/shared/FolderTree'
import { VariableFormModal } from '../../components/shared/VariableForm'
import { VersionHistoryModal } from '../../components/shared/VersionHistoryModal'
import { PromptList } from './PromptList'
import { PromptDetail } from './PromptDetail'
import { PromptEditModal } from './PromptEditModal'
import { PromptSyncModal } from './PromptSyncModal'
import { AiTestDrawer } from './AiTestDrawer'
import {
  combineSearch,
  duplicatePromptTitle,
  folderOptionsFromTree,
  promptRepositoryPath,
  type PromptSort,
  type PromptViewMode,
} from '../../lib/viewModels/prompt'
import { serializePromptFile } from '../../../shared/domain/promptFile'

const PAGE_SIZE = 50

// App-level create signals survive navigation, so track which one this workspace
// already consumed. A fresh signal after mount still opens the create dialog.
let consumedCreateSignal = 0

export function PromptsWorkspace({ query, createSignal, openAsset, onAssetOpened }: WorkspaceProps) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [view, setView] = useState<PromptViewMode>('cards')
  const [sort, setSort] = useState<PromptSort>('updated')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)

  const [editing, setEditing] = useState<{ open: boolean; prompt: PromptDetailDto | null }>({
    open: false,
    prompt: null,
  })
  const [versionsPrompt, setVersionsPrompt] = useState<PromptDetailDto | null>(null)
  const [syncPrompt, setSyncPrompt] = useState<PromptDetailDto | null>(null)
  const [copyPrompt, setCopyPrompt] = useState<PromptDetailDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PromptDetailDto | null>(null)
  const [testPrompt, setTestPrompt] = useState<PromptDetailDto | null>(null)

  const recentlyDeleted = useRef<Set<string>>(new Set())

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(localSearch), 250)
    return () => clearTimeout(timer)
  }, [localSearch])

  const combinedSearch = combineSearch(query, debouncedSearch)
  const queryFilters: PromptQuery = {
    search: combinedSearch || undefined,
    tags: tagFilter.length > 0 ? tagFilter : undefined,
    favorite: favoriteOnly ? true : undefined,
    sort,
    order: sort === 'title' ? 'asc' : 'desc',
  }

  const listQuery = useQuery({
    queryKey: queryKeys.prompts.list({
      ...queryFilters,
      folder: selectedFolder || undefined,
      includeDescendants: true,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    queryFn: () =>
      ipc.prompts.list({
        ...queryFilters,
        folder: selectedFolder || undefined,
        includeDescendants: true,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const folderFilters: PromptFolderQuery = {
    search: combinedSearch || undefined,
    tags: tagFilter.length > 0 ? tagFilter : undefined,
    favorite: favoriteOnly ? true : undefined,
  }
  const foldersQuery = useQuery({
    queryKey: queryKeys.prompts.folders(folderFilters),
    queryFn: () => ipc.prompts.folders(folderFilters),
    placeholderData: keepPreviousData,
  })

  // The folder tree needs an unfiltered-by-folder total, and tag suggestions need
  // a wider slice than the current page. One capped query serves both.
  const scopeQuery = useQuery({
    queryKey: queryKeys.prompts.list({ ...queryFilters, scope: 'all', limit: 500, offset: 0 }),
    queryFn: () => ipc.prompts.list({ ...queryFilters, limit: 500, offset: 0 }),
    placeholderData: keepPreviousData,
  })

  const detailQuery = useQuery({
    queryKey: queryKeys.prompts.detail(selectedId ?? ''),
    queryFn: () => ipc.prompts.get(selectedId as string),
    enabled: !!selectedId,
  })

  const versionsQuery = useQuery({
    queryKey: queryKeys.prompts.versions(versionsPrompt?.id ?? ''),
    queryFn: () => ipc.prompts.versions(versionsPrompt?.id as string),
    enabled: !!versionsPrompt,
  })

  const totalCount = scopeQuery.data?.total ?? listQuery.data?.total ?? 0
  const items = listQuery.data?.items ?? []
  const folderOptions = useMemo(
    () => folderOptionsFromTree(foldersQuery.data ?? []),
    [foldersQuery.data],
  )
  const tagOptions = useMemo(() => {
    const options = new Set<string>()
    for (const item of scopeQuery.data?.items ?? []) {
      for (const tag of item.tags) options.add(tag)
    }
    for (const tag of tagFilter) options.add(tag)
    return [...options].sort((a, b) => a.localeCompare(b, 'en'))
  }, [scopeQuery.data, tagFilter])

  useEffect(() => {
    setPage(0)
  }, [query, debouncedSearch, selectedFolder, favoriteOnly, tagFilter.join('\u0000'), sort])

  useEffect(() => {
    const total = listQuery.data?.total
    if (total === undefined) return
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [listQuery.data?.total, page])

  useEffect(() => {
    if (selectedId !== null) return
    const available = items.filter((item) => !recentlyDeleted.current.has(item.id))
    if (available.length > 0) setSelectedId(available[0].id)
  }, [items, selectedId])

  useEffect(() => {
    if (createSignal.page !== 'prompts') return
    if (createSignal.n <= consumedCreateSignal) return
    consumedCreateSignal = createSignal.n
    setEditing({ open: true, prompt: null })
  }, [createSignal])

  useEffect(() => {
    if (!openAsset || openAsset.kind !== 'prompt') return
    setSelectedFolder('')
    setTagFilter([])
    setFavoriteOnly(false)
    setLocalSearch('')
    setDebouncedSearch('')
    setSort('updated')
    setPage(0)
    setSelectedId(openAsset.id)
    setMobileDetail(true)
    onAssetOpened()
  }, [openAsset, onAssetOpened])

  const invalidatePrompts = () => {
    void queryClient.invalidateQueries({ queryKey: ['prompts'] })
  }

  const favoriteMutation = useMutation({
    mutationFn: (prompt: PromptDetailDto) =>
      ipc.prompts.setFavorite({ id: prompt.id, favorite: !prompt.isFavorite }),
    onSuccess: () => invalidatePrompts(),
    onError: (error) => toast.error(`Favorite not saved: ${errorMessage(error)}`),
  })

  const pinMutation = useMutation({
    mutationFn: (prompt: PromptDetailDto) =>
      ipc.prompts.setPinned({ id: prompt.id, pinned: !prompt.isPinned }),
    onSuccess: () => invalidatePrompts(),
    onError: (error) => toast.error(`Pin not saved: ${errorMessage(error)}`),
  })

  const copyMutation = useMutation({
    mutationFn: (id: string) => ipc.prompts.copyRender({ id, values: {}, writeClipboard: true }),
    onSuccess: (result) => {
      invalidatePrompts()
      if (result.wroteClipboard) {
        toast.success(`Copied to clipboard. Usage count is now ${result.usageCount}.`)
      } else {
        toast.warning('The Prompt was rendered, but the clipboard write was blocked.')
      }
      if (result.unresolvedVariables.length > 0) {
        toast.warning(`Unresolved variables: ${result.unresolvedVariables.join(', ')}`)
      }
    },
    onError: (error) => toast.error(`Copy failed: ${errorMessage(error)}`),
  })

  const duplicateMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const source = await ipc.prompts.get(sourceId)
      return ipc.prompts.create({
        title: duplicatePromptTitle(source.title),
        description: source.description,
        folder: source.folder,
        tags: source.tags,
        systemPrompt: source.systemPrompt,
        userPrompt: source.userPrompt,
        variables: source.variables,
        syncPolicy: source.syncPolicy,
      })
    },
    onSuccess: (created) => {
      invalidatePrompts()
      setSelectedId(created.id)
      setMobileDetail(true)
      toast.success(`Duplicated as "${created.title}". The original Prompt is unchanged.`)
    },
    onError: (error) => toast.error(`Duplicate failed: ${errorMessage(error)}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (target: PromptDetailDto) => ipc.prompts.delete({ id: target.id, confirm: true }),
    onSuccess: (result, target) => {
      recentlyDeleted.current.add(target.id)
      invalidatePrompts()
      const remaining = items.filter((item) => item.id !== target.id)
      const removedIndex = items.findIndex((item) => item.id === target.id)
      const next =
        remaining[removedIndex] ?? remaining[Math.max(0, remaining.length - 1)] ?? null
      setSelectedId(next?.id ?? null)
      setMobileDetail(false)
      setDeleteTarget(null)
      if (result.withdrawnChangeIds.length > 0) {
        toast.warning(
          `Deleted "${target.title}" and withdrew ${result.withdrawnChangeIds.length} pending change(s). The repository file was not modified.`,
        )
      } else {
        toast.success(`Deleted "${target.title}". The repository file was not modified.`)
      }
    },
    onError: (error) => toast.error(`Delete failed: ${errorMessage(error)}`),
  })

  const restoreMutation = useMutation({
    mutationFn: (input: { id: string; revisionId: string; expectedRevisionId: string }) =>
      ipc.prompts.restoreVersion(input),
    onSuccess: (restored) => {
      invalidatePrompts()
      setVersionsPrompt(null)
      setSelectedId(restored.id)
      toast.success(
        `Restored the selected revision as v${restored.currentVersion}. Existing history was not rewritten.`,
      )
    },
    onError: (error) => toast.error(`Restore failed: ${errorMessage(error)}`),
  })

  const clearFilters = () => {
    setTagFilter([])
    setFavoriteOnly(false)
    setSelectedFolder('')
    setLocalSearch('')
  }

  const hasFilter =
    !!query.trim() ||
    !!localSearch.trim() ||
    favoriteOnly ||
    !!selectedFolder ||
    tagFilter.length > 0

  const detail = detailQuery.data ?? null
  const currentVersionFiles = useMemo(
    () =>
      versionsPrompt
        ? [
            {
              path: promptRepositoryPath(versionsPrompt),
              content: serializePromptFile(versionsPrompt),
            },
          ]
        : undefined,
    [versionsPrompt],
  )

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[196px] shrink-0 border-r border-border bg-card/40 xl:flex">
        <FolderTree
          nodes={foldersQuery.data ?? []}
          selected={selectedFolder}
          onSelect={(folder) => {
            setSelectedFolder(folder)
            setPage(0)
          }}
          totalCount={totalCount}
          title="Prompt folders"
        />
      </aside>

      <section
        className={cn(
          'flex min-h-0 w-full flex-col border-r border-border bg-background/40 md:w-[380px] md:shrink-0',
          mobileDetail && 'hidden md:flex',
        )}
      >
        {selectedFolder && (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/25 px-4 py-1.5 text-[11px] text-muted-foreground">
            <Icon name="folder" className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono text-foreground" title={selectedFolder}>
              {selectedFolder}
            </span>
            <button
              type="button"
              onClick={() => setSelectedFolder('')}
              className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              Back to all
            </button>
          </div>
        )}

        <div className="shrink-0 border-b border-border px-3 py-2 xl:hidden">
          <Select
            aria-label="Folder filter"
            className="h-8 text-xs"
            value={selectedFolder}
            onChange={(event) => {
              setSelectedFolder(event.target.value)
              setPage(0)
            }}
          >
            <option value="">All assets ({totalCount})</option>
            {folderOptions.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-h-0 flex-1">
          <PromptList
            items={items}
            total={listQuery.data?.total ?? 0}
            view={view}
            onViewChange={setView}
            sort={sort}
            onSortChange={setSort}
            search={localSearch}
            onSearchChange={setLocalSearch}
            tags={tagOptions}
            selectedTags={tagFilter}
            onToggleTag={(tag) =>
              setTagFilter((current) =>
                current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
              )
            }
            favoriteOnly={favoriteOnly}
            onFavoriteOnlyChange={setFavoriteOnly}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setMobileDetail(true)
            }}
            hasFilter={hasFilter}
            onClearFilters={clearFilters}
            onCreate={() => setEditing({ open: true, prompt: null })}
            isLoading={listQuery.isLoading}
            error={listQuery.isError ? errorMessage(listQuery.error) : null}
            onRetry={() => void listQuery.refetch()}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => setPage(Math.max(0, next))}
          />
        </div>
      </section>

      <section
        className={cn(
          'min-w-0 flex-1',
          mobileDetail
            ? 'fixed inset-0 z-30 flex overflow-hidden bg-background md:static md:z-auto'
            : 'hidden md:flex',
        )}
      >
        <PromptDetail
          prompt={detail}
          isLoading={detailQuery.isLoading}
          error={detailQuery.isError ? errorMessage(detailQuery.error) : null}
          onRetry={() => void detailQuery.refetch()}
          onBack={() => setMobileDetail(false)}
          onEdit={() => {
            if (detail) setEditing({ open: true, prompt: detail })
          }}
          onDuplicate={() => {
            if (detail) duplicateMutation.mutate(detail.id)
          }}
          onCopy={() => {
            if (!detail) return
            if (detail.variables.length > 0) setCopyPrompt(detail)
            else copyMutation.mutate(detail.id)
          }}
          onTest={() => {
            if (detail) setTestPrompt(detail)
          }}
          onShowVersions={() => {
            if (detail) setVersionsPrompt(detail)
          }}
          onSyncPolicy={() => {
            if (detail) setSyncPrompt(detail)
          }}
          onDelete={() => {
            if (detail) setDeleteTarget(detail)
          }}
          onToggleFavorite={() => {
            if (detail) favoriteMutation.mutate(detail)
          }}
          onTogglePinned={() => {
            if (detail) pinMutation.mutate(detail)
          }}
          favoritePending={favoriteMutation.isPending}
          pinnedPending={pinMutation.isPending}
          copying={copyMutation.isPending}
          duplicating={duplicateMutation.isPending}
        />
      </section>

      <PromptEditModal
        open={editing.open}
        prompt={editing.prompt}
        onClose={() => setEditing({ open: false, prompt: null })}
        onSaved={(saved) => {
          setSelectedId(saved.id)
          setMobileDetail(true)
        }}
      />

      {copyPrompt && (
        <VariableFormModal
          open
          title={`Copy "${copyPrompt.title}"`}
          variables={copyPrompt.variables}
          promptId={copyPrompt.id}
          onCopied={() => invalidatePrompts()}
          onClose={() => setCopyPrompt(null)}
        />
      )}

      {versionsPrompt && (
        <VersionHistoryModal
          open
          onClose={() => setVersionsPrompt(null)}
          title={`Version history — ${versionsPrompt.title}`}
          versions={versionsQuery.data ?? []}
          currentRevisionId={versionsPrompt.currentRevisionId}
          currentFiles={currentVersionFiles}
          loading={versionsQuery.isLoading}
          restorePending={restoreMutation.isPending}
          onRestore={(revisionId) => {
            const expected =
              detailQuery.data?.id === versionsPrompt.id
                ? detailQuery.data.currentRevisionId
                : versionsPrompt.currentRevisionId
            restoreMutation.mutate({
              id: versionsPrompt.id,
              revisionId,
              expectedRevisionId: expected,
            })
          }}
        />
      )}

      {syncPrompt && (
        <PromptSyncModal open prompt={syncPrompt} onClose={() => setSyncPrompt(null)} />
      )}

      {testPrompt && <AiTestDrawer prompt={testPrompt} onClose={() => setTestPrompt(null)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget)
        }}
        title="Delete this Prompt?"
        confirmText="Delete Prompt"
        message={
          <>
            Deletes <b className="text-foreground">{deleteTarget?.title}</b> from the local library
            and withdraws its unprocessed sync changes. Version history remains subject to the local
            retention policy.{' '}
            <span className="mt-2 block rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs leading-5 text-foreground">
              The remote repository file (if any) is untouched. If it still exists on the remote, it
              will reappear on the next pull.
            </span>
          </>
        }
      />
    </div>
  )
}
