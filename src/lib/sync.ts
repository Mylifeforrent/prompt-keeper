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
  skill: { label: 'Skill', icon: 'grid', dir: 'skills/' },
  mcp: { label: 'MCP', icon: 'server', dir: 'mcp/' },
  prompt: { label: 'Prompt', icon: 'message', dir: 'prompts/' },
  contract: { label: 'Instructions', icon: 'file', dir: 'instructions/' },
}

export const RISK_META: Record<SyncRisk, { label: string; variant: BadgeVariant; icon: IconName }> = {
  none: { label: 'Low risk', variant: 'outline', icon: 'check' },
  scripts: { label: 'Contains executable scripts', variant: 'warning', icon: 'terminal' },
  secrets: { label: 'Contains plaintext secret', variant: 'danger', icon: 'lock' },
  network: { label: 'Network access', variant: 'info', icon: 'cloud' },
}

export const CHANGE_META = {
  added: { label: 'Added', variant: 'success' as BadgeVariant },
  modified: { label: 'Modified', variant: 'info' as BadgeVariant },
  deleted: { label: 'Deleted', variant: 'danger' as BadgeVariant },
  renamed: { label: 'Renamed', variant: 'secondary' as BadgeVariant },
}

export const DEPLOY_META: Record<FanoutStatus, { label: string; variant: BadgeVariant; icon: IconName }> = {
  synced: { label: 'Synced', variant: 'success', icon: 'check' },
  stale: { label: 'Stale', variant: 'warning', icon: 'refresh' },
  drifted: { label: 'Drifted', variant: 'danger', icon: 'alert' },
  missing: { label: 'Not dispatched', variant: 'outline', icon: 'plus' },
  paused: { label: 'Paused', variant: 'secondary', icon: 'x' },
}

export const EVENT_META: Record<SyncEventType, { label: string; icon: IconName; tone: string }> = {
  fetch: { label: 'Fetch remote', icon: 'cloud', tone: 'text-info' },
  pull: { label: 'Merge locally', icon: 'arrowDown', tone: 'text-success' },
  push: { label: 'Push to repo', icon: 'arrowUp', tone: 'text-success' },
  conflict: { label: 'Conflict resolution', icon: 'alert', tone: 'text-warning' },
  deploy: { label: 'Dispatch', icon: 'send', tone: 'text-primary' },
  blocked: { label: 'Security block', icon: 'lock', tone: 'text-danger' },
  connect: { label: 'Repo connection', icon: 'gitBranch', tone: 'text-info' },
  rollback: { label: 'Roll back', icon: 'undo', tone: 'text-warning' },
  review: { label: 'Pending review', icon: 'shield', tone: 'text-warning' },
}

export type AssetRepoState = 'in-sync' | 'remote-ahead' | 'local-ahead' | 'diverged' | 'blocked' | 'ignored'

export const REPO_STATE_META: Record<AssetRepoState, { label: string; variant: BadgeVariant }> = {
  'in-sync': { label: 'Synced with repo', variant: 'success' },
  'remote-ahead': { label: 'Repo has updates', variant: 'info' },
  'local-ahead': { label: 'Unpushed local changes', variant: 'warning' },
  diverged: { label: 'Two-way conflict', variant: 'danger' },
  blocked: { label: 'Push blocked', variant: 'danger' },
  ignored: { label: 'Local only', variant: 'outline' },
}

/** Repo sync state for an asset; enabled=false means local only or that asset type is disabled */
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
