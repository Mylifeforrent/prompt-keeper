import { useState } from 'react'
import type { AgentRuntime, Deployment, FanoutStatus, InstallMode } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Switch } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { AGENT_RUNTIMES } from '../../data/syncSeed'
import { DEPLOY_META, deploymentTone } from '../../lib/sync'

interface AssetRow {
  kind: 'skill' | 'mcp'
  id: string
  name: string
  version: string
  description: string
}

export function SyncDeploy() {
  const { state, redetectAgents, syncAllStale } = useStore()
  const toast = useToast()
  const [kindFilter, setKindFilter] = useState<'all' | 'skill' | 'mcp'>('all')
  const [showAll, setShowAll] = useState(false)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [cell, setCell] = useState<{ asset: AssetRow; agent: AgentRuntime } | null>(null)

  const allAssets: AssetRow[] = [
    ...state.skills.map((s) => ({
      kind: 'skill' as const,
      id: s.id,
      name: s.name,
      version: `v${s.version}`,
      description: s.description,
    })),
    ...state.mcps.map((m) => ({
      kind: 'mcp' as const,
      id: m.id,
      name: m.name,
      version: `v${m.versions[0]?.version ?? 1}`,
      description: m.description,
    })),
  ]

  const agents = AGENT_RUNTIMES.filter((a) => {
    if (!showAll && !state.detectedAgents.includes(a.id)) return false
    if (kindFilter === 'skill') return a.supportsSkills
    if (kindFilter === 'mcp') return a.supportsMcp
    return true
  })

  const statusOf = (asset: AssetRow, agentId: string): FanoutStatus =>
    state.deployments.find((d) => d.kind === asset.kind && d.assetId === asset.id && d.agentId === agentId)?.status ??
    'missing'

  const assets = allAssets
    .filter((a) => kindFilter === 'all' || a.kind === kindFilter)
    .filter((a) => {
      if (!onlyAttention) return true
      return agents.some((ag) => {
        const st = statusOf(a, ag.id)
        return st === 'stale' || st === 'drifted'
      })
    })

  const staleTotal = state.deployments.filter(
    (d) => d.status === 'stale' && !(d.kind === 'mcp' && state.mcps.find((m) => m.id === d.assetId)?.enabled === false),
  ).length
  const driftedTotal = state.deployments.filter((d) => d.status === 'drifted').length

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          分发层是<b>单向写出</b>：本地库 → 各 Agent 默认目录，不回写仓库。
          Agent 内被手工改过的文件标记为<b>漂移</b>，不会在批量同步中被覆盖；需要逐项确认。
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { v: 'all', label: '全部' },
              { v: 'skill', label: 'Skills' },
              { v: 'mcp', label: 'MCP' },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setKindFilter(t.v)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium',
                kindFilter === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Checkbox checked={onlyAttention} onChange={setOnlyAttention} label={<span className="text-xs">只看异常</span>} />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={showAll} onChange={setShowAll} label="显示未检测到的 Agent" />
          显示未检测到的 Agent
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          已检测 {state.detectedAgents.length} 个 · 过时 {staleTotal} · 漂移 {driftedTotal}
        </span>
        <Button size="sm" variant="outline" onClick={() => toast.info(`检测完成：${redetectAgents().length} 个 Agent`)}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          重新检测
        </Button>
        <Button
          size="sm"
          disabled={staleTotal === 0}
          onClick={() => {
            syncAllStale()
            toast.success(`已重新分发 ${staleTotal} 项过时资产；漂移项未自动覆盖`)
          }}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
          同步全部过时（{staleTotal}）
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-10 min-w-[210px] bg-card px-3 py-2.5 text-xs font-medium">资产</th>
              {agents.map((a) => (
                <th key={a.id} className="min-w-[112px] px-2 py-2.5 text-xs font-medium">
                  <div className="flex items-center gap-1">
                    {a.name}
                    {state.detectedAgents.includes(a.id) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-success" title="本机已检测" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-border" title="未检测到" />
                    )}
                  </div>
                  <div className="mt-0.5 max-w-[104px] truncate font-mono text-[9px] font-normal text-muted-foreground">
                    {a.skillDir || a.mcpFile}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={`${asset.kind}-${asset.id}`} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon name={asset.kind === 'skill' ? 'grid' : 'server'} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{asset.name}</span>
                        <span className="text-[10px] text-muted-foreground">{asset.version}</span>
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">{asset.description}</div>
                    </div>
                  </div>
                </td>
                {agents.map((agent) => {
                  const supported = asset.kind === 'skill' ? agent.supportsSkills : agent.supportsMcp
                  if (!supported) {
                    return (
                      <td key={agent.id} className="px-2 py-2">
                        <span className="text-[10px] text-muted-foreground">不支持</span>
                      </td>
                    )
                  }
                  const st = statusOf(asset, agent.id)
                  const meta = DEPLOY_META[st]
                  return (
                    <td key={agent.id} className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setCell({ asset, agent })}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors',
                          st === 'synced' && 'border-success/30 bg-success-soft text-success',
                          st === 'stale' && 'border-warning/30 bg-warning-soft text-warning',
                          st === 'drifted' && 'border-danger/30 bg-danger-soft text-danger',
                          st === 'missing' && 'border-dashed border-border text-muted-foreground hover:bg-muted',
                          st === 'paused' && 'border-border bg-muted text-muted-foreground',
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

      {assets.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
          当前筛选下没有资产。
        </p>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        默认以 symlink 发布，库内编辑即时生效；文件系统不支持时回退 copy 并逐条提示。
        分发目标路径按工具规范生成，已停用的 MCP 不允许分发。
      </p>

      {cell && <DeploymentModal asset={cell.asset} agent={cell.agent} onClose={() => setCell(null)} />}
    </div>
  )
}

function DeploymentModal({
  asset,
  agent,
  onClose,
}: {
  asset: AssetRow
  agent: AgentRuntime
  onClose: () => void
}) {
  const { state, deployAsset, syncDeployment, setDeploymentMode, removeDeployment, rollbackDeployment } = useStore()
  const toast = useToast()
  const deployment = state.deployments.find(
    (d) => d.kind === asset.kind && d.assetId === asset.id && d.agentId === agent.id,
  )
  const status: FanoutStatus = deployment?.status ?? 'missing'
  const meta = DEPLOY_META[status]
  const [mode, setMode] = useState<InstallMode>(deployment?.mode ?? 'symlink')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const targetPath = asset.kind === 'skill' ? `${agent.skillDir}/${asset.name}/` : agent.mcpFile

  const mcp = asset.kind === 'mcp' ? state.mcps.find((m) => m.id === asset.id) : undefined
  const mcpDisabled = !!mcp && !mcp.enabled
  const mcpPreview = mcp
    ? JSON.stringify(
        {
          mcpServers: {
            [mcp.name]: {
              ...(mcp.transport === 'stdio'
                ? { command: mcp.command, args: mcp.args }
                : { url: mcp.url, headers: mcp.headers }),
              env: Object.fromEntries(Object.keys(mcp.env ?? {}).map((k) => [k, '[REDACTED]'])),
            },
          },
        },
        null,
        2,
      )
    : ''

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width="max-w-xl"
        title={`${asset.name} → ${agent.name}`}
        subtitle={`${asset.kind === 'skill' ? '技能' : 'MCP'} ${asset.version} · 分发是单向写出，不修改仓库`}
        footer={
          <>
            {deployment && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" className="h-3.5 w-3.5" />
                移除分发
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button
              disabled={mcpDisabled}
              title={mcpDisabled ? '已停用的 MCP 禁止分发，请先在「我的 MCP」启用' : ''}
              onClick={() => {
                if (deployment) {
                  syncDeployment(deployment.id)
                  toast.success(`已重新同步 ${asset.name} → ${agent.name}（${mode}）`)
                } else {
                  deployAsset(asset.kind, asset.id, agent.id, mode)
                  toast.success(`已分发 ${asset.name} → ${agent.name}（${mode}）`)
                }
              }}
            >
              <Icon name="send" />
              {deployment ? '重新同步' : '分发到此 Agent'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant}>
              <Icon name={meta.icon} className="h-3 w-3" />
              {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {deployment
                ? `当前 ${deployment.deployedVersion} · 部署于 ${formatDate(deployment.deployedAt)}`
                : '该 Agent 目录中还没有此资产'}
            </span>
          </div>

          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">目标路径</div>
            <div className="mt-0.5 break-all font-mono text-xs">{targetPath}</div>
          </div>

          {mcpDisabled && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              服务「{asset.name}」已停用，禁止分发或重新同步。请先在「我的 MCP」中启用。
            </div>
          )}

          {deployment?.note && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {deployment.note}
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">安装模式</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { v: 'symlink', title: 'symlink（推荐）', desc: '库内编辑即时生效，多工具共享同一份' },
                  { v: 'copy', title: 'copy', desc: '各 Agent 独立副本，更新后需重新分发' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => {
                    setMode(o.v)
                    if (deployment) setDeploymentMode(deployment.id, o.v)
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    mode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="text-xs font-medium">{o.title}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {mcp && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                写入内容预览
                <Badge variant="outline">
                  <Icon name="lock" className="h-3 w-3" />
                  凭据 [REDACTED]
                </Badge>
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[11px] leading-5">
                {mcpPreview}
              </pre>
              <p className="mt-1 text-[10px] text-muted-foreground">
                真实密钥在写入时从本机钥匙串解密注入，不会进入日志、版本快照或仓库。
              </p>
            </div>
          )}

          {deployment && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="text-[11px] text-muted-foreground">最近更新 {relativeTime(deployment.deployedAt)}</span>
              {deployment.previousVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    rollbackDeployment(deployment.id)
                    toast.warning(`已回滚到 ${deployment.previousVersion}；本地库与仓库未变`)
                  }}
                >
                  <Icon name="undo" className="h-3.5 w-3.5" />
                  回滚到 {deployment.previousVersion}
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
          if (deployment) {
            removeDeployment(deployment.id)
            toast.success(`已从 ${agent.name} 移除 ${asset.name}；本地库与仓库不受影响`)
          }
          onClose()
        }}
        title="移除分发？"
        confirmText="移除"
        message={`将删除 ${targetPath} 下的内容（原型模拟）。本地资产库与 Git 仓库不受影响。`}
      />
    </>
  )
}
