import { useEffect, useMemo, useState } from 'react'
import type { AgentContract, AgentGlobalTarget } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Input, Select } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import {
  compileGlobalFiles,
  globalPathHint,
  globalPathIsValid,
  globalTargetSupports,
  resolveGlobalPath,
} from '../../lib/globalTargets'
import { ACTIVATION_META, PROJECTION_META, contractVersionLabel } from '../../lib/contracts'
import { folderMatches, folderLabel, folderOptions } from '../../lib/folders'

/**
 * Agent 指令 → 本机 Agent 全局目录。
 * 与项目级投影分开：这里写入的是用户级目录，路径可由用户逐项改写。
 */
export function GlobalDispatch({ query }: { query: string }) {
  const { state, deployGlobal, syncGlobalProjection, removeGlobalProjection, rollbackGlobalProjection } = useStore()
  const toast = useToast()
  const [selectedContracts, setSelectedContracts] = useState<string[]>([])
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['gt-claude'])
  const [folderFilter, setFolderFilter] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [driftConfirm, setDriftConfirm] = useState<{ projectionId: string; title: string; path: string } | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<{ projectionId: string; title: string; path: string } | null>(null)

  const folders = folderOptions(state.contracts, (c) => c.folder)
  const q = query.trim().toLowerCase()

  const contracts = useMemo(
    () =>
      state.contracts.filter((contract) => {
        if (folderFilter && !folderMatches(contract.folder, folderFilter)) return false
        if (!q) return true
        return [contract.title, contract.description, contract.body, contract.tags.join(' '), contract.folder ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      }),
    [state.contracts, folderFilter, q],
  )

  const targets = state.globalTargets
  const selectedContractObjects = state.contracts.filter((c) => selectedContracts.includes(c.id))
  const selectedTargetObjects = targets.filter((t) => selectedTargets.includes(t.id))

  const combos = selectedContractObjects.flatMap((contract) =>
    selectedTargetObjects.map((target) => ({
      contract,
      target,
      supported: globalTargetSupports(contract, target),
      existing: state.globalProjections.find(
        (p) => p.contractId === contract.id && p.targetId === target.id,
      ),
    })),
  )
  const supportedCombos = combos.filter((combo) => combo.supported)
  const driftedCombos = supportedCombos.filter((combo) => combo.existing?.status === 'drifted')
  const unsupportedCount = combos.length - supportedCombos.length

  const toggleContract = (id: string) =>
    setSelectedContracts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const toggleTarget = (id: string) =>
    setSelectedTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const records = useMemo(() => {
    return state.globalProjections
      .map((projection) => {
        const contract = state.contracts.find((c) => c.id === projection.contractId) ?? null
        const target = state.globalTargets.find((t) => t.id === projection.targetId) ?? null
        if (!target) return null
        const path = contract
          ? resolveGlobalPath(contract, target)
          : target.pathMode === 'file'
            ? target.path
            : `${target.path.replace(/\/+$/, '')}/${projection.contractSlug ?? projection.contractId}${target.fileExt ?? '.md'}`
        return { projection, contract, target, path }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .sort((a, b) => {
        const rank = (status: string) => (status === 'drifted' ? 0 : status === 'stale' ? 1 : 2)
        return rank(a.projection.status) - rank(b.projection.status)
      })
  }, [state.globalProjections, state.contracts, state.globalTargets])

  const project = () => {
    if (!selectedContracts.length || !selectedTargets.length) return
    deployGlobal(selectedContracts, selectedTargets)
    toast.success(
      driftedCombos.length
        ? `已投影 ${supportedCombos.length - driftedCombos.length} 个组合；${driftedCombos.length} 个漂移项未覆盖，请在下方逐项确认`
        : `已投影 ${supportedCombos.length} 个组合到本机 Agent 全局目录（模拟写入）`,
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
          <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            全局分发是<b>从本地库到本机 Agent 全局目录的单向写出</b>，不经过 Git，也不回写仓库。
            勾选多条指令与多个工具后一次性投影；每个工具的全局目录都可以改成你本机的真实路径。
          </span>
        </div>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">全局目录（可改写）</h3>
            <Badge variant="outline">{targets.length} 个 Agent</Badge>
            <span className="text-[11px] text-muted-foreground">
              路径修改后，相关投影会标记为「待更新」，不会自动覆盖 Agent 侧改动
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {targets.map((target) => (
              <GlobalTargetCard
                key={target.id}
                target={target}
                selected={selectedTargets.includes(target.id)}
                detected={state.detectedAgents.includes(target.agentId)}
                projectedCount={state.globalProjections.filter((p) => p.targetId === target.id).length}
                onToggle={() => toggleTarget(target.id)}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
            <h3 className="text-sm font-semibold">选择要同步的指令</h3>
            <Badge variant="outline">{contracts.length} 条可选</Badge>
            <Select
              className="ml-auto h-8 w-40 text-xs"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
            >
              <option value="">全部文件夹</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedContracts(
                  contracts.every((c) => selectedContracts.includes(c.id)) ? [] : contracts.map((c) => c.id),
                )
              }
            >
              {contracts.every((c) => selectedContracts.includes(c.id)) && contracts.length > 0
                ? '取消全选'
                : '全选当前'}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {contracts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">当前搜索或文件夹筛选下没有指令</p>
            ) : (
              contracts.map((contract) => {
                const active = selectedContracts.includes(contract.id)
                const existingCount = state.globalProjections.filter((p) => p.contractId === contract.id).length
                return (
                  <div
                    key={contract.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 border-b border-border/60 px-3.5 py-2.5 transition-colors last:border-0',
                      active ? 'bg-primary-soft/60' : 'hover:bg-muted/40',
                    )}
                    onClick={() => toggleContract(contract.id)}
                  >
                    <span className="mt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={active} onChange={() => toggleContract(contract.id)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{contract.title}</span>
                        <Badge variant="secondary">
                          <Icon name="folder" className="h-3 w-3" />
                          {folderLabel(contract.folder)}
                        </Badge>
                        <Badge variant={contract.activation.mode === 'always' ? 'primary' : 'info'}>
                          {ACTIVATION_META[contract.activation.mode].short}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{contractVersionLabel(contract)}</span>
                        {existingCount > 0 && <Badge variant="success">已在 {existingCount} 个全局目录</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {contract.description || '（无描述）'}
                      </span>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-3">
          <span className="text-xs text-muted-foreground">
            已选 <b className="text-foreground">{selectedContractObjects.length}</b> 条指令 ×{' '}
            <b className="text-foreground">{selectedTargetObjects.length}</b> 个全局目录
          </span>
          {unsupportedCount > 0 && (
            <Badge variant="warning">{unsupportedCount} 个组合因激活方式不兼容会跳过</Badge>
          )}
          {driftedCombos.length > 0 && (
            <Badge variant="danger">{driftedCombos.length} 个组合漂移，批量不会覆盖</Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={selectedContractObjects.length === 0 || selectedTargetObjects.length === 0}
              onClick={() => setPreviewOpen(true)}
            >
              <Icon name="eye" className="h-3.5 w-3.5" />
              预览写入内容
            </Button>
            <Button
              size="sm"
              disabled={supportedCombos.length === 0 || driftedCombos.length === supportedCombos.length}
              onClick={project}
            >
              <Icon name="send" className="h-3.5 w-3.5" />
              投影所选
            </Button>
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">全局投影记录</h3>
            <Badge variant="outline">{records.length} 条</Badge>
            <span className="text-[11px] text-muted-foreground">漂移项只能逐条覆盖；移除只影响本机文件</span>
          </div>
          {records.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
              还没有全局投影。勾选上方指令与全局目录后点「投影所选」。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-max border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">指令</th>
                    <th className="px-3 py-2.5 font-medium">全局目录</th>
                    <th className="px-3 py-2.5 font-medium">写入路径</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="px-3 py-2.5 font-medium">版本 / 时间</th>
                    <th className="px-3 py-2.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(({ projection, contract, target, path }) => {
                    const meta = PROJECTION_META[projection.status]
                    const title = contract?.title ?? projection.contractTitle ?? '已删除的指令'
                    return (
                      <tr key={projection.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">{title}</span>
                            {!contract && <Badge variant="warning">已删除</Badge>}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {contract ? contractVersionLabel(contract) : '只能移除或回滚'}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs">{target.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {target.agentName} · {target.merge === 'single-file' ? '合并文件' : '独立文件'}
                          </div>
                        </td>
                        <td className="max-w-64 px-3 py-2">
                          <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]" title={path}>
                            {path}
                          </code>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={meta.variant}>
                            <Icon name={meta.icon} className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                          {projection.note && (
                            <div className="mt-0.5 max-w-52 text-[10px] leading-4 text-muted-foreground">
                              {projection.note}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground">
                          <div>{projection.deployedVersion}</div>
                          <div>{relativeTime(projection.deployedAt)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {contract && (
                              <Button
                                size="sm"
                                variant={projection.status === 'drifted' ? 'danger' : 'outline'}
                                onClick={() => {
                                  if (projection.status === 'drifted') {
                                    setDriftConfirm({ projectionId: projection.id, title, path })
                                  } else {
                                    syncGlobalProjection(projection.id)
                                    toast.success(`已重新投影「${title}」→ ${target.label}`)
                                  }
                                }}
                              >
                                {projection.status === 'drifted' ? '覆盖' : '重新投影'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-danger"
                              onClick={() => setRemoveConfirm({ projectionId: projection.id, title, path })}
                            >
                              移除
                            </Button>
                            {projection.previousVersion && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  rollbackGlobalProjection(projection.id)
                                  toast.warning(`已回滚到 ${projection.previousVersion}；本地库与仓库未变`)
                                }}
                              >
                                回滚
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
          )}
        </section>
      </div>

      {previewOpen && (
        <GlobalPreviewModal
          contracts={selectedContractObjects}
          targets={selectedTargetObjects}
          existingProjections={state.globalProjections}
          allContracts={state.contracts}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      <ConfirmDialog
        open={!!driftConfirm}
        onClose={() => setDriftConfirm(null)}
        onConfirm={() => {
          if (driftConfirm) {
            syncGlobalProjection(driftConfirm.projectionId)
            toast.warning('已显式覆盖全局目录中的手工修改；该操作可回滚')
          }
        }}
        title="覆盖 Agent 全局目录中的手工修改？"
        confirmText="覆盖并投影"
        message={
          <>
            目标文件「<b className="text-foreground">{driftConfirm?.path ?? ''}</b>」
            在 Agent 侧被手工修改过。重新投影只会重写 Prompt Keeper 管理的 block 或文件，手工修改将被覆盖。
          </>
        }
      />

      <ConfirmDialog
        open={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={() => {
          if (removeConfirm) {
            removeGlobalProjection(removeConfirm.projectionId)
            toast.success('已移除全局投影；本地库与仓库不受影响')
          }
        }}
        title="移除这条全局投影？"
        confirmText="移除"
        message={
          <>
            将从「<b className="text-foreground">{removeConfirm?.path ?? ''}</b>」移除这条指令（原型模拟）。
            本地库与 Git 仓库不受影响。
          </>
        }
      />
    </div>
  )
}

function GlobalTargetCard({
  target,
  selected,
  detected,
  projectedCount,
  onToggle,
}: {
  target: AgentGlobalTarget
  selected: boolean
  detected: boolean
  projectedCount: number
  onToggle: () => void
}) {
  const { updateGlobalTargetPath, resetGlobalTargetPath } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState(target.path)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(target.path)
    setError(null)
  }, [target.path])

  const commit = () => {
    if (!globalPathIsValid(draft)) {
      setError('必须是以 ~ 或 / 开头的绝对路径')
      return
    }
    if (draft.trim() !== target.path) {
      updateGlobalTargetPath(target.id, draft)
      toast.success(`已更新 ${target.label} 的全局目录`)
    }
    setError(null)
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3 transition-colors',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox checked={selected} onChange={onToggle} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{target.label}</span>
            <Badge variant={detected ? 'success' : 'outline'}>{detected ? '已检测' : '未检测'}</Badge>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {target.agentName} · {target.pathMode === 'file' ? '单文件' : '独立文件'} · 已投影 {projectedCount}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={() => {
            setDraft(target.defaultPath)
            resetGlobalTargetPath(target.id)
            setError(null)
          }}
          disabled={target.path === target.defaultPath}
          title="恢复默认路径"
        >
          默认
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          className={cn('h-8 font-mono text-[11px]', error && 'border-danger')}
        />
      </div>
      {error ? (
        <p className="mt-1 text-[10px] text-danger">{error}</p>
      ) : (
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{globalPathHint(target)}</p>
      )}
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{target.note}</p>
    </div>
  )
}

function GlobalPreviewModal({
  contracts,
  targets,
  existingProjections,
  allContracts,
  onClose,
}: {
  contracts: AgentContract[]
  targets: AgentGlobalTarget[]
  existingProjections: { contractId: string; targetId: string }[]
  allContracts: AgentContract[]
  onClose: () => void
}) {
  const files = targets.flatMap((target) => {
    const baseContracts =
      target.merge === 'single-file'
        ? allContracts.filter(
            (contract) =>
              contracts.some((c) => c.id === contract.id) ||
              existingProjections.some(
                (p) => p.targetId === target.id && p.contractId === contract.id,
              ),
          )
        : contracts
    const targetContracts = baseContracts.filter((contract) => globalTargetSupports(contract, target))
    return compileGlobalFiles(target, targetContracts).map((file) => ({
      ...file,
      target,
      contractCount: targetContracts.length,
    }))
  })

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title="全局目录写入预览"
      subtitle="只显示即将写入本机 Agent 目录的文件；真实写入前还会检查路径与漂移"
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-3">
        {files.length === 0 ? (
          <p className="text-xs text-muted-foreground">没有可预览的文件。</p>
        ) : (
          files.map((file) => (
            <div key={`${file.target.id}-${file.path}`} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                <Icon name="file" className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{file.target.label}</span>
                <Badge variant="outline">{file.target.merge === 'single-file' ? '合并文件' : '独立文件'}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {file.target.merge === 'single-file' ? `${file.contractCount} 条指令合并` : '单条指令'}
                </span>
                <code className="ml-auto max-w-full truncate font-mono text-[10px] text-muted-foreground">
                  {file.path}
                </code>
              </div>
              <pre className="max-h-56 overflow-auto bg-muted/40 p-3 font-mono text-[11px] leading-5">
                {file.content}
              </pre>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
