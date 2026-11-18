import { useMemo, useState } from 'react'
import type { AgentContract, ContractProjection, ContractTarget, ProjectionStatus } from '../../types'
import { Badge, Button, Select } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { useStore } from '../../store/store'
import { useToast } from '../ui/toast'
import { CONTRACT_TARGETS, TARGET_BY_ID } from '../../data/contractTargets'
import {
  PROJECTION_META,
  compileContractFile,
  contractTargetSupports,
  contractVersionLabel,
  projectionPath,
} from '../../lib/contracts'

interface ProjectionRow {
  contract: AgentContract | null
  target: ContractTarget
  projection?: ContractProjection
  status: ProjectionStatus
  supported: boolean
  orphan: boolean
  title: string
  path: string
}

export function ContractProjections() {
  const { state, deployContract, syncContractProjection } = useStore()
  const toast = useToast()
  const [targetFilter, setTargetFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectionStatus>('all')
  const [detailOf, setDetailOf] = useState<ProjectionRow | null>(null)
  const [confirmDrift, setConfirmDrift] = useState<ProjectionRow | null>(null)

  const rows = useMemo<ProjectionRow[]>(() => {
    const fromContracts = state.contracts.flatMap((contract) =>
      contract.targets.map((targetId) => {
        const target = TARGET_BY_ID[targetId]
        if (!target) return null
        const projection = state.contractProjections.find(
          (p) => p.contractId === contract.id && p.targetId === targetId,
        )
        return {
          contract,
          target,
          projection,
          status: projection?.status ?? ('missing' as const),
          supported: contractTargetSupports(contract, target),
          orphan: false,
          title: contract.title,
          path: projectionPath(contract, targetId),
        } as ProjectionRow
      }),
    )
    const known = new Set(state.contracts.map((c) => c.id))
    const orphans = state.contractProjections
      .filter((p) => !known.has(p.contractId))
      .map((p) => {
        const target = TARGET_BY_ID[p.targetId]
        if (!target) return null
        return {
          contract: null,
          target,
          projection: p,
          status: p.status,
          supported: true,
          orphan: true,
          title: p.contractTitle ?? 'Deleted contract',
          path:
            target.merge === 'single-file'
              ? target.pathTemplate
              : target.pathTemplate.replace('{slug}', p.contractSlug ?? p.contractId),
        } as ProjectionRow
      })
    return [...fromContracts, ...orphans].filter((r): r is ProjectionRow => !!r)
  }, [state.contracts, state.contractProjections])

  const filtered = rows.filter((row) => {
    if (targetFilter !== 'all' && row.target.id !== targetFilter) return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    return true
  })

  const supportedRows = rows.filter((r) => r.supported)
  const counts = {
    synced: supportedRows.filter((r) => r.status === 'synced').length,
    stale: supportedRows.filter((r) => r.status === 'stale').length,
    drifted: supportedRows.filter((r) => r.status === 'drifted').length,
    missing: supportedRows.filter((r) => r.status === 'missing').length,
  }

  const project = (row: ProjectionRow) => {
    if (!row.contract || !row.supported) return
    if (row.projection) {
      syncContractProjection(row.projection.id)
      toast.success(`Reprojected "${row.contract.title}" → ${row.target.label}`)
    } else {
      deployContract(row.contract.id, row.target.id)
      toast.success(`Projected "${row.contract.title}" → ${row.target.label}`)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Projection is a <b>one-way write</b>: local contract → native file of the target tool. Single-file targets (AGENTS.md / CLAUDE.md / copilot-instructions)
            merge multiple contracts using managed block markers; when a target file is edited by hand it is marked as <b>drifted</b> and never overwritten automatically.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-56 text-xs" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
            <option value="all">All target formats</option>
            {CONTRACT_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · {t.agentName}
              </option>
            ))}
          </Select>
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {(
              [
                { v: 'all', label: 'All' },
                { v: 'synced', label: `Projected ${counts.synced}` },
                { v: 'stale', label: `Stale ${counts.stale}` },
                { v: 'drifted', label: `Drifted ${counts.drifted}` },
                { v: 'missing', label: `Not projected ${counts.missing}` },
              ] as const
            ).map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setStatusFilter(t.v)}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium',
                  statusFilter === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Drifted items must be overwritten one by one and are excluded from bulk actions
          </span>
        </div>

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
              {filtered.map((row) => {
                const meta = PROJECTION_META[row.status]
                return (
                  <tr
                    key={`${row.contract?.id ?? row.projection?.contractId ?? row.title}-${row.target.id}`}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon name="file" className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{row.title}</span>
                            {row.orphan && <Badge variant="warning">Deleted</Badge>}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {row.contract
                              ? `${contractVersionLabel(row.contract)} · Priority ${row.contract.priority}`
                              : 'Can only be cleaned up or rolled back; cannot be regenerated'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{row.target.label}</div>
                      <div className="text-[10px] text-muted-foreground">{row.target.agentName}</div>
                    </td>
                    <td className="max-w-64 px-3 py-2">
                      <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {row.path}
                      </code>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {row.target.merge === 'single-file' ? 'Merged with other contracts' : 'Separate file'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.supported ? (
                        <Badge variant={meta.variant}>
                          <Icon name={meta.icon} className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      ) : (
                        <div>
                          <Badge variant="outline">Unsupported</Badge>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">Incompatible activation</div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {row.projection ? (
                        <>
                          <div>{row.projection.deployedVersion}</div>
                          <div>{relativeTime(row.projection.deployedAt)}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={() => setDetailOf(row)}>
                          Details
                        </Button>
                        {!row.orphan && !row.supported && (
                          <Button size="sm" variant="outline" disabled title="Target does not support this activation; skipped on projection">
                            Incompatible
                          </Button>
                        )}
                        {!row.orphan && row.supported && (
                          <Button
                            size="sm"
                            variant={row.status === 'drifted' ? 'danger' : 'default'}
                            onClick={() => (row.status === 'drifted' ? setConfirmDrift(row) : project(row))}
                          >
                            {row.status === 'missing'
                              ? 'Project'
                              : row.status === 'drifted'
                                ? 'Overwrite'
                                : 'Reproject'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
            No projection records match the current filters. Adjust the filters, or first assign projection targets to contracts in the contract library.
          </p>
        )}
      </div>

      {detailOf && <ProjectionModal row={detailOf} onClose={() => setDetailOf(null)} />}

      <ConfirmDialog
        open={!!confirmDrift}
        onClose={() => setConfirmDrift(null)}
        onConfirm={() => {
          if (confirmDrift) project(confirmDrift)
        }}
        title="Overwrite manual edits on the Agent side?"
        confirmText="Overwrite and project"
        message={
          <>
            Target file "<b className="text-foreground">{confirmDrift?.path ?? ''}</b>"
            was edited by hand on the Agent side. Reprojecting rewrites the matching managed block from the local contract, overwriting those edits.
            {confirmDrift?.target.merge === 'single-file' && ' This file also contains merged content from other contracts.'}
          </>
        }
      />
    </div>
  )
}

function ProjectionModal({ row, onClose }: { row: ProjectionRow; onClose: () => void }) {
  const { state, deployContract, syncContractProjection, removeContractProjection, rollbackContractProjection } =
    useStore()
  const toast = useToast()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const projection = state.contractProjections.find(
    (p) =>
      p.contractId === (row.contract?.id ?? row.projection?.contractId) &&
      p.targetId === row.target.id,
  )
  const status = projection?.status ?? 'missing'
  const meta = PROJECTION_META[status]
  const mergedCount = state.contracts.filter((c) => c.targets.includes(row.target.id)).length
  const path = row.path

  const content = !row.contract
    ? '<!-- Original contract deleted: content cannot be regenerated. Its managed block may remain in the target file; remove the projection or clean it up manually. -->'
    : row.target.merge === 'single-file'
      ? [
          '<!-- Generated by Prompt Keeper. Source of truth: instructions/*.contract.md. -->',
          `<!-- pk:begin ${row.contract.id} -->`,
          `## ${row.contract.title}`,
          '',
          row.contract.body.trim(),
          `<!-- pk:end ${row.contract.id} -->`,
        ].join('\n')
      : compileContractFile(row.target, row.contract)

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width="max-w-2xl"
        title={`${row.title} → ${row.target.label}`}
        subtitle={`${row.target.agentName} · Projection is a one-way write; the local library and repo are unchanged`}
        footer={
          <>
            {projection && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" className="h-3.5 w-3.5" />
                Remove projection
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {row.contract && row.supported && (
              <Button
                variant={status === 'drifted' ? 'danger' : 'default'}
                onClick={() => {
                  if (projection) {
                    syncContractProjection(projection.id)
                    toast.success(`Reprojected "${row.title}" → ${row.target.label}`)
                  } else {
                    deployContract(row.contract!.id, row.target.id)
                    toast.success(`Projected "${row.title}" → ${row.target.label}`)
                  }
                }}
              >
                <Icon name="send" />
                {status === 'missing' ? 'Project to this target' : 'Reproject'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {row.supported ? (
              <Badge variant={meta.variant}>
                <Icon name={meta.icon} className="h-3 w-3" />
                {meta.label}
              </Badge>
            ) : (
              <Badge variant="outline">Activation not supported</Badge>
            )}
            {row.orphan && <Badge variant="warning">Local contract deleted</Badge>}
            <span className="text-xs text-muted-foreground">
              {projection
                ? `Current ${projection.deployedVersion} · Deployed ${formatDate(projection.deployedAt ?? '')}`
                : 'This contract has not been written to this target yet'}
            </span>
          </div>

          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Target path</div>
            <div className="mt-0.5 break-all font-mono text-xs">{path}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {row.target.merge === 'single-file'
                ? `This file merges ${mergedCount} contracts; reprojecting rewrites the whole managed block region.`
                : 'One file per contract; reprojecting only affects this file.'}
            </div>
          </div>

          {row.orphan && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The local contract has been deleted, so projection content cannot be regenerated. You can still remove this projection record or roll back to the previous version.
            </div>
          )}

          {!row.supported && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {row.target.label} does not support this contract's activation, so it is skipped on projection; choose another target or change the activation.
            </div>
          )}

          {status === 'drifted' && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {projection?.note ?? 'The target file was edited by hand. Reprojecting overwrites those edits; review the content first.'}
            </div>
          )}

          {projection?.note && status !== 'drifted' && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {projection.note}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Content preview
              <Badge variant="outline">{row.target.merge === 'single-file' ? 'Single contract block' : 'Full file'}</Badge>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[11px] leading-5">
              {content}
            </pre>
          </div>

          {projection && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="text-[11px] text-muted-foreground">
                Last updated {relativeTime(projection.deployedAt)}
              </span>
              {projection.previousVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    rollbackContractProjection(projection.id)
                    toast.warning(`Rolled back to ${projection.previousVersion}; local library and repo unchanged`)
                  }}
                >
                  <Icon name="undo" className="h-3.5 w-3.5" />
                  Roll back to {projection.previousVersion}
                </Button>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (projection) {
            removeContractProjection(projection.id)
            toast.success(`Removed "${row.title}" projection from ${row.target.label}`)
          }
          onClose()
        }}
        title="Remove this projection?"
        confirmText="Remove"
        message={
          <>
            Removes this contract from the managed block in "<b className="text-foreground">{path}</b>" (simulated in this prototype).
            The local contract library and Git repo are unaffected.
            {row.target.merge === 'single-file' && ` The other ${mergedCount - 1} contracts in the same file are unchanged.`}
          </>
        }
      />
    </>
  )
}
