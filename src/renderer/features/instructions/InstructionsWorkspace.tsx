import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ContractActivationMode,
  ContractDetail,
  ContractQuery,
  ContractScope,
} from '../../../shared/contracts'
import { Badge, Button, EmptyState, Select } from '../../components/ui/primitives'
import { ConfirmDialog, Modal } from '../../components/ui/modal'
import { Tabs } from '../../components/ui/tabs'
import { Icon } from '../../lib/icons'
import { useToast } from '../../components/ui/toast'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  contractRepositoryPath,
  folderLabel,
} from '../../lib/viewModels/contract'
import { flattenFolderTree } from '../../../shared/domain/folders'
import { ContractList } from './ContractList'
import { ContractDetail as ContractDetailView } from './ContractDetail'
import { ContractEditModal } from './ContractEditModal'
import { ContractSyncModal } from './ContractSyncModal'
import { ContractResolutionPreview } from './ContractResolutionPreview'
import { ContractProjections } from './ContractProjections'
import { GlobalDispatch } from './GlobalDispatch'
import { FolderTree } from '../../components/shared/FolderTree'
import { VersionHistoryModal } from '../../components/shared/VersionHistoryModal'
import type { WorkspaceProps } from '../../app/navigation'

type InstructionTab = 'library' | 'projections' | 'global'

const LIST_LIMIT = 200

