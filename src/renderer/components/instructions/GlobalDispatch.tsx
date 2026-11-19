import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CompiledFile,
  ContractListItem,
  GlobalTargetDetail,
  ProjectionDetail,
  ProjectionStatus,
} from '../../../shared/contracts'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Spinner,
} from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, copyToClipboard } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorDetails, errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  ACTIVATION_META,
  formatBytes,
  globalPathHint,
  targetSupportsActivation,
  validateGlobalPath,
} from '../../lib/contractView'
import {
  OverwriteDriftModal,
  ProjectionTable,
  type ProjectionTargetInfo,
} from './ContractProjections'

export function GlobalDispatch({ query }: { query: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [batchOpen, setBatchOpen] = useState(false)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  const [contractFilter, setContractFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectionStatus>('all')
  const [removeTarget, setRemoveTarget] = useState<ProjectionDetail | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<ProjectionDetail | null>(null)
  const [driftTarget, setDriftTarget] = useState<ProjectionDetail | null>(null)
  const [driftError, setDriftError] = useState<string | null>(null)

  const globalTargetsQuery = useQuery({
    queryKey: queryKeys.projections.globalTargets,
    queryFn: () => ipc.globalTargets.list(),
    staleTime: 60_000,
  })
  const projectionsQuery = useQuery({
    queryKey: queryKeys.projections.globalList({ limit: 200 }),
    queryFn: () => ipc.globalProjections.list({ limit: 200 }),
  })
  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    queryFn: () => ipc.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    staleTime: 30_000,
  })

  const targets = globalTargetsQuery.data ?? []
  const records = projectionsQuery.data?.items ?? []
  const contracts = contractsQuery.data?.items ?? []

  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets])
  const resolveTarget = (targetId: string): ProjectionTargetInfo | undefined => {
    const target = targetById.get(targetId)
    return target
      ? { label: target.label, agentName: target.agentName, merge: target.merge }
      : undefined
  }

  const rows = records.filter((row) => {
    if (contractFilter !== 'all' && row.contractId !== contractFilter) return false
    if (targetFilter !== 'all' && row.targetId !== targetFilter) return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    return true
  })
  const filtersActive = contractFilter !== 'all' || targetFilter !== 'all' || statusFilter !== 'all'
  const attention = records.filter((row) => row.status === 'stale' || row.status === 'drifted').length

  const toggleTargetSelection = (targetId: string) =>
    setSelectedTargetIds((current) =>
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId],
    )

  const invalidateGlobalViews = () => {
    void queryClient.invalidateQueries({ queryKey: ['globalTargets'] })
    void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
  }

  const updatePathMutation = useMutation({
    mutationFn: (input: { target: GlobalTargetDetail; path: string }) =>
      ipc.globalTargets.updatePath({
        targetId: input.target.id,
        path: input.path,
        expectedUpdatedAt: input.target.updatedAt,
      }),
    onSuccess: (result) => {
      invalidateGlobalViews()
      toast.success(
        `Updated the global directory for ${result.target.label}. ${result.markedStale} projection${result.markedStale === 1 ? '' : 's'} marked stale.` +
          (result.driftedNotChanged > 0
            ? ` ${result.driftedNotChanged} drifted item${result.driftedNotChanged === 1 ? '' : 's'} were not changed.`
            : ''),
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const restorePathMutation = useMutation({
    mutationFn: (target: GlobalTargetDetail) =>
      ipc.globalTargets.restoreDefault({ targetId: target.id }),
    onSuccess: (result) => {
      invalidateGlobalViews()
      toast.success(
        `Restored the default path for ${result.target.label}. ${result.markedStale} projection${result.markedStale === 1 ? '' : 's'} marked stale; files were not moved.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const reprojectMutation = useMutation({
    mutationFn: (row: ProjectionDetail) =>
      ipc.globalProjections.reproject({ projectionId: row.id }),
    onSuccess: (updated) => {
      invalidateGlobalViews()
      toast.success(`Reprojected "${updated.contractTitle}" to ${resolveTarget(updated.targetId)?.label ?? updated.targetId}.`)
    },
    onError: (error, row) => {
      const details = errorDetails(error)
      if (details?.kind === 'projection-drift') {
        setDriftError(null)
        setDriftTarget(row)
        toast.warning('The global file drifted. Confirm the overwrite explicitly before re-projecting.')
        return
      }
      toast.error(errorMessage(error))
    },
  })

  const removeMutation = useMutation({
    mutationFn: (row: ProjectionDetail) =>
      ipc.globalProjections.remove({ projectionId: row.id, confirm: true }),
    onSuccess: (result, row) => {
      invalidateGlobalViews()
      toast.success(
        `Removed "${row.contractTitle}" from ${result.targetPath}. The local library, repository, and other global files are unchanged.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const rollbackMutation = useMutation({
    mutationFn: (row: ProjectionDetail) => ipc.globalProjections.rollback({ projectionId: row.id }),
    onSuccess: (updated) => {
      invalidateGlobalViews()
      toast.warning(
        `Rolled back "${updated.contractTitle}" in ${resolveTarget(updated.targetId)?.label ?? updated.targetId}. The local library and repository are unchanged.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const overwriteMutation = useMutation({
    mutationFn: (input: { row: ProjectionDetail; expectedFileHash: string }) =>
      ipc.globalProjections.overwriteDrift({
        projectionId: input.row.id,
        expectedFileHash: input.expectedFileHash,
        confirm: true,
      }),
    onSuccess: (updated) => {
      invalidateGlobalViews()
      setDriftTarget(null)
      setDriftError(null)
      toast.warning(
        `Overwrote manual edits for "${updated.contractTitle}" at ${updated.targetPath}. The previous version remains available for rollback.`,
      )
    },
    onError: (error) => setDriftError(errorMessage(error)),
  })

  const busyProjectionId =
    reprojectMutation.isPending && reprojectMutation.variables
      ? reprojectMutation.variables.id
      : removeMutation.isPending && removeMutation.variables
        ? removeMutation.variables.id
        : rollbackMutation.isPending && rollbackMutation.variables
          ? rollbackMutation.variables.id
          : null

  if (globalTargetsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-danger/30 bg-danger-soft p-4 text-center">
          <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
          <p className="mt-2 text-sm font-medium">The global target registry could not be loaded</p>
          <p className="mt-1 text-xs text-danger">{errorMessage(globalTargetsQuery.error)}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void globalTargetsQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Global dispatch is a one-way write from the local library to user-level Agent directories on
            this machine. It never writes back to Git. Changing a directory path marks non-drifted
            projections stale and does not move files.
          </span>
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Global directories</h3>
            <Badge variant="outline">{targets.length} agents</Badge>
            <span className="text-[11px] text-muted-foreground">
              Paths are local machine paths and are never written to Git.
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {attention} stale or drifted projection{attention === 1 ? '' : 's'}
            </span>
          </div>
          {globalTargetsQuery.isPending ? (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-36 animate-pulse rounded-xl bg-muted/60" />
              ))}
            </div>
          ) : targets.length === 0 ? (
            <EmptyState
              icon="send"
              title="No global targets in the registry"
              description="The backend did not return any user-level Agent targets. Check the target registry before dispatching."
            />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {targets.map((target) => (
                <GlobalTargetCard
                  key={target.id}
                  target={target}
                  selected={selectedTargetIds.includes(target.id)}
                  onToggleSelected={() => toggleTargetSelection(target.id)}
                  pending={
                    (updatePathMutation.isPending &&
                      updatePathMutation.variables?.target.id === target.id) ||
                    (restorePathMutation.isPending &&
                      restorePathMutation.variables?.id === target.id)
                  }
                  onSavePath={(path) => updatePathMutation.mutate({ target, path })}
                  onRestoreDefault={() => restorePathMutation.mutate(target)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold">Batch dispatch</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Select instructions and global directories, compile the exact files, then confirm the write.
              Drifted items are excluded and must be overwritten individually.
            </div>
          </div>
          <Button
            size="sm"
            className="ml-auto"
            disabled={targets.length === 0}
            onClick={() => setBatchOpen(true)}
          >
            <Icon name="send" className="h-3.5 w-3.5" />
            Dispatch instructions
          </Button>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Global projection records</h3>
            <Badge variant="outline">{records.length} records</Badge>
            <span className="text-[11px] text-muted-foreground">
              Removal only affects the local file; the contract library and Git repository are unchanged.
            </span>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Select
              className="h-8 w-52 text-xs"
              value={contractFilter}
              onChange={(event) => setContractFilter(event.target.value)}
              aria-label="Filter global projections by contract"
            >
              <option value="all">All contracts</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.title}
                </option>
              ))}
            </Select>
            <Select
              className="h-8 w-48 text-xs"
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value)}
              aria-label="Filter global projections by target"
            >
              <option value="all">All directories</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </Select>
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { value: 'all', label: 'All' },
                  { value: 'synced', label: 'Synced' },
                  { value: 'stale', label: 'Stale' },
                  { value: 'drifted', label: 'Drifted' },
                  { value: 'missing', label: 'Missing' },
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setStatusFilter(item.value)}
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium',
                    statusFilter === item.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setContractFilter('all')
                  setTargetFilter('all')
                  setStatusFilter('all')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {projectionsQuery.isError ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-danger">
                <Icon name="alert" className="h-4 w-4" />
                {errorMessage(projectionsQuery.error)}
              </div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void projectionsQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : projectionsQuery.isPending ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted/50" />
          ) : rows.length === 0 ? (
            filtersActive ? (
              <EmptyState
                icon="search"
                title="No global projections match these filters"
                description="Adjust the contract, directory, or status filter to see other records."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setContractFilter('all')
                      setTargetFilter('all')
                      setStatusFilter('all')
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="send"
                title="No global projections yet"
                description="Select instructions and global directories in Batch dispatch, compile the preview, then confirm the write."
                action={
                  <Button size="sm" onClick={() => setBatchOpen(true)} disabled={targets.length === 0}>
                    <Icon name="send" className="h-3.5 w-3.5" />
                    Dispatch instructions
                  </Button>
                }
              />
            )
          ) : (
            <ProjectionTable
              rows={rows}
              resolveTarget={resolveTarget}
              busyProjectionId={busyProjectionId}
              onReproject={(row) => reprojectMutation.mutate(row)}
              onRemove={(row) => setRemoveTarget(row)}
              onRollback={(row) => setRollbackTarget(row)}
              onOverwriteDrift={(row) => {
                setDriftError(null)
                setDriftTarget(row)
              }}
            />
          )}
        </section>
      </div>

      {batchOpen && (
        <BatchDispatchModal
          targets={targets}
          contracts={contracts}
          existing={records}
          initialSearch={query}
          initialTargetIds={selectedTargetIds}
          onClose={() => setBatchOpen(false)}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget)
        }}
        title="Remove this global projection?"
        confirmText="Remove projection"
        message={
          <>
            Removes the managed block or file created by Prompt Keeper for{' '}
            <b className="text-foreground">{removeTarget?.contractTitle}</b> at{' '}
            <span className="font-mono text-foreground">{removeTarget?.targetPath}</span>. The local library,
            Git repository, and other global files are unchanged.
          </>
        }
      />

      <ConfirmDialog
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (rollbackTarget) rollbackMutation.mutate(rollbackTarget)
        }}
        title="Roll back this global projection?"
        confirmText="Roll back"
        danger={false}
        message={
          <>
            Restores the previously deployed content for{' '}
            <b className="text-foreground">{rollbackTarget?.contractTitle}</b> at{' '}
            <span className="font-mono text-foreground">{rollbackTarget?.targetPath}</span>. Only the local
            target file changes; the contract and repository are not rolled back.
          </>
        }
      />

      <OverwriteDriftModal
        projection={driftTarget}
        target={driftTarget ? resolveTarget(driftTarget.targetId) : undefined}
        pending={overwriteMutation.isPending}
        error={driftError}
        onClose={() => {
          setDriftTarget(null)
          setDriftError(null)
        }}
        onConfirm={(row, expectedFileHash) =>
          overwriteMutation.mutate({ row, expectedFileHash })
        }
      />
    </div>
  )
}

function GlobalTargetCard({
  target,
  selected,
  pending,
  onToggleSelected,
  onSavePath,
  onRestoreDefault,
}: {
  target: GlobalTargetDetail
  selected: boolean
  pending: boolean
  onToggleSelected: () => void
  onSavePath: (path: string) => void
  onRestoreDefault: () => void
}) {
  const [draft, setDraft] = useState(target.path)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setDraft(target.path)
    setTouched(false)
  }, [target.path, target.updatedAt])

  const pathError = validateGlobalPath(draft)
  const changed = draft.trim() !== target.path
  const shownError = touched || changed ? pathError : null

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3 transition-colors',
        selected ? 'border-primary ring-1 ring-primary/15' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onChange={onToggleSelected} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-semibold">{target.label}</span>
            <Badge variant={target.detected ? 'success' : 'outline'}>
              {target.detected ? 'Detected' : 'Not detected'}
            </Badge>
            <Badge variant={target.exists ? 'success' : 'outline'}>
              {target.exists ? 'Exists' : 'Not found'}
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {target.agentName} · {target.pathMode === 'file' ? 'Single file' : 'Separate files'}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0"
          disabled={pending || target.path === target.defaultPath}
          onClick={onRestoreDefault}
          title="Restore default path"
        >
          <Icon name="undo" className="h-3 w-3" />
          Default
        </Button>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(event) => {
            setTouched(true)
            setDraft(event.target.value)
          }}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !pathError && changed && !pending) onSavePath(draft.trim())
          }}
          className={cn('h-8 font-mono text-[11px]', shownError && 'border-danger')}
          aria-label={`Path for ${target.label}`}
          aria-invalid={!!shownError}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={pending || !changed || !!pathError}
          onClick={() => onSavePath(draft.trim())}
        >
          {pending ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
          Save
        </Button>
      </div>
      {shownError ? (
        <p className="mt-1 text-[10px] leading-4 text-danger">{shownError}</p>
      ) : (
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{globalPathHint(target)}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{target.projectionCount} projected</Badge>
        <Badge variant={target.staleCount ? 'warning' : 'outline'}>{target.staleCount} stale</Badge>
        <Badge variant={target.driftedCount ? 'danger' : 'outline'}>{target.driftedCount} drifted</Badge>
      </div>
      <p className="mt-1 break-all text-[10px] text-muted-foreground">
        Default: <span className="font-mono">{target.defaultPath}</span>
      </p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{target.note}</p>
    </div>
  )
}

interface CompiledTargetResult {
  target: GlobalTargetDetail
  files: CompiledFile[]
  warnings: string[]
  error?: string
}

function BatchDispatchModal({
  targets,
  contracts,
  existing,
  initialSearch,
  initialTargetIds,
  onClose,
}: {
  targets: GlobalTargetDetail[]
  contracts: ContractListItem[]
  existing: ProjectionDetail[]
  initialSearch: string
  initialTargetIds: string[]
  onClose: () => void
}) {
  const toast = useToast()
  const [contractIds, setContractIds] = useState<string[]>([])
  const [targetIds, setTargetIds] = useState<string[]>(() =>
    initialTargetIds.filter((id) => targets.some((target) => target.id === id)),
  )
  const [scopeChoice, setScopeChoice] = useState<'user' | 'all'>('user')
  const [search, setSearch] = useState(initialSearch)
  const [activeFile, setActiveFile] = useState('')
  const [error, setError] = useState<string | null>(null)

  const visibleContracts = contracts.filter((contract) => {
    if (scopeChoice === 'user' && contract.scope !== 'user') return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [contract.title, contract.description, contract.folder, contract.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const selectedContracts = contracts.filter((contract) => contractIds.includes(contract.id))
  const selectedTargets = targets.filter((target) => targetIds.includes(target.id))

  const combos = selectedContracts.flatMap((contract) =>
    selectedTargets.map((target) => ({
      contract,
      target,
      supported: targetSupportsActivation(target, contract.activationMode),
      record: existing.find(
        (row) => row.contractId === contract.id && row.targetId === target.id,
      ),
    })),
  )
  const supportedCombos = combos.filter((combo) => combo.supported)
  const driftedCombos = supportedCombos.filter((combo) => combo.record?.status === 'drifted')
  const incompatible = combos.length - supportedCombos.length
  const allDrifted = supportedCombos.length > 0 && driftedCombos.length === supportedCombos.length

  const compileMutation = useMutation({
    mutationFn: async (): Promise<CompiledTargetResult[]> => {
      const results = await Promise.all(
        selectedTargets.map(async (target) => {
          try {
            const result = await ipc.contracts.compile({
              targetId: target.id,
              scope: 'global',
              contractIds,
            })
            return { target, files: result.files, warnings: result.warnings }
          } catch (compileError) {
            return {
              target,
              files: [],
              warnings: [],
              error: errorMessage(compileError),
            }
          }
        }),
      )
      return results
    },
    onError: (compileError) => toast.error(errorMessage(compileError)),
  })

  useEffect(() => {
    const files = compileMutation.data?.flatMap((result) => result.files) ?? []
    setActiveFile(files[0] ? `${files[0].targetId}|${files[0].path}` : '')
  }, [compileMutation.data])

  const resetPreview = () => {
    compileMutation.reset()
    setActiveFile('')
    setError(null)
  }

  const toggleContract = (id: string) => {
    setContractIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
    resetPreview()
  }

  const toggleTarget = (id: string) => {
    setTargetIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
    resetPreview()
  }

  const files = compileMutation.data?.flatMap((result) =>
    result.files.map((file) => ({
      ...file,
      targetLabel: result.target.label,
    })),
  ) ?? []
  const compiledFile =
    files.find((file) => `${file.targetId}|${file.path}` === activeFile) ?? files[0]
  const compiledWarnings = Array.from(
    new Set(compileMutation.data?.flatMap((result) => result.warnings) ?? []),
  )
  const compileErrors = compileMutation.data?.filter((result) => result.error) ?? []
  const previewReady = !!compileMutation.data && compileMutation.data.length > 0
  const projectMutation = useMutation({
    mutationFn: () =>
      ipc.globalProjections.project({
        contractIds,
        targetIds,
        confirm: true,
      }),
    onSuccess: () => {
      toast.info(
        `Global dispatch started for ${contractIds.length} instruction${contractIds.length === 1 ? '' : 's'} × ${targetIds.length} director${targetIds.length === 1 ? 'y' : 'ies'}. Drifted items were excluded; results appear when the operation completes.`,
      )
      onClose()
    },
    onError: (projectError) => setError(errorMessage(projectError)),
  })

  const canProject =
    previewReady &&
    compileErrors.length === 0 &&
    !compileMutation.isPending &&
    contractIds.length > 0 &&
    targetIds.length > 0 &&
    supportedCombos.length > 0 &&
    !allDrifted &&
    !projectMutation.isPending

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title="Global batch dispatch"
      subtitle="Compile the exact files first, then confirm. Incompatible combinations are skipped; drifted files are never overwritten in bulk."
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null)
              projectMutation.mutate()
            }}
            disabled={!canProject}
            title={
              !previewReady
                ? 'Compile the preview before starting the projection.'
                : compileErrors.length > 0
                  ? 'One or more targets failed to compile. Remove them or fix the selection and compile again.'
                  : allDrifted
                    ? 'Every supported combination is drifted; overwrite them one by one in the records table.'
                    : undefined
            }
          >
            {projectMutation.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" />}
            Project selected
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Global directories</span>
            <span className="text-[11px] text-muted-foreground">{selectedTargets.length} selected</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {targets.map((target) => {
              const checked = targetIds.includes(target.id)
              return (
                <div
                  key={target.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleTarget(target.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleTarget(target.id)
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5',
                    checked ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                    <Checkbox checked={checked} onChange={() => toggleTarget(target.id)} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{target.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {target.pathMode === 'file' ? 'Single file' : 'Separate files'} · {target.path}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Instructions</span>
            <span className="text-[11px] text-muted-foreground">{selectedContracts.length} selected</span>
            <Select
              className="h-8 w-36 text-xs"
              value={scopeChoice}
              onChange={(event) => setScopeChoice(event.target.value as 'user' | 'all')}
              aria-label="Contract scope filter"
            >
              <option value="user">User-scoped</option>
              <option value="all">All scopes</option>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter instructions"
              className="h-8 max-w-xs text-xs"
              aria-label="Filter instructions for global dispatch"
            />
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-8"
              onClick={() =>
                setContractIds((current) => {
                  const allVisible = visibleContracts.every((contract) => current.includes(contract.id))
                  return allVisible
                    ? current.filter(
                        (id) => !visibleContracts.some((contract) => contract.id === id),
                      )
                    : Array.from(new Set([...current, ...visibleContracts.map((contract) => contract.id)]))
                })
              }
            >
              {visibleContracts.length > 0 &&
              visibleContracts.every((contract) => contractIds.includes(contract.id))
                ? 'Deselect visible'
                : 'Select visible'}
            </Button>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
            {visibleContracts.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {contracts.length === 0
                  ? 'No contracts exist yet. Create user-scoped contracts in Contract Library first.'
                  : 'No instructions match the current scope filter or search.'}
              </p>
            ) : (
              visibleContracts.map((contract) => {
                const checked = contractIds.includes(contract.id)
                const recordCount = existing.filter((row) => row.contractId === contract.id).length
                return (
                  <div
                    key={contract.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleContract(contract.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleContract(contract.id)
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2 last:border-0',
                      checked ? 'bg-primary-soft/60' : 'hover:bg-muted/40',
                    )}
                  >
                    <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                      <Checkbox checked={checked} onChange={() => toggleContract(contract.id)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{contract.title}</span>
                        <Badge variant="outline">{contract.scope}</Badge>
                        <Badge variant="outline">{ACTIVATION_META[contract.activationMode].short}</Badge>
                        {recordCount > 0 && (
                          <Badge variant="success">In {recordCount} global director{recordCount === 1 ? 'y' : 'ies'}</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {contract.folder || 'Uncategorized'} · {contract.description || 'No description'}
                      </span>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            Selected {selectedContracts.length} instructions × {selectedTargets.length} directories
          </span>
          {incompatible > 0 && (
            <Badge variant="warning">{incompatible} skipped: incompatible activation</Badge>
          )}
          {driftedCombos.length > 0 && (
            <Badge variant="danger">
              {driftedCombos.length} drifted: excluded from this batch
            </Badge>
          )}
          {allDrifted && (
            <span className="text-danger">
              Every supported combination is drifted. Overwrite them one by one in the records table.
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8"
            disabled={selectedContracts.length === 0 || selectedTargets.length === 0 || compileMutation.isPending}
            onClick={() => {
              setError(null)
              compileMutation.mutate()
            }}
          >
            {compileMutation.isPending ? <Spinner className="h-3 w-3" /> : <Icon name="play" className="h-3 w-3" />}
            Compile preview
          </Button>
        </div>

        {compileErrors.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
            {compileErrors.map((result) => (
              <div key={result.target.id} className="text-[11px] leading-5 text-danger">
                {result.target.label}: {result.error}
              </div>
            ))}
          </div>
        )}

        {compileMutation.data && (
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <span className="text-xs font-semibold">Final files</span>
              <Badge variant="outline">{files.length} files</Badge>
              {compiledWarnings.length > 0 && (
                <Badge variant="warning">{compiledWarnings.length} warnings</Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">
                Read-only preview. The backend recompiles from validated database state before writing.
              </span>
            </div>
            {compiledWarnings.length > 0 && (
              <div className="border-b border-border/60 px-3 py-2">
                {compiledWarnings.map((warning) => (
                  <div key={warning} className="text-[11px] leading-5 text-warning">
                    {warning}
                  </div>
                ))}
              </div>
            )}
            {files.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                The compiler returned no files for this selection.
              </p>
            ) : (
              <div className="p-3">
                <div className="flex flex-wrap gap-1 border-b border-border pb-2">
                  {files.map((file) => (
                    <button
                      key={`${file.targetId}-${file.path}`}
                      type="button"
                      onClick={() => setActiveFile(`${file.targetId}|${file.path}`)}
                      className={cn(
                        'max-w-full cursor-pointer truncate rounded-md px-2 py-1 font-mono text-[10px]',
                        compiledFile?.targetId === file.targetId &&
                          compiledFile.path === file.path
                          ? 'bg-primary-soft text-primary'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                      title={`${file.targetLabel} · ${file.path}`}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
                {compiledFile && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                      <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate text-[10px] font-medium">{compiledFile.targetLabel}</span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                        {compiledFile.path}
                      </code>
                      <span className="tabular text-[10px] text-muted-foreground">
                        {formatBytes(compiledFile.bytes)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        onClick={() => {
                          void copyToClipboard(compiledFile.content).then((ok) => {
                            if (ok) toast.success('Copied the compiled file content')
                            else toast.error('Copy failed. Check the clipboard permission for this window.')
                          })
                        }}
                        aria-label="Copy compiled content"
                        title="Copy compiled content"
                      >
                        <Icon name="copy" className="h-3 w-3" />
                      </Button>
                    </div>
                    <pre className="max-h-72 overflow-auto bg-muted/20 p-3 font-mono text-[11px] leading-5">
                      {compiledFile.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!previewReady && (
          <p className="text-[11px] leading-5 text-muted-foreground">
            Select instructions and directories, then compile the preview. Projection stays disabled until the
            exact output has been reviewed. Drifted items are reported separately and are never overwritten in
            a batch.
          </p>
        )}
      </div>
    </Modal>
  )
}
