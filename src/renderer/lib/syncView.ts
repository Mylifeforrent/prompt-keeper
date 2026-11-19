import type {
  AssetKind,
  AssetSyncState,
  AuditEventType,
  DispatchStatus,
  IpcErrorDetails,
  RepoPolicies,
  RepoProvider,
  SyncChangeKind,
  SyncChangeStatus,
  SyncChangeSummary,
  SyncDirection,
  SyncRisk,
} from '../../shared/contracts'
import type { IconName } from './icons'

export type BadgeTone =
  | 'default'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary'
  | 'outline'

export interface SyncMeta {
  label: string
  icon: IconName
  tone: BadgeTone
}

export const KIND_META: Record<AssetKind, SyncMeta> = {
  prompt: { label: 'Prompt', icon: 'message', tone: 'primary' },
  contract: { label: 'Instructions', icon: 'file', tone: 'info' },
  skill: { label: 'Skill', icon: 'grid', tone: 'secondary' },
  mcp: { label: 'MCP', icon: 'server', tone: 'secondary' },
}

export const CHANGE_META: Record<SyncChangeKind, SyncMeta> = {
  added: { label: 'Added', icon: 'plus', tone: 'success' },
  modified: { label: 'Modified', icon: 'pencil', tone: 'info' },
  deleted: { label: 'Deleted', icon: 'trash', tone: 'danger' },
  renamed: { label: 'Renamed', icon: 'arrowRight', tone: 'warning' },
}

export const DIRECTION_META: Record<SyncDirection, SyncMeta> = {
  incoming: { label: 'Incoming', icon: 'arrowDown', tone: 'info' },
  outgoing: { label: 'Outgoing', icon: 'arrowUp', tone: 'warning' },
  conflict: { label: 'Conflict', icon: 'alert', tone: 'danger' },
}

export const CHANGE_STATUS_META: Record<SyncChangeStatus, SyncMeta> = {
  open: { label: 'Open', icon: 'dot', tone: 'outline' },
  reviewed: { label: 'Reviewed', icon: 'check', tone: 'success' },
  resolved: { label: 'Resolved', icon: 'circleCheck', tone: 'secondary' },
  dismissed: { label: 'Dismissed', icon: 'x', tone: 'outline' },
}

export const RISK_META: Record<SyncRisk, SyncMeta & { description: string }> = {
  scripts: {
    label: 'Scripts',
    icon: 'terminal',
    tone: 'warning',
    description: 'Contains executable or script-like files. Review the full content before accepting or dispatching.',
  },
  secrets: {
    label: 'Secrets',
    icon: 'lock',
    tone: 'danger',
    description: 'Credential findings block pushing until they are replaced with placeholders.',
  },
  network: {
    label: 'Network',
    icon: 'cloud',
    tone: 'info',
    description: 'The server can reach the network when an Agent starts it.',
  },
}

export const SYNC_STATE_META: Record<AssetSyncState, SyncMeta> = {
  'not-connected': { label: 'No repo connected', icon: 'gitBranch', tone: 'outline' },
  'local-only': { label: 'Local only', icon: 'lock', tone: 'outline' },
  'in-sync': { label: 'Synced', icon: 'circleCheck', tone: 'success' },
  outgoing: { label: 'Unpushed', icon: 'arrowUp', tone: 'warning' },
  incoming: { label: 'Incoming', icon: 'arrowDown', tone: 'info' },
  conflict: { label: 'Conflict', icon: 'alert', tone: 'danger' },
  blocked: { label: 'Blocked', icon: 'lock', tone: 'danger' },
}

export const DISPATCH_META: Record<DispatchStatus, SyncMeta> = {
  synced: { label: 'Synced', icon: 'circleCheck', tone: 'success' },
  stale: { label: 'Stale', icon: 'refresh', tone: 'warning' },
  drifted: { label: 'Drifted', icon: 'alert', tone: 'danger' },
  missing: { label: 'Missing', icon: 'plus', tone: 'outline' },
  unsupported: { label: 'Unsupported', icon: 'x', tone: 'secondary' },
}

