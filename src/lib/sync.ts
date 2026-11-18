import type {
  AssetKind,
  Deployment,
  FanoutStatus,
  McpServer,
  SyncChange,
  SyncEventType,
  SyncRisk,
} from '../types'
import type { IconName } from './icons'

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'outline'

export const ASSET_META: Record<AssetKind, { label: string; icon: IconName; dir: string }> = {
  skill: { label: '技能', icon: 'grid', dir: 'skills/' },
  mcp: { label: 'MCP', icon: 'server', dir: 'mcp/' },
  prompt: { label: 'Prompt', icon: 'message', dir: 'prompts/' },
  contract: { label: '指令', icon: 'file', dir: 'instructions/' },
}

export const RISK_META: Record<SyncRisk, { label: string; variant: BadgeVariant; icon: IconName }> = {
  none: { label: '低风险', variant: 'outline', icon: 'check' },
  scripts: { label: '含可执行脚本', variant: 'warning', icon: 'terminal' },
  secrets: { label: '含明文密钥', variant: 'danger', icon: 'lock' },
  network: { label: '会访问网络', variant: 'info', icon: 'cloud' },
}

export const CHANGE_META = {
  added: { label: '新增', variant: 'success' as BadgeVariant },
  modified: { label: '修改', variant: 'info' as BadgeVariant },
  deleted: { label: '删除', variant: 'danger' as BadgeVariant },
  renamed: { label: '重命名', variant: 'secondary' as BadgeVariant },
}

export const DEPLOY_META: Record<FanoutStatus, { label: string; variant: BadgeVariant; icon: IconName }> = {
  synced: { label: '已同步', variant: 'success', icon: 'check' },
  stale: { label: '过时', variant: 'warning', icon: 'refresh' },
  drifted: { label: '漂移', variant: 'danger', icon: 'alert' },
  missing: { label: '未分发', variant: 'outline', icon: 'plus' },
  paused: { label: '已暂停', variant: 'secondary', icon: 'x' },
}

export const EVENT_META: Record<SyncEventType, { label: string; icon: IconName; tone: string }> = {
  fetch: { label: '拉取远端', icon: 'cloud', tone: 'text-info' },
  pull: { label: '合入本地', icon: 'arrowDown', tone: 'text-success' },
  push: { label: '推送仓库', icon: 'arrowUp', tone: 'text-success' },
  conflict: { label: '冲突处理', icon: 'alert', tone: 'text-warning' },
  deploy: { label: '分发', icon: 'send', tone: 'text-primary' },
  blocked: { label: '安全阻断', icon: 'lock', tone: 'text-danger' },
  connect: { label: '仓库连接', icon: 'gitBranch', tone: 'text-info' },
  rollback: { label: '回滚', icon: 'undo', tone: 'text-warning' },
  review: { label: '待审核', icon: 'shield', tone: 'text-warning' },
}

export type AssetRepoState = 'in-sync' | 'remote-ahead' | 'local-ahead' | 'diverged' | 'blocked' | 'ignored'

export const REPO_STATE_META: Record<AssetRepoState, { label: string; variant: BadgeVariant }> = {
  'in-sync': { label: '仓库已同步', variant: 'success' },
  'remote-ahead': { label: '仓库有更新', variant: 'info' },
  'local-ahead': { label: '本地有未推送改动', variant: 'warning' },
  diverged: { label: '双向冲突', variant: 'danger' },
  blocked: { label: '推送被阻断', variant: 'danger' },
  ignored: { label: '仅本机', variant: 'outline' },
}

/** 某资产在仓库同步中的状态；enabled=false 表示仅本机或该类型未启用 */
export function assetRepoState(
  changes: SyncChange[],
  kind: AssetKind,
  assetName: string,
  enabled = true,
  assetId?: string,
): AssetRepoState {
  if (!enabled) return 'ignored'
  const rows = changes.filter((c) => {
    if (c.kind !== kind || c.resolved) return false
    if (assetId) return c.assetId ? c.assetId === assetId : c.assetName === assetName
    return c.assetName === assetName
  })
  const incoming = rows.some((r) => r.direction === 'incoming')
  const outgoing = rows.some((r) => r.direction === 'outgoing')
  if (rows.some((r) => r.direction === 'conflict') || (incoming && outgoing)) return 'diverged'
  if (rows.some((r) => r.blocked)) return 'blocked'
  if (incoming) return 'remote-ahead'
  if (outgoing) return 'local-ahead'
  return 'in-sync'
}

export function activeChanges(changes: SyncChange[], direction: SyncChange['direction']) {
  return changes.filter((c) => c.direction === direction && !c.resolved)
}

export function syncCounts(changes: SyncChange[], deployments: Deployment[], mcps: McpServer[] = []) {
  const incoming = activeChanges(changes, 'incoming')
  const outgoing = activeChanges(changes, 'outgoing')
  const conflicts = activeChanges(changes, 'conflict')
  const blocked = outgoing.filter((c) => c.blocked)
  const isDisabledMcp = (d: Deployment) =>
    d.kind === 'mcp' && mcps.find((m) => m.id === d.assetId)?.enabled === false
  const stale = deployments.filter((d) => d.status === 'stale' && !isDisabledMcp(d))
  const drifted = deployments.filter((d) => d.status === 'drifted')
  return {
    incoming: incoming.length,
    outgoing: outgoing.filter((c) => !c.blocked).length,
    outgoingAll: outgoing.length,
    conflicts: conflicts.length,
    blocked: blocked.length,
    stale: stale.length,
    drifted: drifted.length,
    pending:
      incoming.length +
      outgoing.filter((c) => !c.blocked).length +
      conflicts.length +
      blocked.length +
      stale.length +
      drifted.length,
  }
}

export function deploymentTone(status: FanoutStatus): BadgeVariant {
  return DEPLOY_META[status].variant
}
