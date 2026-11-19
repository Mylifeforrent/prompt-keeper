import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DispatchAgent,
  DispatchCell,
  DispatchDetail,
  DispatchPreview,
  DispatchStatus,
  InstallMode,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner, Switch } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorDetails, errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  DISPATCH_META,
  KIND_META,
  RISK_META,
  errorDetailLines,
} from '../../lib/syncView'

const CELL_TONE: Record<DispatchStatus, string> = {
  synced: 'border-success/30 bg-success-soft text-success',
  stale: 'border-warning/30 bg-warning-soft text-warning',
  drifted: 'border-danger/30 bg-danger-soft text-danger',
  missing: 'border-dashed border-border text-muted-foreground hover:bg-muted',
  unsupported: 'border-border bg-muted text-muted-foreground',
}

function cellFor(row: DispatchDetail | null, agentId: string): DispatchCell | undefined {
  return row?.cells.find((cell) => cell.agentId === agentId)
}

export function SyncDeploy() {
  const toast = useToast()
  const [kindFilter, setKindFilter] = useState<'all' | 'skill' | 'mcp'>('all')
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)
  const [includeUndetected, setIncludeUndetected] = useState(false)
  const [folder, setFolder] = useState('')
  const [debouncedFolder, setDebouncedFolder] = useState('')
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFolder(folder), 250)
    return () => clearTimeout(timer)
  }, [folder])

  const query = useMemo(
    () => ({
      ...(kindFilter === 'all' ? {} : { kinds: [kindFilter] }),
      ...(includeUndetected ? { includeUndetected: true } : {}),
      ...(onlyAnomalies ? { onlyAnomalies: true } : {}),
      ...(debouncedFolder.trim() ? { folder: debouncedFolder.trim() } : {}),
    }),
    [debouncedFolder, includeUndetected, kindFilter, onlyAnomalies],
  )

  const matrix = useQuery({
    queryKey: queryKeys.dispatch.matrix(query),
    queryFn: () => ipc.dispatch.matrix(query),
  })

  const syncStale = useMutation({
    mutationFn: () => ipc.dispatch.syncStale({}),
    onSuccess: () => {
      toast.success(
        driftedSkills > 0
          ? `Sync started. ${driftedSkills} drifted Skill cell${driftedSkills === 1 ? '' : 's'} will be skipped and never overwritten.`
          : 'Sync started. No drifted Skill cells were found.',
      )
    },
    onError: (error) => toast.error(`Stale sync did not start: ${errorMessage(error)}`),
  })

  const agents = matrix.data?.agents ?? []
  const rows = matrix.data?.rows ?? []
  const summary = matrix.data?.summary
  const detectedCount = agents.filter((agent) => agent.detected).length
  const hasFilters = kindFilter !== 'all' || onlyAnomalies || debouncedFolder.trim().length > 0
  // Bulk stale sync is a Skill-only channel; MCP is applied from the MCP workspace.
  const staleSkills = rows
    .filter((row) => row.kind === 'skill')
    .reduce((sum, row) => sum + row.cells.filter((cell) => cell.status === 'stale').length, 0)
  const driftedSkills = rows
    .filter((row) => row.kind === 'skill')
    .reduce((sum, row) => sum + row.cells.filter((cell) => cell.status === 'drifted').length, 0)

  function clearFilters(): void {
    setKindFilter('all')
    setOnlyAnomalies(false)
    setFolder('')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Dispatch is one-way: local library → each Agent directory. It never writes back to the repository. Files
          edited by hand inside an Agent are marked <b>Drifted</b> and are never overwritten by batch sync. Prompts and
          instructions do not appear here; Prompts only sync with Git, and instructions use projection.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { value: 'all', label: 'All' },
              { value: 'skill', label: 'Skills' },
              { value: 'mcp', label: 'MCP' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKindFilter(option.value)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium',
                kindFilter === option.value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Input
          aria-label="Filter by folder"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="Folder"
          className="h-8 w-36 text-xs"
        />
        <Checkbox
          checked={onlyAnomalies}
          onChange={setOnlyAnomalies}
          label={<span className="text-xs">Only anomalies</span>}
        />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={includeUndetected} onChange={setIncludeUndetected} label="Show undetected Agents" />
          Show undetected Agents
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Detected {detectedCount} · Stale {summary?.stale ?? 0} · Drifted {summary?.drifted ?? 0}
        </span>
        <Button size="sm" variant="outline" onClick={() => void matrix.refetch()} disabled={matrix.isFetching}>
          {matrix.isFetching ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
          Re-check
        </Button>
        <Button
          size="sm"
          onClick={() => syncStale.mutate()}
          disabled={staleSkills === 0 || syncStale.isPending}
        >
          {syncStale.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
          Sync all stale Skills ({staleSkills})
        </Button>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
          <span className="mr-1 text-muted-foreground">Cells:</span>
          <Badge variant="success">Synced {summary.synced}</Badge>
          <Badge variant="warning">Stale {summary.stale}</Badge>
          <Badge variant="danger">Drifted {summary.drifted}</Badge>
          <Badge variant="outline">Missing {summary.missing}</Badge>
          <Badge variant="secondary">Unsupported {summary.unsupported}</Badge>
        </div>
      )}

      {matrix.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Computing the dispatch matrix…
        </div>
      ) : matrix.isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-6 text-center text-xs text-danger">
          <p className="font-medium">{errorMessage(matrix.error)}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void matrix.refetch()}>
            Retry
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name="grid" className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">No Local Agents detected</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
            Detection looks for each tool's default directories and configuration files. Prompt Keeper never creates
            empty directories for tools that are not installed. Install an Agent or point it at its default location,
            then re-check detection. You can also show known but undetected targets.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void matrix.refetch()} disabled={matrix.isFetching}>
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Re-check detection
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIncludeUndetected(true)}>
              Show undetected Agents
            </Button>
          </div>
        </div>
      ) : (
        <>
          {detectedCount === 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No installed Agent was detected. The matrix shows known targets with undetected columns; writes go only
                to targets you explicitly dispatch. Re-check after installing an Agent.
              </span>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
              <Icon name="filter" className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">
                {hasFilters ? 'No assets match these filters' : 'No Skills or MCP servers to dispatch'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasFilters
                  ? 'Relax the asset type, folder, or anomaly filter.'
                  : 'Create a Skill or MCP server in its workspace, then return here to dispatch it.'}
              </p>
              {hasFilters && (
                <Button className="mt-4" size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-max border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="sticky left-0 z-10 min-w-[220px] bg-card px-3 py-2.5 text-xs font-medium">
                      Asset
                    </th>
                    {agents.map((agent) => (
                      <th key={agent.id} className="min-w-[124px] px-2 py-2.5 align-top text-xs font-medium">
                        <div className="flex items-center gap-1">
                          {agent.name}
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              agent.detected ? 'bg-success' : 'bg-border-strong',
                            )}
                            title={agent.detected ? 'Detected on this machine' : 'Not detected'}
                          />
                        </div>
                        <div className="mt-0.5 max-w-[112px] truncate font-mono text-[9px] font-normal text-muted-foreground">
                          {agent.skillDir ?? agent.mcpFile ?? 'No path'}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.kind}-${row.assetId}`}
                      onClick={() => setDetailAssetId(row.assetId)}
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/20"
                    >
                      <td className="sticky left-0 z-10 bg-card px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setDetailAssetId(row.assetId)}
                          className="flex w-full cursor-pointer items-center gap-2 text-left"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Icon name={KIND_META[row.kind].icon} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium">{row.title}</span>
                              <span className="text-[10px] text-muted-foreground">v{row.currentVersion}</span>
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {row.folder || 'Unfiled'}
                            </span>
                          </span>
                        </button>
                      </td>
                      {agents.map((agent) => {
                        const supported =
                          row.kind === 'skill' ? agent.supportsSkills : agent.supportsMcp
                        const cell = row.cells.find((entry) => entry.agentId === agent.id)
                        // With onlyAnomalies the backend omits synced cells; an absent cell is synced.
                        const status: DispatchStatus = supported
                          ? (cell?.status ?? (onlyAnomalies ? 'synced' : 'missing'))
                          : 'unsupported'
                        const meta = DISPATCH_META[status]
                        if (!supported) {
                          return (
                            <td key={agent.id} className="px-2 py-2">
                              <span className="text-[10px] text-muted-foreground">Unsupported</span>
                            </td>
                          )
                        }
                        return (
                          <td key={agent.id} className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setDetailAssetId(row.assetId)}
                              title={cell?.note ?? meta.label}
                              className={cn(
                                'inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors',
                                CELL_TONE[status],
                              )}
                            >
                              <Icon name={meta.icon} className="h-3 w-3" />
                              {meta.label}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        Symlink is the default install mode so library edits take effect immediately. If the filesystem does not support
        it, the item fails visibly and copy mode can be chosen; there is no silent fallback. Bulk stale sync covers
        Skills only and never overwrites drifted cells. MCP servers are applied from the MCP workspace with a redacted
        preview, not from this matrix.
      </p>

      <DispatchDetailModal
        assetId={detailAssetId}
        agents={agents}
        onClose={() => setDetailAssetId(null)}
      />
    </div>
  )
}

function DispatchDetailModal({
  assetId,
  agents,
  onClose,
}: {
  assetId: string | null
  agents: DispatchAgent[]
  onClose: () => void
}) {
  const toast = useToast()
  const detailQuery = useQuery({
    queryKey: queryKeys.dispatch.detail(assetId ?? ''),
    queryFn: () => ipc.dispatch.detail({ assetId: assetId ?? '' }),
    enabled: !!assetId,
  })
  const detail = detailQuery.data

  const [actionAgent, setActionAgent] = useState<string | null>(null)
  const [mode, setMode] = useState<InstallMode>('symlink')
  const [preview, setPreview] = useState<DispatchPreview | null>(null)
  const [confirmExternal, setConfirmExternal] = useState(false)
  const [scriptAck, setScriptAck] = useState(false)
  const [removeAgent, setRemoveAgent] = useState<string | null>(null)
  const [rollbackAgent, setRollbackAgent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])

  useEffect(() => {
    setActionAgent(null)
    setPreview(null)
    setConfirmExternal(false)
    setScriptAck(false)
    setRemoveAgent(null)
    setRollbackAgent(null)
    setError(null)
    setDetails([])
  }, [assetId])

  const installPreview = useMutation({
    mutationFn: (input: { agentId: string; installMode: InstallMode }) =>
      ipc.dispatch.install({
        assetId: assetId ?? '',
        agentIds: [input.agentId],
        mode: input.installMode,
        confirm: false,
      }),
  })
  const installApply = useMutation({
    mutationFn: (input: {
      agentId: string
      installMode: InstallMode
      previewToken: string
      confirmOverwriteExternal: boolean
      acknowledgeScripts: boolean
    }) =>
      ipc.dispatch.install({
        assetId: assetId ?? '',
        agentIds: [input.agentId],
        mode: input.installMode,
        confirm: true,
        previewToken: input.previewToken,
        ...(input.confirmOverwriteExternal ? { confirmOverwriteExternal: true } : {}),
        ...(input.acknowledgeScripts ? { acknowledgeScripts: true } : {}),
      }),
  })
  const remove = useMutation({
    mutationFn: (agentId: string) =>
      ipc.dispatch.remove({ assetId: assetId ?? '', agentIds: [agentId], confirm: true }),
    onSuccess: () => toast.info('Remove dispatch started. The operation panel shows progress.'),
    onError: (error) => toast.error(`Dispatch was not removed: ${errorMessage(error)}`),
  })
  const rollback = useMutation({
    mutationFn: (agentId: string) =>
      ipc.dispatch.rollback({ assetId: assetId ?? '', agentIds: [agentId] }),
    onSuccess: () => toast.info('Rollback started. Only the Agent directory is rewritten.'),
    onError: (error) => toast.error(`Rollback did not start: ${errorMessage(error)}`),
  })

  function agentName(agentId: string): string {
    return agents.find((agent) => agent.id === agentId)?.name ?? agentId
  }

  function beginAction(agentId: string, cell: DispatchCell | undefined): void {
    setActionAgent(agentId)
    setMode(cell?.mode ?? 'symlink')
    setPreview(null)
    setConfirmExternal(false)
    setScriptAck(false)
    setError(null)
    setDetails([])
  }

  async function prepare(agentId: string): Promise<void> {
    setError(null)
    setDetails([])
    try {
      const result = await installPreview.mutateAsync({ agentId, installMode: mode })
      if (result.phase === 'preview') {
        setPreview(result)
        setConfirmExternal(false)
        setScriptAck(false)
      } else {
        setError('The dispatch preview did not return. Refresh the detail and try again.')
      }
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  async function apply(agentId: string): Promise<void> {
    if (!preview) return
    setError(null)
    setDetails([])
    try {
      await installApply.mutateAsync({
        agentId,
        installMode: mode,
        previewToken: preview.previewToken,
        confirmOverwriteExternal: confirmExternal,
        acknowledgeScripts: scriptAck,
      })
      toast.info('Dispatch started. The operation panel shows progress.')
      setPreview(null)
      setActionAgent(null)
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  const risk = preview?.risk ?? []
  const needsExternalConfirm = !!preview?.targets.some((target) => target.conflict === 'external')
  const needsScriptAck = risk.includes('scripts')
  const canApply =
    !!preview && (!needsExternalConfirm || confirmExternal) && (!needsScriptAck || scriptAck)
  const visibleAgentIds = new Set(agents.map((agent) => agent.id))
  const visibleCells = detail ? detail.cells.filter((cell) => visibleAgentIds.has(cell.agentId)) : []
  const visibleHistory = detail
    ? detail.history.filter((entry) => visibleAgentIds.has(entry.agentId))
    : []

  return (
    <>
      <Modal
        open={!!assetId}
        onClose={onClose}
        width="max-w-3xl"
        title={detail ? `${detail.title} · dispatch detail` : 'Dispatch detail'}
        subtitle={
          detail
            ? `${KIND_META[detail.kind].label} · v${detail.currentVersion} · ${visibleCells.length} target${visibleCells.length === 1 ? '' : 's'}`
            : undefined
        }
        footer={<Button variant="outline" onClick={onClose}>Close</Button>}
      >
        {detailQuery.isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Loading dispatch detail…
          </div>
        )}

        {detailQuery.isError && (
          <div className="space-y-3">
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <p className="font-medium">{errorMessage(detailQuery.error)}</p>
              {errorDetailLines(errorDetails(detailQuery.error)).map((line) => (
                <p key={line} className="mt-1 leading-5">
                  {line}
                </p>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => void detailQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {detail && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Dispatch writes only to this Agent directory. The local library and repository are never modified.
                Drifted content is never overwritten by batch operations.
              </span>
            </div>

            {detail.kind === 'mcp' && (
              <div className="rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-info">
                MCP servers are applied and removed from the MCP workspace, which shows a preview with env and headers
                redacted. This matrix is read-only for MCP: no action here avoids bypassing that preview.              </div>
            )}

            {visibleCells.map((cell) => {
              const meta = DISPATCH_META[cell.status]
              const name = agentName(cell.agentId)
              const canRollback = detail.kind === 'skill' && !!cell.deploymentId
              return (
                <div key={cell.agentId} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    <Badge variant={meta.tone}>
                      <Icon name={meta.icon} className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    {cell.mode && <Badge variant="outline">{cell.mode}</Badge>}
                    {cell.deployedVersion !== undefined && (
                      <span className="text-[11px] text-muted-foreground">
                        Deployed v{cell.deployedVersion}
                        {cell.deployedAt ? ` · ${relativeTime(cell.deployedAt)}` : ''}
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {detail.kind === 'skill' && cell.status !== 'unsupported' && (
                        <Button size="sm" variant="outline" onClick={() => beginAction(cell.agentId, cell)}>
                          <Icon name="send" className="h-3.5 w-3.5" />
                          {cell.deploymentId ? 'Re-sync' : 'Dispatch'}
                        </Button>
                      )}
                      {detail.kind === 'skill' && cell.deploymentId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={() => setRemoveAgent(cell.agentId)}
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )}
                      {canRollback && (
                        <Button size="sm" variant="ghost" onClick={() => setRollbackAgent(cell.agentId)}>
                          <Icon name="undo" className="h-3.5 w-3.5" />
                          Roll back
                        </Button>
                      )}
                    </span>
                  </div>

                  {cell.targetPath && (
                    <div className="mt-1.5 break-all font-mono text-[11px] text-muted-foreground">
                      {cell.targetPath}
                    </div>
                  )}
                  {cell.note && <p className="mt-1 text-[11px] leading-5 text-warning">{cell.note}</p>}

                  {detail.kind === 'mcp' && (
                    <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                      To change this MCP target, open MCP → Apply to Agents. The MCP workspace confirms each config
                      file and never displays stored secrets.
                    </p>
                  )}

                  {actionAgent === cell.agentId && detail.kind === 'skill' && (
                    <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">Install mode</span>
                        <Select
                          aria-label="Install mode"
                          className="h-8 w-32 text-xs"
                          value={mode}
                          onChange={(event) => {
                            setMode(event.target.value as InstallMode)
                            setPreview(null)
                          }}
                        >
                          <option value="symlink">symlink</option>
                          <option value="copy">copy</option>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void prepare(cell.agentId)}
                          disabled={installPreview.isPending}
                        >
                          {installPreview.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="eye" className="h-3.5 w-3.5" />}
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setActionAgent(null)}
                        >
                          Cancel
                        </Button>
                      </div>

                      {error && (
                        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
                          <p className="font-medium">{error}</p>
                          {details.length > 0 && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                              {details.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          )}
                          {error.toLowerCase().includes('symlink') && (
                            <p className="mt-1 leading-5">
                              Choose copy mode and preview again. There is no silent fallback.
                            </p>
                          )}
                        </div>
                      )}

                      {preview && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {risk.length === 0 ? (
                              <Badge variant="outline">No risk markers</Badge>
                            ) : (
                              risk.map((entry) => (
                                <Badge key={entry} variant={RISK_META[entry].tone}>
                                  <Icon name={RISK_META[entry].icon} className="h-3 w-3" />
                                  {RISK_META[entry].label}
                                </Badge>
                              ))
                            )}
                          </div>

                          {preview.targets.map((target) => (
                            <div key={target.agentId} className="rounded-lg border border-border bg-card p-2.5 text-[11px]">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{target.agentName}</span>
                                <Badge variant={target.action === 'noop' ? 'secondary' : 'info'}>
                                  {target.action}
                                </Badge>
                                {target.conflict !== 'none' && (
                                  <Badge variant={target.conflict === 'drifted' ? 'danger' : 'warning'}>
                                    {target.conflict} conflict
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-1 break-all font-mono text-[10.5px] text-muted-foreground">
                                {target.targetPath}
                              </div>
                              {target.files.length > 0 && (
                                <div className="mt-1 text-[10.5px] text-muted-foreground">
                                  {target.files.length} file{target.files.length === 1 ? '' : 's'}:{' '}
                                  {target.files.slice(0, 4).map((file) => file.path).join(', ')}
                                  {target.files.length > 4 ? '…' : ''}
                                </div>
                              )}
                              {target.warnings.map((warning) => (
                                <p key={warning} className="mt-1 leading-5 text-warning">
                                  {warning}
                                </p>
                              ))}
                            </div>
                          ))}

                          {needsExternalConfirm && (
                            <Checkbox
                              checked={confirmExternal}
                              onChange={setConfirmExternal}
                              label={
                                <span className="text-[11px] leading-5">
                                  I understand this replaces an existing directory that Prompt Keeper does not manage.
                                </span>
                              }
                            />
                          )}
                          {needsScriptAck && (
                            <Checkbox
                              checked={scriptAck}
                              onChange={setScriptAck}
                              label={
                                <span className="text-[11px] leading-5">
                                  I have reviewed the script files and understand they may run on this machine.
                                </span>
                              }
                            />
                          )}

                          <Button
                            size="sm"
                            onClick={() => void apply(cell.agentId)}
                            disabled={!canApply || installApply.isPending}
                          >
                            {installApply.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" className="h-3.5 w-3.5" />}
                            Apply dispatch
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <Icon name="history" className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Deployment history</h3>
                <Badge variant="outline">{visibleHistory.length}</Badge>
              </div>
              {visibleHistory.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">No deployment records for this asset yet.</p>
              ) : (
                <div className="mt-2 divide-y divide-border/60">
                  {visibleHistory.map((entry) => (
                    <div key={entry.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[11px]">
                      <span className="w-28 shrink-0 font-medium">{agentName(entry.agentId)}</span>
                      <Badge variant={DISPATCH_META[entry.status].tone}>{DISPATCH_META[entry.status].label}</Badge>
                      <span className="text-muted-foreground">
                        v{entry.deployedVersion} · {entry.mode} · {formatDate(entry.deployedAt)}
                      </span>
                      <code className="ml-auto max-w-[45%] truncate font-mono text-[10px] text-muted-foreground">
                        {entry.targetPath}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removeAgent}
        onClose={() => setRemoveAgent(null)}
        onConfirm={() => {
          if (removeAgent) remove.mutate(removeAgent)
        }}
        title="Remove dispatch?"
        confirmText="Remove"
        message={
          removeAgent ? (
            <div className="space-y-2">
              <p>
                This removes app-managed content for{' '}
                <span className="font-medium text-foreground">{detail?.title ?? 'this asset'}</span> from{' '}
                <span className="font-medium text-foreground">{agentName(removeAgent)}</span>.
              </p>
              <p className="break-all font-mono text-[11px]">{cellFor(detail ?? null, removeAgent)?.targetPath}</p>
              <p>The local library and repository are unaffected.</p>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!rollbackAgent}
        onClose={() => setRollbackAgent(null)}
        onConfirm={() => {
          if (rollbackAgent) rollback.mutate(rollbackAgent)
        }}
        title="Roll back dispatch?"
        confirmText="Roll back"
        danger={false}
        message={
          rollbackAgent ? (
            <div className="space-y-2">
              <p>
                This restores the previous deployed version of{' '}
                <span className="font-medium text-foreground">{detail?.title ?? 'this asset'}</span> for{' '}
                <span className="font-medium text-foreground">{agentName(rollbackAgent)}</span>.
              </p>
              <p>
                Only the Agent directory is rolled back. The local library and repository are not changed.
              </p>
            </div>
          ) : null
        }
      />
    </>
  )
}