export const AUDIT_META: Record<AuditEventType, { label: string; icon: IconName }> = {
  fetch: { label: 'Fetch', icon: 'download' },
  pull: { label: 'Pull', icon: 'arrowDown' },
  push: { label: 'Push', icon: 'arrowUp' },
  conflict: { label: 'Conflict', icon: 'alert' },
  deploy: { label: 'Dispatch', icon: 'send' },
  projection: { label: 'Projection', icon: 'layers' },
  blocked: { label: 'Security block', icon: 'lock' },
  connect: { label: 'Connect', icon: 'gitBranch' },
  rollback: { label: 'Rollback', icon: 'undo' },
  review: { label: 'Review', icon: 'eye' },
  backup: { label: 'Backup', icon: 'download' },
  restore: { label: 'Restore', icon: 'history' },
  reset: { label: 'Reset', icon: 'refresh' },
  security: { label: 'Security', icon: 'shield' },
  update: { label: 'Update', icon: 'sparkles' },
}

export const AUDIT_TYPES = Object.keys(AUDIT_META) as AuditEventType[]

export const POLICY_KEYS = ['skills', 'mcp', 'prompts', 'contracts'] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

export const POLICY_META: Record<PolicyKey, { label: string; kind: AssetKind; description: string }> = {
  skills: {
    label: 'Skills',
    kind: 'skill',
    description: 'Two-way sync. Skills travel with their SKILL.md and scripts, and every remote change is reviewed before it lands.',
  },
  mcp: {
    label: 'MCP',
    kind: 'mcp',
    description: 'Two-way templates with local secrets. Only ${VAR} placeholders are written to the repository.',
  },
  prompts: {
    label: 'Prompts',
    kind: 'prompt',
    description: 'Opt-in per Prompt. Prompts only travel between the repository and the local library; they are never dispatched.',
  },
  contracts: {
    label: 'Instructions',
    kind: 'contract',
    description: 'Opt-in per instruction. Projection to Agent directories is a separate, explicit action.',
  },
}

export const REPO_PROVIDER_LABEL: Record<RepoProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  generic: 'Generic Git',
}

export const CLONE_MODE_LABEL: Record<'managed' | 'bound', string> = {
  managed: 'App-managed clone',
  bound: 'Bound to an existing clone',
}

export const PUSH_MODE_LABEL: Record<'direct' | 'branch', string> = {
  direct: 'Push directly to the current branch',
  branch: 'Push to a separate branch',
}

export const AUTH_MODE_LABEL: Record<'credential' | 'ssh' | 'token', string> = {
  credential: 'System Git credentials',
  ssh: 'SSH key',
  token: 'Access token stored by the app',
}

export function policyKeyForKind(kind: AssetKind): PolicyKey {
  switch (kind) {
    case 'prompt':
      return 'prompts'
    case 'contract':
      return 'contracts'
    case 'skill':
      return 'skills'
    case 'mcp':
      return 'mcp'
  }
}

export function policyLabelList(keys: PolicyKey[]): string {
  return keys.map((key) => POLICY_META[key].label).join(', ')
}

