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
          title: p.contractTitle ?? '已删除的契约',
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
      toast.success(`已重新投影「${row.contract.title}」→ ${row.target.label}`)
    } else {
      deployContract(row.contract.id, row.target.id)
      toast.success(`已投影「${row.contract.title}」→ ${row.target.label}`)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            投影是<b>单向写出</b>：本地契约 → 目标工具的原生文件。单文件目标（AGENTS.md / CLAUDE.md / copilot-instructions）
            由多条契约合并写入，使用 managed block 标记；目标文件被手工修改时标记为<b>漂移</b>，不会自动覆盖。
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-56 text-xs" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
            <option value="all">全部目标格式</option>
            {CONTRACT_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · {t.agentName}
              </option>
            ))}
          </Select>
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            {(
              [
                { v: 'all', label: '全部' },
                { v: 'synced', label: `已投影 ${counts.synced}` },
                { v: 'stale', label: `待更新 ${counts.stale}` },
                { v: 'drifted', label: `漂移 ${counts.drifted}` },
                { v: 'missing', label: `未投影 ${counts.missing}` },
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
            漂移项只能逐条覆盖，不参与批量操作
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">契约</th>
                <th className="px-3 py-2.5 font-medium">目标</th>
                <th className="px-3 py-2.5 font-medium">写入路径</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium">版本 / 时间</th>
                <th className="px-3 py-2.5 font-medium">操作</th>
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
                            {row.orphan && <Badge variant="warning">已删除</Badge>}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {row.contract
                              ? `${contractVersionLabel(row.contract)} · 优先级 ${row.contract.priority}`
                              : '只能清理或回滚，不能重新生成'}
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
                        {row.target.merge === 'single-file' ? '与其他契约合并' : '独立文件'}
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
                          <Badge variant="outline">不支持</Badge>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">激活方式不兼容</div>
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
                          详情
                        </Button>
                        {!row.orphan && !row.supported && (
                          <Button size="sm" variant="outline" disabled title="目标不支持该激活方式，投影时会跳过">
                            不兼容
                          </Button>
                        )}
                        {!row.orphan && row.supported && (
                          <Button
                            size="sm"
                            variant={row.status === 'drifted' ? 'danger' : 'default'}
                            onClick={() => (row.status === 'drifted' ? setConfirmDrift(row) : project(row))}
                          >
                            {row.status === 'missing'
                              ? '投影'
                              : row.status === 'drifted'
                                ? '覆盖投影'
                                : '重新投影'}
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
            当前筛选下没有投影记录。调整筛选，或先在契约库为目标选择投影目标。
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
        title="覆盖 Agent 侧的手工修改？"
        confirmText="覆盖并投影"
        message={
          <>
            目标文件「<b className="text-foreground">{confirmDrift?.path ?? ''}</b>」
            在 Agent 侧被手工修改过。重新投影会用本地契约重写对应 managed block，手工修改将被覆盖。
            {confirmDrift?.target.merge === 'single-file' && ' 该文件还包含其他契约的合并内容。'}
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
    ? '<!-- 原契约已删除：无法重新生成内容。目标文件中可能仍保留该契约的 managed block，请移除投影或手动清理。 -->'
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
        subtitle={`${row.target.agentName} · 投影是单向写出，不修改本地库与仓库`}
        footer={
          <>
            {projection && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" className="h-3.5 w-3.5" />
                移除投影
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            {row.contract && row.supported && (
              <Button
                variant={status === 'drifted' ? 'danger' : 'default'}
                onClick={() => {
                  if (projection) {
                    syncContractProjection(projection.id)
                    toast.success(`已重新投影「${row.title}」→ ${row.target.label}`)
                  } else {
                    deployContract(row.contract!.id, row.target.id)
                    toast.success(`已投影「${row.title}」→ ${row.target.label}`)
                  }
                }}
              >
                <Icon name="send" />
                {status === 'missing' ? '投影到此目标' : '重新投影'}
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
              <Badge variant="outline">不支持该激活方式</Badge>
            )}
            {row.orphan && <Badge variant="warning">本地契约已删除</Badge>}
            <span className="text-xs text-muted-foreground">
              {projection
                ? `当前 ${projection.deployedVersion} · 部署于 ${formatDate(projection.deployedAt ?? '')}`
                : '该目标还没有写入此契约'}
            </span>
          </div>

          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">目标路径</div>
            <div className="mt-0.5 break-all font-mono text-xs">{path}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {row.target.merge === 'single-file'
                ? `该文件由 ${mergedCount} 条契约合并写入；重新投影会重写整个 managed block 区域。`
                : '一契约一文件；重新投影只影响该文件。'}
            </div>
          </div>

          {row.orphan && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              本地契约已删除，无法重新生成投影内容。你仍可以移除这条投影记录，或回滚到上一版本。
            </div>
          )}

          {!row.supported && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              当前契约的激活方式不被 {row.target.label} 支持，投影时会跳过；请改用其他目标或调整激活方式。
            </div>
          )}

          {status === 'drifted' && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {projection?.note ?? '检测到目标文件被手工修改。重新投影会覆盖该修改；请先确认内容。'}
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
              写入内容预览
              <Badge variant="outline">{row.target.merge === 'single-file' ? '单条契约片段' : '完整文件'}</Badge>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[11px] leading-5">
              {content}
            </pre>
          </div>

          {projection && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="text-[11px] text-muted-foreground">
                最近更新 {relativeTime(projection.deployedAt)}
              </span>
              {projection.previousVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    rollbackContractProjection(projection.id)
                    toast.warning(`已回滚到 ${projection.previousVersion}；本地库与仓库未变`)
                  }}
                >
                  <Icon name="undo" className="h-3.5 w-3.5" />
                  回滚到 {projection.previousVersion}
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
            toast.success(`已移除「${row.title}」在 ${row.target.label} 的投影`)
          }
          onClose()
        }}
        title="移除这条投影？"
        confirmText="移除"
        message={
          <>
            将从「<b className="text-foreground">{path}</b>」的 managed block 中移除这条契约（原型模拟）。
            本地契约库与 Git 仓库不受影响。
            {row.target.merge === 'single-file' && ` 同一文件中的其他 ${mergedCount - 1} 条契约保持不变。`}
          </>
        }
      />
    </>
  )
}