export function InstructionsWorkspace({
  query,
  createSignal,
  openAsset,
  onAssetOpened,
}: WorkspaceProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<InstructionTab>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | ContractScope>('all')
  const [activationFilter, setActivationFilter] = useState<'all' | ContractActivationMode>('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [sort, setSort] = useState<'updated' | 'priority' | 'title'>('updated')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ContractDetail | null>(null)
  const [versionsForId, setVersionsForId] = useState<string | null>(null)
  const [syncTarget, setSyncTarget] = useState<ContractDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContractDetail | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const lastCreate = useRef(createSignal.n)
  const openedAsset = useRef<string | null>(null)

  const targetsQuery = useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => ipc.targets.list(),
    staleTime: 5 * 60_000,
  })
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => ipc.projects.list(),
    staleTime: 30_000,
  })
  const globalTargetsQuery = useQuery({
    queryKey: queryKeys.projections.globalTargets,
    queryFn: () => ipc.globalTargets.list(),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (createSignal.page !== 'instructions' || createSignal.n <= lastCreate.current) return
    lastCreate.current = createSignal.n
    setTab('library')
    setCreateOpen(true)
  }, [createSignal])

  useEffect(() => {
    if (!openAsset) {
      openedAsset.current = null
      return
    }
    if (openAsset.kind !== 'contract' || openedAsset.current === openAsset.id) return
    openedAsset.current = openAsset.id
    setTab('library')
    setFolder('')
    setScopeFilter('all')
    setActivationFilter('all')
    setTargetFilter('all')
    setSelectedId(openAsset.id)
    onAssetOpened()
  }, [onAssetOpened, openAsset])

  const contractQuery: ContractQuery = useMemo(
    () => ({
      ...(query.trim() ? { search: query.trim() } : {}),
      ...(folder ? { folder, includeDescendants: true } : {}),
      ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
      ...(activationFilter !== 'all' ? { activationMode: activationFilter } : {}),
      ...(targetFilter !== 'all' ? { targetId: targetFilter } : {}),
      sort,
      order: sort === 'title' ? 'asc' : 'desc',
      limit: LIST_LIMIT,
    }),
    [activationFilter, folder, query, scopeFilter, sort, targetFilter],
  )

  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts.list(contractQuery),
    queryFn: () => ipc.contracts.list(contractQuery),
    placeholderData: keepPreviousData,
  })

  const items = contractsQuery.data?.items ?? []
  const effectiveSelectedId = selectedId ?? items[0]?.id ?? null

  const detailQuery = useQuery({
    queryKey: queryKeys.contracts.detail(effectiveSelectedId ?? ''),
    queryFn: async () => {
      if (!effectiveSelectedId) throw new Error('No contract is selected.')
      return ipc.contracts.get(effectiveSelectedId)
    },
    enabled: !!effectiveSelectedId,
  })

  const versionsQuery = useQuery({
    queryKey: queryKeys.contracts.versions(versionsForId ?? ''),
    queryFn: async () => (versionsForId ? ipc.contracts.versions(versionsForId) : []),
    enabled: !!versionsForId,
  })

  const deleteContractId = deleteTarget?.id ?? ''
  const projectDeleteCount = useQuery({
    queryKey: queryKeys.projections.list({ contractId: deleteContractId, limit: 1 }),
    queryFn: () => ipc.projections.list({ contractId: deleteContractId, limit: 1 }),
    enabled: !!deleteContractId,
  })
  const globalDeleteCount = useQuery({
    queryKey: queryKeys.projections.globalList({ contractId: deleteContractId, limit: 1 }),
    queryFn: () => ipc.globalProjections.list({ contractId: deleteContractId, limit: 1 }),
    enabled: !!deleteContractId,
  })

  const invalidateContractViews = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contracts'] })
    void queryClient.invalidateQueries({ queryKey: ['projections'] })
    void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
    void queryClient.invalidateQueries({ queryKey: ['globalTargets'] })
  }, [queryClient])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ipc.contracts.delete({ id, confirm: true }),
    onSuccess: (_, id) => {
      invalidateContractViews()
      if (selectedId === id) setSelectedId(null)
      setDeleteTarget(null)
      toast.success('The contract was deleted from the local library. Target files and repository files are untouched.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const restoreMutation = useMutation({
    mutationFn: async (revisionId: string) => {
      const detail = detailQuery.data
      if (!detail) throw new Error('The current contract is not loaded.')
      const revision = versionsQuery.data?.find((item) => item.id === revisionId)
      return ipc.contracts.restoreVersion({
        id: detail.id,
        revisionId,
        expectedRevisionId: detail.currentRevisionId,
        note: revision ? `Restored version ${revision.version}` : 'Restored a previous version',
      })
    },
    onSuccess: (_, revisionId) => {
      const version = versionsQuery.data?.find((revision) => revision.id === revisionId)?.version
      invalidateContractViews()
      setVersionsForId(null)
      toast.success(
        `Restored ${version ? `v${version}` : 'the previous version'}. A new version was created and affected projections were marked stale; Agent directories were not written.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const foldersForEdit = useMemo(() => {
    const treeFolders = flattenFolderTree(contractsQuery.data?.folders ?? []).map((node) => node.path)
    const current = editTarget?.folder ? [editTarget.folder] : []
    return Array.from(new Set([...treeFolders, ...current])).sort((a, b) => a.localeCompare(b))
  }, [contractsQuery.data?.folders, editTarget?.folder])

  const localFiltersActive =
    !!folder || scopeFilter !== 'all' || activationFilter !== 'all' || targetFilter !== 'all'
  const hasFilter = !!query.trim() || localFiltersActive

  const clearFilters = () => {
    setFolder('')
    setScopeFilter('all')
    setActivationFilter('all')
    setTargetFilter('all')
  }

  const libraryCount = contractsQuery.data?.total ?? 0
  const projectAttention = (projectsQuery.data ?? []).reduce(
    (sum, project) => sum + project.staleCount + project.driftedCount,
    0,
  )
  const globalAttention = (globalTargetsQuery.data ?? []).reduce(
    (sum, target) => sum + target.staleCount + target.driftedCount,
    0,
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'library', label: 'Contract Library', count: libraryCount },
            { value: 'projections', label: 'Project Projections', count: projectAttention },
            { value: 'global', label: 'Global Dispatch', count: globalAttention },
          ]}
          value={tab}
          onChange={(value) => setTab(value as InstructionTab)}
        />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          onClick={() => setPreviewOpen(true)}
        >
          <Icon name="eye" className="h-3.5 w-3.5" />
          Resolution preview
        </Button>
        <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
          <Badge variant="outline">One canonical contract per rule</Badge>
          <span className="whitespace-nowrap">
            Projection writes are explicit; drift is never overwritten automatically.
          </span>
        </span>
      </div>

      {tab === 'library' && (
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[184px] shrink-0 border-r border-border bg-card/40 xl:block">
            <div className="flex h-full min-h-0 flex-col">
              <FolderTree
                nodes={contractsQuery.data?.folders ?? []}
                selected={folder}
                onSelect={(next) => {
                  setFolder(next)
                  setSelectedId(null)
                }}
                totalCount={libraryCount}
                title="Instruction folders"
              />
            </div>
          </div>

          <div className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background/40 xl:w-[400px]">
            {folder && (
              <div className="flex items-center gap-1.5 border-b border-border bg-muted/25 px-4 py-1.5 text-[11px] text-muted-foreground">
                <Icon name="folder" className="h-3 w-3" />
                <span className="truncate text-foreground">{folderLabel(folder)}</span>
                <button
                  type="button"
                  onClick={() => setFolder('')}
                  className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                >
                  All folders
                </button>
              </div>
            )}
            {query.trim() && (
              <div className="flex items-center gap-1.5 border-b border-border bg-muted/25 px-4 py-1.5 text-[11px] text-muted-foreground">
                <Icon name="search" className="h-3 w-3" />
                <span className="truncate">
                  Search: <span className="text-foreground">{query.trim()}</span>
                </span>
                <span className="ml-auto shrink-0">Clear it in the top bar</span>
              </div>
            )}

            <div className="space-y-1.5 border-b border-border px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <Select
                  className="h-8 min-w-0 flex-1 text-xs"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                  aria-label="Sort contracts"
                >
                  <option value="updated">Last updated</option>
                  <option value="priority">Priority</option>
                  <option value="title">Title</option>
                </Select>
                <Select
                  className="h-8 w-[104px] text-xs"
                  value={scopeFilter}
                  onChange={(event) => {
                    setScopeFilter(event.target.value as 'all' | ContractScope)
                    setSelectedId(null)
                  }}
                  aria-label="Filter by scope"
                >
                  <option value="all">All scopes</option>
                  {(Object.keys(CONTRACT_SCOPE_META) as ContractScope[]).map((scope) => (
                    <option key={scope} value={scope}>
                      {CONTRACT_SCOPE_META[scope].short}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  className="h-8 min-w-0 flex-1 text-xs"
                  value={activationFilter}
                  onChange={(event) => {
                    setActivationFilter(event.target.value as 'all' | ContractActivationMode)
                    setSelectedId(null)
                  }}
                  aria-label="Filter by activation"
                >
                  <option value="all">All activations</option>
                  {(Object.keys(ACTIVATION_META) as ContractActivationMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {ACTIVATION_META[mode].short}
                    </option>
                  ))}
                </Select>
                <Select
                  className="h-8 w-[132px] text-xs"
                  value={targetFilter}
                  onChange={(event) => {
                    setTargetFilter(event.target.value)
                    setSelectedId(null)
                  }}
                  aria-label="Filter by target"
                >
                  <option value="all">All targets</option>
                  {(targetsQuery.data ?? []).map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {contractsQuery.isPending ? (
                <div className="space-y-1.5 px-3 py-2.5">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <div key={index} className="h-[88px] animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : contractsQuery.isError ? (
                <div className="m-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
                  <div className="flex items-start gap-2 text-xs leading-5 text-danger">
                    <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {errorMessage(contractsQuery.error)}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7"
                    onClick={() => void contractsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <ContractList
                  contracts={items}
                  selectedId={effectiveSelectedId}
                  onSelect={setSelectedId}
                  hasFilter={hasFilter}
                  onClearFilter={clearFilters}
                  onCreate={() => setCreateOpen(true)}
                />
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
              <span className="tabular">
                {items.length} / {libraryCount} contracts
              </span>
              {localFiltersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
                >
                  Clear filters
                </button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                onClick={() => setCreateOpen(true)}
                title="New contract (shortcut N)"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {!effectiveSelectedId ? (
              <EmptyState
                icon="file"
                title={hasFilter ? 'No matching contract selected' : 'No contract selected'}
                description={
                  hasFilter
                    ? 'Adjust or clear the filters, or create a new contract.'
                    : 'Select a contract in the list, or create the first one to start projecting instructions.'
                }
                action={
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    New contract
                  </Button>
                }
              />
            ) : detailQuery.isPending ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-border bg-card/60 px-5 py-4">
                  <div className="h-5 w-64 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-3 w-96 animate-pulse rounded bg-muted" />
                  <div className="mt-3 flex gap-1.5">
                    {[0, 1, 2, 3].map((index) => (
                      <div key={index} className="h-5 w-20 animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                </div>
                <div className="space-y-3 px-5 py-5">
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {[0, 1, 2, 3].map((index) => (
                      <div key={index} className="h-24 animate-pulse rounded-lg bg-muted/60" />
                    ))}
                  </div>
                  <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
                </div>
              </div>
            ) : detailQuery.isError ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="max-w-md rounded-xl border border-danger/30 bg-danger-soft p-4 text-center">
                  <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
                  <p className="mt-2 text-sm font-medium">The contract could not be loaded</p>
                  <p className="mt-1 text-xs text-danger">{errorMessage(detailQuery.error)}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void detailQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : detailQuery.data ? (
              <ContractDetailView
                contract={detailQuery.data}
                targets={targetsQuery.data ?? []}
                projects={projectsQuery.data ?? []}
                onEdit={() => setEditTarget(detailQuery.data)}
                onDelete={() => setDeleteTarget(detailQuery.data)}
                onShowVersions={() => setVersionsForId(detailQuery.data.id)}
                onSync={() => setSyncTarget(detailQuery.data)}
                onPreview={() => setPreviewOpen(true)}
              />
            ) : null}
          </div>
        </div>
      )}

      {tab === 'projections' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ContractProjections />
        </div>
      )}

      {tab === 'global' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <GlobalDispatch query={query} />
        </div>
      )}

      <ContractEditModal
        open={createOpen || !!editTarget}
        contract={editTarget}
        folders={foldersForEdit}
        onClose={() => {
          setCreateOpen(false)
          setEditTarget(null)
        }}
        onSaved={(saved) => {
          setCreateOpen(false)
          setEditTarget(null)
          setFolder('')
          setScopeFilter('all')
          setActivationFilter('all')
          setTargetFilter('all')
          setSelectedId(saved.id)
        }}
      />

      {syncTarget && (
        <ContractSyncModal
          open
          contract={syncTarget}
          onClose={() => setSyncTarget(null)}
        />
      )}

      {versionsForId && versionsQuery.isError && (
        <Modal
          open
          onClose={() => setVersionsForId(null)}
          title="Version history"
          width="max-w-3xl"
        >
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
            {errorMessage(versionsQuery.error)}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void versionsQuery.refetch()}
          >
            Retry
          </Button>
        </Modal>
      )}

      {versionsForId && !versionsQuery.isError && (
        <VersionHistoryModal
          open
          onClose={() => setVersionsForId(null)}
          title={`Version history — ${detailQuery.data?.title ?? 'Contract'}`}
          versions={versionsQuery.data ?? []}
          currentRevisionId={detailQuery.data?.currentRevisionId}
          currentFiles={
            detailQuery.data
              ? [
                  {
                    path: contractRepositoryPath(
                      detailQuery.data.folder,
                      detailQuery.data.slug,
                    ),
                    content: detailQuery.data.body,
                  },
                ]
              : undefined
          }
          loading={versionsQuery.isPending}
          onRestore={(revisionId) => {
            if (restoreMutation.isPending) return
            restoreMutation.mutate(revisionId)
          }}
          restorePending={restoreMutation.isPending}
        />
      )}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Resolution preview"
        subtitle="Static approximation for a target and sample file path; the target tool remains authoritative."
        width="max-w-6xl"
      >
        <ContractResolutionPreview />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
        title="Delete instruction contract?"
        confirmText="Delete contract"
        message={
          <>
            Deletes <b className="text-foreground">{deleteTarget?.title}</b> and its{' '}
            {deleteTarget?.versionCount ?? 0} revision
            {(deleteTarget?.versionCount ?? 0) === 1 ? '' : 's'} from the local library. Pending repository
            changes are withdrawn; the remote <span className="font-mono text-foreground">.contract.md</span>{' '}
            file is untouched and can reappear on the next pull.
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs leading-5 text-warning">
              Existing projection records remain as orphaned records and cannot regenerate content. Files
              already written into project roots or user-level Agent directories are not deleted; remove each
              one in Project Projections or Global Dispatch.
              {(projectDeleteCount.data?.total ?? 0) > 0 &&
                ` ${projectDeleteCount.data?.total} project projection record${(projectDeleteCount.data?.total ?? 0) === 1 ? '' : 's'}.`}
              {(globalDeleteCount.data?.total ?? 0) > 0 &&
                ` ${globalDeleteCount.data?.total} global projection record${(globalDeleteCount.data?.total ?? 0) === 1 ? '' : 's'}.`}
            </p>
          </>
        }
      />
    </div>
  )
}