export function policySummary(policies: RepoPolicies): string {
  const enabled = POLICY_KEYS.filter((key) => policies[key])
  if (enabled.length === 0) return 'No asset types are synced'
  if (enabled.length === POLICY_KEYS.length) return 'All asset types are synced'
  return `${policyLabelList(enabled)} synced`
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`
}

export function formatInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Manual fetch only'
  if (minutes < 60) return `Every ${minutes} minutes`
  if (minutes === 60) return 'Every hour'
  return `Every ${minutes / 60} hours`
}

export function formatLines(content: string | null): string {
  if (content === null) return 'No text'
  if (content.length === 0) return '0 lines'
  return `${content.split('\n').length} lines`
}

export function syncVersionLine(change: SyncChangeSummary): string {
  if (change.direction === 'conflict') {
    return `Repo ${change.remoteVersion ?? '—'} · Local ${change.localVersion ?? '—'} · Base ${change.baseVersion ?? '—'}`
  }
  if (change.direction === 'incoming') {
    return change.localVersion && change.remoteVersion
      ? `${change.localVersion} → ${change.remoteVersion}`
      : change.remoteVersion ?? '—'
  }
  return change.baseVersion && change.localVersion
    ? `${change.baseVersion} → ${change.localVersion}`
    : change.localVersion ?? '—'
}

export function canSelectForPull(change: SyncChangeSummary): boolean {
  return change.direction === 'incoming' && change.status === 'reviewed' && !change.blocked
}

export function canSelectForPush(change: SyncChangeSummary): boolean {
  return (
    change.direction === 'outgoing' &&
    !change.blocked &&
    change.status !== 'dismissed' &&
    change.status !== 'resolved'
  )
}

export function canReviewChange(change: SyncChangeSummary): boolean {
  return change.direction === 'incoming' && change.status !== 'dismissed' && change.status !== 'resolved'
}

export function fingerprintsOf(changes: SyncChangeSummary[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const change of changes) result[change.id] = change.fingerprint
  return result
}

export function riskLabels(risks: SyncRisk[]): string {
  return risks.map((risk) => RISK_META[risk].label).join(', ')
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

/**
 * Client-side structural validation for manual conflict merges. The backend
 * validates again; this only prevents obviously broken merges from being sent.
 */
export function validateMergedFile(path: string, content: string): string | null {
  if (!content.trim()) return `${path} is empty.`
  if (path.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch {
      return `${path} is not valid JSON.`
    }
  }
  if (path.toLowerCase().endsWith('.prompt.md')) {
    if (!FRONTMATTER.test(content)) return `${path} must keep its YAML frontmatter block.`
    if (!/^##\s+System Prompt\s*$/m.test(content)) return `${path} must keep the "## System Prompt" heading.`
    if (!/^##\s+User Prompt\s*$/m.test(content)) return `${path} must keep the "## User Prompt" heading.`
  }
  if (path.toLowerCase().endsWith('.contract.md')) {
    if (!FRONTMATTER.test(content)) return `${path} must keep its YAML frontmatter block.`
    const body = content.replace(FRONTMATTER, '').trim()
    if (!body) return `${path} must keep a non-empty instruction body.`
  }
  return null
}

/**
 * Human-readable lines for an IPC error's structured details. The generic
 * message is rendered separately.
 */
export function errorDetailLines(details: IpcErrorDetails | undefined): string[] {
  if (!details) return []
  switch (details.kind) {
    case 'validation':
      return details.fields.map((field) => `${field.path}: ${field.message}`)
    case 'limit-exceeded':
      return [`The request exceeds the ${formatBytes(details.limitBytes)} limit.`]
    case 'revision-conflict':
      return [
        `A newer revision exists (version ${details.currentVersion}, updated ${details.updatedAt}). Reload and try again.`,
      ]
    case 'projection-drift':
      return [`The target file changed on disk: ${details.targetPath}.`]
    case 'review-required':
      return [`Review these changes before continuing: ${details.changeIds.join(', ')}.`]
    case 'review-invalidated':
      return [
        `Remote content changed for: ${details.changeIds.join(', ')}. Reload the preview before trying again.`,
      ]
    case 'per-item-required':
      return [details.reason]
    case 'security-block':
      return details.findings.map((finding) => {
        const location = finding.path
          ? `${finding.path}${finding.line ? `:${finding.line}` : ''}`
          : 'content'
        return `${location} — ${finding.preview} (use ${finding.replacement})`
      })
    case 'unsupported':
      return [details.reason]
    case 'lock':
      return [
        details.operationType
          ? `Another ${details.operationType} operation is running. Wait for it to finish.`
          : 'Another operation is running. Wait for it to finish.',
      ]
    case 'target-warnings':
      return details.warnings
    case 'data-disclosure-required':
      return ['Accept the data disclosure before sending Prompt content to the provider.']
    case 'duplicate':
      return [`${details.field} "${details.value}" already exists.`]
    case 'unknown':
      return []
  }
}
