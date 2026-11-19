import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  ContractCompileInput,
  ContractResolveInput,
  ContractTarget,
  GlobalTargetDetail,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { copyToClipboard } from '../../lib/clipboard'
import { cn } from '../../lib/cn'
import { useToast } from '../../components/ui/toast'
import { errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { formatBytes } from '../../lib/format'
import { ACTIVATION_META, SKIP_CODE_LABEL } from '../../lib/viewModels/contract'

const DEFAULT_APPROXIMATION =
  'This preview is a static approximation. It does not invoke any tool CLI; the target tool is authoritative for merge order and final behavior.'

const SAMPLE_PATHS = [
  'src/components/PromptDetail.tsx',
  'src/lib/viewModels/contract.ts',
  'docs/interaction-design.md',
  'README.md',
  'scripts/build.sh',
]

export function ContractResolutionPreview() {
  const toast = useToast()
  const [targetId, setTargetId] = useState('agents-md')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [projectId, setProjectId] = useState('')
  const [samplePath, setSamplePath] = useState(SAMPLE_PATHS[0])
  const [contractIds, setContractIds] = useState<string[]>([])
  const [contractSearch, setContractSearch] = useState('')
  const [activeFilePath, setActiveFilePath] = useState('')

  const targetsQuery = useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => ipc.targets.list(),
    staleTime: 5 * 60_000,
  })
  const globalTargetsQuery = useQuery({
    queryKey: queryKeys.projections.globalTargets,
    queryFn: () => ipc.globalTargets.list(),
    staleTime: 60_000,
  })
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => ipc.projects.list(),
    staleTime: 30_000,
  })
  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    queryFn: () => ipc.contracts.list({ limit: 200, sort: 'title', order: 'asc' }),
    staleTime: 30_000,
  })

  const projectTargets: ContractTarget[] = targetsQuery.data ?? []
  const globalTargets: GlobalTargetDetail[] = globalTargetsQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const allContracts = contractsQuery.data?.items ?? []

  useEffect(() => {
    const available = [...projectTargets, ...globalTargets]
    if (available.length > 0 && !available.some((target) => target.id === targetId)) {
      setTargetId(available[0].id)
    }
  }, [globalTargets, projectTargets, targetId])

  useEffect(() => {
    if (projects.length > 0 && !projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0].id)
    }
  }, [projectId, projects])

  const selectedProjectTarget = projectTargets.find((target) => target.id === targetId)
  const selectedGlobalTarget = globalTargets.find((target) => target.id === targetId)
  const targetIsGlobal = !!selectedGlobalTarget

  const resolveInput: ContractResolveInput = useMemo(
    () => ({
      targetId,
      scope,
      ...(scope === 'project' && projectId ? { projectId } : {}),
      ...(samplePath.trim() ? { samplePath: samplePath.trim() } : {}),
      ...(contractIds.length > 0 ? { contractIds } : {}),
    }),
    [contractIds, projectId, samplePath, scope, targetId],
  )

  const canResolve = !!targetId && (scope === 'global' || !!projectId)

  const resolveQuery = useQuery({
    queryKey: queryKeys.contracts.resolution(resolveInput),
    queryFn: () => ipc.contracts.resolve(resolveInput),
    enabled: canResolve,
  })

  const compileMutation = useMutation({
    mutationFn: (input: ContractCompileInput) => ipc.contracts.compile(input),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const compileKey = `${targetId}|${scope}|${projectId}|${samplePath}|${contractIds.join(',')}`
  useEffect(() => {
    // A compiled preview is only valid for the resolution inputs that produced it.
    compileMutation.reset()
  }, [compileKey])

  useEffect(() => {
    if (compileMutation.data?.files.length) {
      setActiveFilePath(compileMutation.data.files[0].path)
    } else {
      setActiveFilePath('')
    }
  }, [compileMutation.data])

  const chooseTarget = (nextId: string) => {
    setTargetId(nextId)
    if (globalTargets.some((target) => target.id === nextId)) setScope('global')
    else if (projectTargets.some((target) => target.id === nextId)) setScope('project')
  }

  const preview = resolveQuery.data
  const maxBytes = preview?.maxBytes ?? selectedProjectTarget?.maxBytes ?? selectedGlobalTarget?.maxBytes
  const totalBytes = preview?.totalBytes ?? 0
  const budgetPct = maxBytes ? Math.min(100, Math.round((totalBytes / maxBytes) * 100)) : 0
  const budgetExceeded = preview?.budgetExceeded ?? (!!maxBytes && totalBytes > maxBytes)

  const filteredContracts = allContracts.filter((contract) => {
    const query = contractSearch.trim().toLowerCase()
    if (!query) return true
    return [contract.title, contract.description, contract.folder, contract.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const compile = () => {
    const ids =
      contractIds.length > 0
        ? contractIds
        : (preview?.included.map((entry) => entry.contractId) ?? [])
    if (ids.length === 0) {
      toast.warning('No contracts are included for this target and sample path, so there is nothing to compile.')
      return
    }
    if (!canResolve) {
      toast.warning('Select a project root before compiling.')
      return
    }
    compileMutation.mutate({
      targetId,
      scope,
      ...(scope === 'project' && projectId ? { projectId } : {}),
      ...(samplePath.trim() ? { samplePath: samplePath.trim() } : {}),
      contractIds: ids,
    })
  }

  const activeFile =
    compileMutation.data?.files.find((file) => file.path === activeFilePath) ??
    compileMutation.data?.files[0]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="eye" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{preview?.approximationNotice ?? DEFAULT_APPROXIMATION}</span>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Target</label>
            <Select value={targetId} onChange={(event) => chooseTarget(event.target.value)}>
              <optgroup label="Project targets">
                {projectTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.agentName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Global directory targets">
                {globalTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} · {target.agentName}
                  </option>
                ))}
              </optgroup>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Scope</label>
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value as 'project' | 'global')}
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Project root</label>
            <Select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={scope === 'global' || projects.length === 0}
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
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              File path being handled
            </label>
            <Input
              list="contract-preview-paths"
              value={samplePath}
              onChange={(event) => setSamplePath(event.target.value)}
              className="font-mono text-xs"
              placeholder="src/components/PromptDetail.tsx"
            />
            <datalist id="contract-preview-paths">
              {SAMPLE_PATHS.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
          <span className="text-[11px] text-muted-foreground">Sample paths:</span>
          {SAMPLE_PATHS.map((path) => (
            <Button
              key={path}
              size="sm"
              variant={samplePath === path ? 'secondary' : 'outline'}
              className="h-7"
              onClick={() => setSamplePath(path)}
            >
              {path.split('/').slice(-1)[0]}
            </Button>
          ))}
        </div>

        {(selectedProjectTarget || selectedGlobalTarget) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <Badge variant="primary">{selectedGlobalTarget?.label ?? selectedProjectTarget?.label}</Badge>
            <Badge variant="outline">
              {selectedGlobalTarget
                ? selectedGlobalTarget.merge === 'single-file'
                  ? 'Merged file'
                  : 'Separate files'
                : selectedProjectTarget?.merge === 'single-file'
                  ? 'Merged file'
                  : 'Separate files'}
            </Badge>
            <span className="text-[11px] leading-5 text-muted-foreground">
              {selectedGlobalTarget?.note ?? selectedProjectTarget?.note}
            </span>
            {targetIsGlobal && scope === 'project' && (
              <Badge variant="warning">This target is global; select Global scope.</Badge>
            )}
          </div>
        )}

        {scope === 'project' && projects.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Project roots are required for project-level resolution. Register a project root in Project
            Projections first, or switch the scope to Global.
          </div>
        )}
      </section>

      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-foreground">
          Limit to specific contracts (optional)
          <Badge variant="outline" className="ml-2">
            {contractIds.length > 0 ? `${contractIds.length} selected` : 'All eligible contracts'}
          </Badge>
          <span className="ml-2 font-normal text-muted-foreground">
            Unselected eligible contracts appear as skipped with the reason "target not selected".
          </span>
        </summary>
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Input
              value={contractSearch}
              onChange={(event) => setContractSearch(event.target.value)}
              placeholder="Filter contracts by title, folder, description, or tag"
              className="h-8 max-w-sm text-xs"
              aria-label="Filter contracts for resolution"
            />
            {contractIds.length > 0 && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setContractIds([])}>
                Clear selection
              </Button>
            )}
          </div>
          {contractsQuery.isPending ? (
            <div className="mt-3 h-20 animate-pulse rounded-lg bg-muted/60" />
          ) : contractsQuery.isError ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-danger">
              Contracts could not be loaded.
              <Button size="sm" variant="outline" className="h-7" onClick={() => void contractsQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {filteredContracts.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No contracts match this filter.
                </p>
              ) : (
                filteredContracts.map((contract) => {
                  const checked = contractIds.includes(contract.id)
                  return (
                    <div
                      key={contract.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setContractIds((current) =>
                          current.includes(contract.id)
                            ? current.filter((id) => id !== contract.id)
                            : [...current, contract.id],
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setContractIds((current) =>
                            current.includes(contract.id)
                              ? current.filter((id) => id !== contract.id)
                              : [...current, contract.id],
                          )
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                        checked ? 'bg-primary-soft text-primary' : 'hover:bg-muted',
                      )}
                    >
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onChange={() =>
                            setContractIds((current) =>
                              current.includes(contract.id)
                                ? current.filter((id) => id !== contract.id)
                                : [...current, contract.id],
                            )
                          }
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{contract.title}</span>
                      <Badge variant="outline">{ACTIVATION_META[contract.activationMode].short}</Badge>
                      <span className="max-w-40 truncate text-[10px] text-muted-foreground">
                        {contract.folder || 'Uncategorized'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </details>

      {!canResolve ? null : resolveQuery.isPending ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : resolveQuery.isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-danger">
            <Icon name="alert" className="h-4 w-4" />
            {errorMessage(resolveQuery.error)}
          </div>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void resolveQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : preview ? (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryCard label="Included contracts" value={String(preview.included.length)} tone="primary" />
            <SummaryCard
              label="Total context"
              value={`${formatBytes(preview.totalBytes)}${maxBytes ? ` / ${formatBytes(maxBytes)}` : ''}`}
              tone={budgetExceeded ? 'danger' : 'info'}
            />
            <SummaryCard label="Skipped contracts" value={String(preview.skipped.length)} tone="outline" />
          </section>

          <section className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">Context budget</span>
              <span className="tabular text-[11px] text-muted-foreground">
                {formatBytes(totalBytes)}
                {maxBytes ? ` / ${formatBytes(maxBytes)}` : ' · no target limit declared'}
              </span>
              {budgetExceeded && maxBytes && (
                <Badge variant="danger">
                  Over budget by {formatBytes(Math.max(0, totalBytes - maxBytes))}
                </Badge>
              )}
            </div>
            {maxBytes ? (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    budgetExceeded ? 'bg-danger-solid' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(2, budgetPct)}%` }}
                />
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                This target declares no byte limit; the total is informational.
              </p>
            )}
            {budgetExceeded && (
              <p className="mt-2 text-[11px] leading-5 text-danger">
                The target does not truncate silently; reduce the selected contracts or split them into a
                path-scoped contract.
              </p>
            )}
          </section>

          {preview.warnings.length > 0 && (
            <section className="space-y-1.5 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">
                Warnings
              </div>
              {preview.warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 text-xs leading-5 text-warning">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {warning}
                </div>
              ))}
            </section>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Included in resolution order</h3>
                  <Badge variant="outline">{preview.included.length}</Badge>
                </div>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  Ordered by the target's priority semantics. Only automatically activated contracts are
                  counted; model and manual activations are explained under Skipped.
                </p>
              </div>
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto p-2.5">
                {preview.included.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No contracts enter the automatic context for this target and path.
                  </p>
                ) : (
                  preview.included.map((entry, index) => (
                    <div key={`${entry.contractId}-${index}`} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[10px] font-semibold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{entry.title}</span>
                            <Badge variant="outline" className="ml-auto shrink-0">
                              {ACTIVATION_META[entry.activationMode].short}
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                            {entry.reason}
                          </div>
                          <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                            {entry.sourcePath}
                          </code>
                        </div>
                        <span className="tabular shrink-0 text-[10px] text-muted-foreground">
                          {formatBytes(entry.bytes)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-border px-2.5 py-2">
                <div className="px-1 text-[11px] font-medium text-muted-foreground">
                  Not included ({preview.skipped.length})
                </div>
                <div className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                  {preview.skipped.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-muted-foreground">
                      Every eligible contract is included for this path.
                    </p>
                  ) : (
                    preview.skipped.map((entry, index) => (
                      <div
                        key={`${entry.contractId}-${entry.code}-${index}`}
                        className="rounded-md bg-muted/50 px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[11px] font-medium">{entry.title}</span>
                          <Badge variant="outline" className="ml-auto shrink-0">
                            {SKIP_CODE_LABEL[entry.code]}
                          </Badge>
                        </div>
                        <div className="text-[10px] leading-4 text-muted-foreground">{entry.reason}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
                <h3 className="text-sm font-semibold">Compiled target files</h3>
                <Badge variant="outline">{preview.compiledFilePaths.length} paths</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  onClick={compile}
                  disabled={compileMutation.isPending}
                >
                  {compileMutation.isPending ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <Icon name="play" className="h-3 w-3" />
                  )}
                  Compile preview
                </Button>
              </div>

              <div className="space-y-2 px-3 pt-2.5">
                {preview.compiledFilePaths.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                    No target files are expected for this path.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {preview.compiledFilePaths.map((path) => (
                      <code
                        key={path}
                        className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title={path}
                      >
                        {path}
                      </code>
                    ))}
                  </div>
                )}
                <p className="text-[10px] leading-4 text-muted-foreground">
                  The compile action returns the exact file contents for this target. It is read-only and
                  never writes to a target directory.
                </p>
              </div>

              {compileMutation.isError && (
                <div className="mx-3 mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  {errorMessage(compileMutation.error)}
                </div>
              )}

              {compileMutation.data && (
                <div className="mt-2 space-y-2 px-3 pb-3">
                  {compileMutation.data.warnings.length > 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2">
                      {compileMutation.data.warnings.map((warning) => (
                        <div key={warning} className="text-[11px] leading-5 text-warning">
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                  {compileMutation.data.files.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      The compiler returned no files. Adjust the selection or the sample path.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
                        {compileMutation.data.files.map((file) => (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => setActiveFilePath(file.path)}
                            className={cn(
                              'max-w-full cursor-pointer truncate rounded-md px-2 py-1 font-mono text-[10px]',
                              activeFile?.path === file.path
                                ? 'bg-primary-soft text-primary'
                                : 'bg-muted text-muted-foreground hover:text-foreground',
                            )}
                            title={file.path}
                          >
                            {file.path}
                          </button>
                        ))}
                      </div>
                      {activeFile && (
                        <div className="overflow-hidden rounded-lg border border-border">
                          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                            <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />
                            <code className="min-w-0 flex-1 truncate font-mono text-[10px]">
                              {activeFile.path}
                            </code>
                            <span className="tabular text-[10px] text-muted-foreground">
                              {formatBytes(activeFile.bytes)}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5"
                              onClick={() => {
                                void copyToClipboard(activeFile.content).then((ok) => {
                                  if (ok) toast.success('Copied the compiled file content')
                                  else toast.error('Copy failed. Check the clipboard permission for this window.')
                                })
                              }}
                              title="Copy file content"
                              aria-label="Copy file content"
                            >
                              <Icon name="copy" className="h-3 w-3" />
                            </Button>
                          </div>
                          <pre className="max-h-96 overflow-auto bg-muted/20 p-3 font-mono text-[11px] leading-5">
                            {activeFile.content}
                          </pre>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'primary' | 'info' | 'danger' | 'outline'
}) {
  const toneClass = {
    primary: 'text-primary bg-primary-soft',
    info: 'text-info bg-info-soft',
    danger: 'text-danger bg-danger-soft',
    outline: 'text-muted-foreground bg-muted',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className={cn('flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold', toneClass)}>
        {value}
      </span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}
