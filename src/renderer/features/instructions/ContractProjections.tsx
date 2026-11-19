import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ContractListItem,
  ContractTarget,
  ProjectionDetail,
  ProjectionStatus,
  ProjectSummary,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, EmptyState, Input, Select, Spinner } from '../../components/ui/primitives'
import { ConfirmDialog, Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import { errorDetails, errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  PROJECTION_STATUS_META,
  targetSupportsActivation,
  validateProjectRoot,
} from '../../lib/viewModels/contract'

export interface ProjectionTargetInfo {
  label: string
  agentName?: string
  merge?: 'single-file' | 'per-contract'
}

export function ProjectionStatusBadge({ status }: { status: ProjectionStatus }) {
  const meta = PROJECTION_STATUS_META[status]
  return (
    <Badge variant={meta.variant} title={meta.label}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  )
}

export function ProjectionTable({
  rows,
  resolveTarget,
  onReproject,
  onRemove,
  onRollback,
  onOverwriteDrift,
  busyProjectionId,
}: {
  rows: ProjectionDetail[]
  resolveTarget: (targetId: string) => ProjectionTargetInfo | undefined
  onReproject: (row: ProjectionDetail) => void
  onRemove: (row: ProjectionDetail) => void
  onRollback: (row: ProjectionDetail) => void
  onOverwriteDrift: (row: ProjectionDetail) => void
  busyProjectionId?: string | null
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-max border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2.5 font-medium">Contract</th>
            <th className="px-3 py-2.5 font-medium">Target</th>
            <th className="px-3 py-2.5 font-medium">Write path</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Version / time</th>
            <th className="px-3 py-2.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const target = resolveTarget(row.targetId)
            const busy = busyProjectionId === row.id
            return (
              <tr
                key={row.id}
                className="border-b border-border/60 last:border-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-64 truncate text-xs font-medium">{row.contractTitle}</span>
                    {row.orphaned && (
                      <Badge variant="warning" title="The local contract was deleted; content cannot be regenerated.">
                        Orphaned
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {row.orphaned
                      ? 'Deleted contract; remove or roll back only'
                      : row.contractSlug}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-xs">{target?.label ?? row.targetId}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {target?.agentName ?? 'Unknown target'}
                    {target?.merge ? ` · ${target.merge === 'single-file' ? 'Merged file' : 'Separate file'}` : ''}
                  </div>
                </td>
                <td className="max-w-72 px-3 py-2">
                  <code
                    className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                    title={row.targetPath}
                  >
                    {row.targetPath}
                  </code>
                  {row.note && (
                    <div className="mt-0.5 max-w-72 truncate text-[10px] text-muted-foreground" title={row.note}>
                      {row.note}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ProjectionStatusBadge status={row.status} />
                  {row.status === 'drifted' && (
                    <div className="mt-0.5 text-[10px] text-danger">Manual edits detected</div>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  <div>{row.deployedVersion !== null ? `v${row.deployedVersion}` : '—'}</div>
                  <div>{relativeTime(row.deployedAt)}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {!row.orphaned && row.status === 'drifted' && (
                      <Button
                        size="sm"
                        variant="danger"
                        className="h-7"
                        disabled={busy || !row.fileHash}
                        onClick={() => onOverwriteDrift(row)}
                        title={
                          row.fileHash
                            ? 'Overwrite manual edits explicitly; the expected file hash must match.'
                            : 'No file hash was recorded, so overwrite is unavailable. Reproject or remove instead.'
                        }
                      >
                        Overwrite drift
                      </Button>
                    )}
                    {!row.orphaned && row.status !== 'drifted' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busy}
                        onClick={() => onReproject(row)}
                      >
                        {busy ? <Spinner className="h-3 w-3" /> : <Icon name="refresh" className="h-3 w-3" />}
                        Reproject
                      </Button>
                    )}
                    {typeof row.previousVersion === 'number' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        disabled={busy}
                        onClick={() => onRollback(row)}
                        title={`Roll back to v${row.previousVersion}`}
                      >
                        <Icon name="undo" className="h-3 w-3" />
                        Rollback
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-danger"
                      disabled={busy}
                      onClick={() => onRemove(row)}
                    >
                      <Icon name="trash" className="h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function OverwriteDriftModal({
  projection,
  target,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  projection: ProjectionDetail | null
  target?: ProjectionTargetInfo
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: (projection: ProjectionDetail, expectedFileHash: string) => void
}) {
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    setConfirmed(false)
  }, [projection?.id])

  return (
    <Modal
      open={!!projection}
      onClose={onClose}
      width="max-w-lg"
      title="Overwrite manual edits?"
      subtitle="Drifted files are never overwritten in bulk. This is an item-level confirmation."
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!projection?.fileHash || !confirmed || pending}
            onClick={() => {
              if (projection?.fileHash) onConfirm(projection, projection.fileHash)
            }}
          >
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="alert" />}
            Overwrite and project
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Target path</div>
          <div className="mt-0.5 break-all font-mono text-xs">{projection?.targetPath}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">Expected file hash</div>
          <div className="mt-0.5 break-all font-mono text-[11px]">
            {projection?.fileHash ?? 'Not recorded; overwrite is unavailable.'}
          </div>
          <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {target?.merge === 'single-file'
              ? 'This is a merged file. Only the managed block for this contract is rewritten; other contracts stay unchanged.'
              : 'This is a separate file owned by this projection. The entire file is rewritten.'}
          </div>
        </div>

        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
          The file was edited outside Prompt Keeper. Overwriting discards those edits inside the managed
          region for this contract and cannot be undone from the Agent side.
        </div>

        {projection?.note && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            Drift note: {projection.note}
          </div>
        )}

        <Checkbox
          checked={confirmed}
          onChange={setConfirmed}
          label="I understand this overwrites manual edits at the path and hash shown above."
        />
      </div>
    </Modal>
  )
}

export function ContractProjections() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [contractFilter, setContractFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectionStatus>('all')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [removeProject, setRemoveProject] = useState<ProjectSummary | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectionDetail | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<ProjectionDetail | null>(null)
  const [driftTarget, setDriftTarget] = useState<ProjectionDetail | null>(null)
  const [driftError, setDriftError] = useState<string | null>(null)

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => ipc.projects.list(),
    staleTime: 30_000,
  })
  const targetsQuery = useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => ipc.targets.list(),
    staleTime: 5 * 60_000,
  })
  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    queryFn: () => ipc.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    staleTime: 30_000,
  })

  const projects = projectsQuery.data ?? []
  const targets = targetsQuery.data ?? []
  const contracts = contractsQuery.data?.items ?? []

  useEffect(() => {
    if (!projectsQuery.data) return
    if (projectsQuery.data.length === 0) {
      if (selectedProjectId) setSelectedProjectId('')
      return
    }
    if (!selectedProjectId) {
      setSelectedProjectId(projectsQuery.data[0].id)
      return
    }
    const stillPresent = projectsQuery.data.some((project) => project.id === selectedProjectId)
    if (!stillPresent && !projectsQuery.isFetching) {
      setSelectedProjectId(projectsQuery.data[0].id)
    }
  }, [projectsQuery.data, projectsQuery.isFetching, selectedProjectId])

  const projectionQuery = useMemo(
    () => ({
      scope: 'project' as const,
      projectId: selectedProjectId,
      limit: 200,
    }),
    [selectedProjectId],
  )

  const projectionsQuery = useQuery({
    queryKey: queryKeys.projections.list(projectionQuery),
    queryFn: () => ipc.projections.list(projectionQuery),
    enabled: !!selectedProjectId,
  })

  const allRows = projectionsQuery.data?.items ?? []
  const scopedRows = allRows.filter((row) => {
    if (contractFilter !== 'all' && row.contractId !== contractFilter) return false
    if (targetFilter !== 'all' && row.targetId !== targetFilter) return false
    return true
  })
  const rows =
    statusFilter === 'all' ? scopedRows : scopedRows.filter((row) => row.status === statusFilter)
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets])
  const resolveTarget = (targetId: string): ProjectionTargetInfo | undefined => {
    const target = targetById.get(targetId)
    return target
      ? { label: target.label, agentName: target.agentName, merge: target.merge }
      : undefined
  }

  const counts = {
    synced: scopedRows.filter((row) => row.status === 'synced').length,
    stale: scopedRows.filter((row) => row.status === 'stale').length,
    drifted: scopedRows.filter((row) => row.status === 'drifted').length,
    missing: scopedRows.filter((row) => row.status === 'missing').length,
  }

  const filtersActive = contractFilter !== 'all' || targetFilter !== 'all' || statusFilter !== 'all'
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  const invalidateProjections = () => {
    void queryClient.invalidateQueries({ queryKey: ['projections'] })
  }
  const invalidateProjects = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['projections'] })
  }

  const registerMutation = useMutation({
    mutationFn: (input: { name: string; rootPath: string }) => ipc.projects.register(input),
    onSuccess: (project) => {
      invalidateProjects()
      setSelectedProjectId(project.id)
      setRegisterOpen(false)
      setRegisterError(null)
      toast.success(`Registered project root "${project.name}".`)
    },
    onError: (error) => setRegisterError(errorMessage(error)),
  })

  const removeProjectMutation = useMutation({
    mutationFn: (project: ProjectSummary) =>
      ipc.projects.remove({ projectId: project.id, confirm: true }),
    onSuccess: (result, project) => {
      invalidateProjects()
      if (selectedProjectId === project.id) setSelectedProjectId('')
      toast.success(
        `Removed "${project.name}".` +
          (result.orphanedProjectionIds.length > 0
            ? ` ${result.orphanedProjectionIds.length} projection records became orphaned; target files are untouched.`
            : ' Target files are untouched.'),
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const projectMutation = useMutation({
    mutationFn: (input: { contractIds: string[]; targetIds: string[] }) =>
      ipc.projections.project({
        contractIds: input.contractIds,
        targetIds: input.targetIds,
        projectId: selectedProjectId,
        confirm: true,
      }),
    onSuccess: (_, input) => {
      setProjectModalOpen(false)
      setProjectError(null)
      toast.info(
        `Projection started for ${input.contractIds.length} contract${input.contractIds.length === 1 ? '' : 's'} × ${input.targetIds.length} target${input.targetIds.length === 1 ? '' : 's'}. The table refreshes when the operation completes.`,
      )
    },
    onError: (error) => setProjectError(errorMessage(error)),
  })

  const reprojectMutation = useMutation({
    mutationFn: (row: ProjectionDetail) => ipc.projections.reproject({ projectionId: row.id }),
    onSuccess: (updated) => {
      invalidateProjections()
      toast.success(`Reprojected "${updated.contractTitle}".`)
    },
    onError: (error, row) => {
      const details = errorDetails(error)
      if (details?.kind === 'projection-drift') {
        setDriftError(null)
        setDriftTarget(row)
        toast.warning('The target file drifted. Confirm the overwrite explicitly before re-projecting.')
        return
      }
      toast.error(errorMessage(error))
    },
  })

  const removeMutation = useMutation({
    mutationFn: (row: ProjectionDetail) =>
      ipc.projections.remove({ projectionId: row.id, confirm: true }),
    onSuccess: (result, row) => {
      invalidateProjections()
      toast.success(
        `Removed "${row.contractTitle}" from ${result.targetPath}. The local library and repository are unchanged.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const rollbackMutation = useMutation({
    mutationFn: (row: ProjectionDetail) => ipc.projections.rollback({ projectionId: row.id }),
    onSuccess: (updated) => {
      invalidateProjections()
      toast.warning(
        `Rolled back "${updated.contractTitle}" to the previous deployed version. The local library and repository are unchanged.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const overwriteMutation = useMutation({
    mutationFn: (input: { row: ProjectionDetail; expectedFileHash: string }) =>
      ipc.projections.overwriteDrift({
        projectionId: input.row.id,
        expectedFileHash: input.expectedFileHash,
        confirm: true,
      }),
    onSuccess: (updated) => {
      invalidateProjections()
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Project projection is a one-way write from the local contract library to a registered project
            root. Single-file targets merge contracts with managed block markers; hand-edited files are marked
            drifted and require item-level confirmation before overwrite.
          </span>
        </div>

        <section className="rounded-xl border border-border bg-card px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Icon name="folder" className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold">Project root</span>
            </div>
            <Select
              className="h-8 w-72 text-xs"
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value)
                setContractFilter('all')
                setTargetFilter('all')
                setStatusFilter('all')
              }}
              disabled={projects.length === 0}
              aria-label="Project root"
            >
              {projects.length === 0 ? (
                <option value="">No project registered</option>
              ) : (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.rootPath}
                  </option>
                ))
              )}
            </Select>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setRegisterOpen(true)}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              Register project root
            </Button>
            {selectedProject && (
              <>
                <Badge variant="outline">{selectedProject.projectionCount} projections</Badge>
                <Badge variant={selectedProject.staleCount ? 'warning' : 'outline'}>
                  {selectedProject.staleCount} stale
                </Badge>
                <Badge variant={selectedProject.driftedCount ? 'danger' : 'outline'}>
                  {selectedProject.driftedCount} drifted
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-danger"
                  onClick={() => setRemoveProject(selectedProject)}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                  Remove project
                </Button>
              </>
            )}
            <Button
              size="sm"
              className="ml-auto h-8"
              disabled={!selectedProject}
              onClick={() => {
                setProjectError(null)
                setProjectModalOpen(true)
              }}
            >
              <Icon name="send" className="h-3.5 w-3.5" />
              Project contracts
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Project roots are required for project-level projection. They are local machine paths and are
            never written to Git.
          </p>
        </section>

        {projectsQuery.isError ? (
          <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-danger">
              <Icon name="alert" className="h-4 w-4" />
              {errorMessage(projectsQuery.error)}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void projectsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : projectsQuery.isPending ? (
          <div className="space-y-2">
            <div className="h-12 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-40 animate-pulse rounded-xl bg-muted/50" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="folder"
            title="Register a project root first"
            description="Project roots are required for project-level projection. Register a folder on this machine, then select contracts and targets to write native instruction files into that project."
            action={
              <Button size="sm" onClick={() => setRegisterOpen(true)}>
                <Icon name="plus" className="h-3.5 w-3.5" />
                Register project root
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="h-8 w-52 text-xs"
                value={contractFilter}
                onChange={(event) => setContractFilter(event.target.value)}
                aria-label="Filter projections by contract"
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
                aria-label="Filter projections by target"
              >
                <option value="all">All targets</option>
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
                    { value: 'synced', label: `Synced ${counts.synced}` },
                    { value: 'stale', label: `Stale ${counts.stale}` },
                    { value: 'drifted', label: `Drifted ${counts.drifted}` },
                    { value: 'missing', label: `Missing ${counts.missing}` },
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
              <span className="ml-auto text-[11px] text-muted-foreground">
                Drifted items must be overwritten one by one.
              </span>
            </div>

            {projectionsQuery.isError ? (
              <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-danger">
                  <Icon name="alert" className="h-4 w-4" />
                  {errorMessage(projectionsQuery.error)}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => void projectionsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : projectionsQuery.isPending ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted/50" />
            ) : rows.length === 0 ? (
              filtersActive ? (
                <EmptyState
                  icon="search"
                  title="No projections match these filters"
                  description="Adjust the contract, target, or status filter to see other projection records."
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
                  title="No projections in this project"
                  description="Select contracts and targets to write them into this project root. Projection is explicit and does not change the local library or Git repository."
                  action={
                    <Button
                      size="sm"
                      onClick={() => {
                        setProjectError(null)
                        setProjectModalOpen(true)
                      }}
                    >
                      <Icon name="send" className="h-3.5 w-3.5" />
                      Project contracts
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
          </>
        )}
      </div>

      <RegisterProjectModal
        open={registerOpen}
        pending={registerMutation.isPending}
        error={registerError}
        onClose={() => {
          setRegisterOpen(false)
          setRegisterError(null)
        }}
        onSubmit={(name, rootPath) => {
          setRegisterError(null)
          registerMutation.mutate({ name, rootPath })
        }}
      />

      {projectModalOpen && (
        <ProjectSelectionModal
          contracts={contracts}
          targets={targets}
          existing={allRows}
          pending={projectMutation.isPending}
          error={projectError}
          onClose={() => {
            setProjectModalOpen(false)
            setProjectError(null)
          }}
          onSubmit={(contractIds, targetIds) => {
            setProjectError(null)
            projectMutation.mutate({ contractIds, targetIds })
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeProject}
        onClose={() => setRemoveProject(null)}
        onConfirm={() => {
          if (removeProject) removeProjectMutation.mutate(removeProject)
        }}
        title="Remove this project root?"
        confirmText="Remove project"
        message={
          <>
            Removes <b className="text-foreground">{removeProject?.name}</b> (
            <span className="font-mono text-foreground">{removeProject?.rootPath}</span>) and its project
            registration. {removeProject?.projectionCount ?? 0} projection record
            {(removeProject?.projectionCount ?? 0) === 1 ? '' : 's'} become orphaned; files already written
            into the project are not deleted. The contract library and Git repository are unchanged.
          </>
        }
      />

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget)
        }}
        title="Remove this projection?"
        confirmText="Remove projection"
        message={
          <>
            Removes the managed block or file created by Prompt Keeper for{' '}
            <b className="text-foreground">{removeTarget?.contractTitle}</b> at{' '}
            <span className="font-mono text-foreground">{removeTarget?.targetPath}</span>. The contract
            library and Git repository are unchanged; other contracts in a merged file are untouched.
          </>
        }
      />

      <ConfirmDialog
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (rollbackTarget) rollbackMutation.mutate(rollbackTarget)
        }}
        title="Roll back this projection?"
        confirmText="Roll back"
        danger={false}
        message={
          <>
            Restores the previously deployed content for{' '}
            <b className="text-foreground">{rollbackTarget?.contractTitle}</b> at{' '}
            <span className="font-mono text-foreground">{rollbackTarget?.targetPath}</span>. Only the target
            file changes; the local contract and repository are not rolled back.
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

function RegisterProjectModal({
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (name: string, rootPath: string) => void
}) {
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setRootPath('')
    setTouched(false)
  }, [open])

  const pathError = touched ? validateProjectRoot(rootPath) : null
  const nameError = touched && !name.trim() ? 'A project name is required.' : null
  const submit = () => {
    setTouched(true)
    if (!name.trim()) return
    if (validateProjectRoot(rootPath)) return
    onSubmit(name.trim(), rootPath.trim())
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-lg"
      title="Register project root"
      subtitle="Project roots are required for project-level projection. This path stays on this machine and is never written to Git."
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="plus" />}
            Register
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Project name</label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. Storefront"
            aria-label="Project name"
            aria-invalid={!!nameError}
          />
          {nameError && <p className="mt-1 text-[11px] text-danger">{nameError}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Root path</label>
          <Input
            value={rootPath}
            onChange={(event) => {
              setTouched(true)
              setRootPath(event.target.value)
            }}
            onBlur={() => setTouched(true)}
            placeholder="/Users/you/code/storefront"
            className="font-mono text-xs"
            aria-label="Project root path"
            aria-invalid={!!pathError}
          />
          {pathError ? (
            <p className="mt-1 text-[11px] text-danger">{pathError}</p>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Must be an absolute path. The backend validates that the directory exists before registering it.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ProjectSelectionModal({
  contracts,
  targets,
  existing,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  contracts: ContractListItem[]
  targets: ContractTarget[]
  existing: ProjectionDetail[]
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (contractIds: string[], targetIds: string[]) => void
}) {
  const [contractIds, setContractIds] = useState<string[]>([])
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const filteredContracts = contracts.filter((contract) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [contract.title, contract.description, contract.folder, contract.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const selectedContracts = contracts.filter((contract) => contractIds.includes(contract.id))
  const selectedTargets = targets.filter((target) => targetIds.includes(target.id))

  let incompatible = 0
  let drifted = 0
  for (const contract of selectedContracts) {
    for (const target of selectedTargets) {
      const compatibility = contract.compatibility.find((entry) => entry.targetId === target.id)
      const supported = compatibility
        ? !compatibility.blocking
        : targetSupportsActivation(target, contract.activationMode)
      if (!supported) {
        incompatible += 1
        continue
      }
      const record = existing.find(
        (row) => row.contractId === contract.id && row.targetId === target.id,
      )
      if (record?.status === 'drifted') drifted += 1
    }
  }
  const supportedTotal = selectedContracts.length * selectedTargets.length - incompatible
  const allDrifted = supportedTotal > 0 && drifted === supportedTotal
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title="Project contracts"
      subtitle="Select contracts and targets. Incompatible combinations are skipped explicitly; drifted files are excluded from the batch."
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(contractIds, targetIds)}
            disabled={
              pending ||
              contractIds.length === 0 ||
              targetIds.length === 0 ||
              supportedTotal === 0 ||
              allDrifted
            }
            title={
              supportedTotal === 0 && contractIds.length > 0 && targetIds.length > 0
                ? 'Every selected combination is incompatible with the contract activation.'
                : allDrifted
                  ? 'Every supported combination is drifted; overwrite them one by one in the table.'
                  : undefined
            }
          >
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" />}
            Start projection
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Targets</span>
            <span className="text-[11px] text-muted-foreground">{selectedTargets.length} selected</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {targets.map((target) => {
              const checked = targetIds.includes(target.id)
              return (
                <div
                  key={target.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setTargetIds((current) => toggle(current, target.id))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setTargetIds((current) => toggle(current, target.id))
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5',
                    checked ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                    <Checkbox
                      checked={checked}
                      onChange={() => setTargetIds((current) => toggle(current, target.id))}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{target.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {target.merge === 'single-file' ? 'Merged file' : 'Separate file'}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Contracts</span>
            <span className="text-[11px] text-muted-foreground">{selectedContracts.length} selected</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by title, folder, tag, or description"
              className="ml-auto h-8 max-w-xs text-xs"
              aria-label="Filter contracts to project"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() =>
                setContractIds((current) =>
                  filteredContracts.every((contract) => current.includes(contract.id))
                    ? current.filter((id) => !filteredContracts.some((contract) => contract.id === id))
                    : Array.from(new Set([...current, ...filteredContracts.map((contract) => contract.id)])),
                )
              }
            >
              {filteredContracts.length > 0 &&
              filteredContracts.every((contract) => contractIds.includes(contract.id))
                ? 'Deselect visible'
                : 'Select visible'}
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            {filteredContracts.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {contracts.length === 0
                  ? 'No contracts exist yet. Create one in Contract Library first.'
                  : 'No contracts match this filter.'}
              </p>
            ) : (
              filteredContracts.map((contract) => {
                const checked = contractIds.includes(contract.id)
                return (
                  <div
                    key={contract.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setContractIds((current) => toggle(current, contract.id))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setContractIds((current) => toggle(current, contract.id))
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2 last:border-0',
                      checked ? 'bg-primary-soft/60' : 'hover:bg-muted/40',
                    )}
                  >
                    <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                      <Checkbox
                        checked={checked}
                        onChange={() => setContractIds((current) => toggle(current, contract.id))}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{contract.title}</span>
                        <Badge variant="outline" className="ml-auto shrink-0">
                          {contract.scope}
                        </Badge>
                        <Badge variant="outline" className="shrink-0">
                          {contract.activationMode}
                        </Badge>
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
            {selectedContracts.length} contracts × {selectedTargets.length} targets ={' '}
            {selectedContracts.length * selectedTargets.length} combinations
          </span>
          {incompatible > 0 && (
            <Badge variant="warning">{incompatible} skipped: activation unsupported</Badge>
          )}
          {drifted > 0 && (
            <Badge variant="danger">{drifted} drifted: not overwritten in this batch</Badge>
          )}
          {allDrifted && (
            <span className="text-danger">
              Every supported combination is drifted. Overwrite them one by one in the projection table.
            </span>
          )}
          <span className="ml-auto">The operation runs in the background; progress appears in the operation panel.</span>
        </div>
      </div>
    </Modal>
  )
}
