import type { AssetKind, IpcErrorCode, IsoTimestamp, OperationRef, PageRequest, ScanFinding } from './common'

/* ------------------------------------------------------------------ */
/* Git sync                                                            */
/* ------------------------------------------------------------------ */

export type RepoProvider = 'github' | 'gitlab' | 'generic'
export type SyncRisk = 'scripts' | 'secrets' | 'network'
export type SyncDirection = 'incoming' | 'outgoing' | 'conflict'
export type SyncChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'
export type SyncChangeStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed'

export type RepoAuthInput =
  | { mode: 'credential' }
  | { mode: 'ssh'; keyPath?: string }
  | { mode: 'token'; token?: string; clearToken?: boolean }

export interface RepoPolicies {
  skills: boolean
  mcp: boolean
  prompts: boolean
  contracts: boolean
}

export interface RepoLayout {
  prompts: string
  contracts: string
  skills: string
  mcp: string
}

export interface RepoStatus {
  connected: true
  provider: RepoProvider
  url: string
  branch: string
  localPath: string
  cloneMode: 'managed' | 'bound'
  auth: { mode: 'credential' | 'ssh' | 'token'; hasToken: boolean }
  policies: RepoPolicies
  layout: RepoLayout
  autoFetch: boolean
  fetchIntervalMin: number
  pushMode: 'direct' | 'branch'
  lastFetchedAt?: IsoTimestamp
  lastSyncedAt?: IsoTimestamp
  ahead: number
  behind: number
  operation: OperationRef | null
  security: { plaintextCredentialCount: number; blocked: boolean }
  fetchError?: { code: IpcErrorCode; message: string; retryable: boolean }
}

export interface RepoConnectInput {
  /** Required for a managed clone. A bound clone may omit it to use its origin remote. */
  url?: string
  provider?: RepoProvider
  /** Defaults to the checked-out branch of a bound clone, otherwise `main`. */
  branch?: string
  localPath?: string
  cloneMode: 'managed' | 'bound'
  /** Defaults to the system Git configuration. A bound clone never needs a token. */
  auth?: RepoAuthInput
  policies?: RepoPolicies
  layout?: RepoLayout
  autoFetch?: boolean
  fetchIntervalMin?: number
  confirm: boolean
  previewToken?: string
  acknowledgeScripts?: boolean
  requestId?: string
}

export interface RepoConnectPreview {
  phase: 'preview'
  repo: {
    provider: RepoProvider
    url: string
    branch: string
    localPath: string
    cloneMode: 'managed' | 'bound'
    headCommit: string | null
  }
  layout: RepoLayout
  counts: Record<AssetKind, number>
  malformed: Array<{ path: string; reason: string }>
  duplicateIds: Array<{ id: string; paths: string[] }>
  scripts: Array<{ path: string; kind: string }>
  credentialFindings: ScanFinding[]
  warnings: string[]
  previewToken: string
}

export interface RepoConnectApplied {
  phase: 'applied'
  repo: RepoStatus
}

export type RepoConnectResult = RepoConnectPreview | RepoConnectApplied

export interface RepoDisconnectInput {
  confirm: true
  deleteManagedClone?: boolean
  requestId?: string
}

export interface RepoDisconnectResult {
  disconnected: boolean
  cloneDeleted: boolean
}

export interface RepoUpdateInput {
  policies?: Partial<RepoPolicies>
  layout?: Partial<RepoLayout>
  autoFetch?: boolean
  fetchIntervalMin?: number
  pushMode?: 'direct' | 'branch'
  auth?: RepoAuthInput
  confirmPolicyWithdrawal?: boolean
  requestId?: string
}

export interface SyncChangeSummary {
  id: string
  kind: AssetKind
  assetId: string | null
  assetName: string
  path: string
  change: SyncChangeKind
  direction: SyncDirection
  status: SyncChangeStatus
  risk: SyncRisk[]
  summary: string
  additions: number
  deletions: number
  blocked: boolean
  blockReason?: string
  fingerprint: string
  remoteVersion: string | null
  localVersion: string | null
  baseVersion: string | null
  reviewedAt?: IsoTimestamp
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export interface SyncChangeQuery extends PageRequest {
  direction?: SyncDirection
  status?: SyncChangeStatus
  kind?: AssetKind
  risk?: SyncRisk
  blocked?: boolean
  search?: string
}

export interface SyncFileDiff {
  path: string
  change: SyncChangeKind
  mediaKind: 'text' | 'binary'
  base: string | null
  local: string | null
  remote: string | null
  truncated: boolean
}

export interface SyncChangeDetail extends SyncChangeSummary {
  files: SyncFileDiff[]
  redacted: true
  reviewToken: string
}

export interface SyncReviewInput {
  changeIds: string[]
  decision: 'approve' | 'dismiss'
  expectedFingerprints: Record<string, string>
  reviewTokens?: Record<string, string>
  note?: string
}

export interface SyncReviewResult {
  approved: string[]
  dismissed: string[]
  invalidated: string[]
}

export interface SyncPullInput {
  changeIds: string[]
  expectedFingerprints: Record<string, string>
  requestId?: string
}

export interface SyncPushInput {
  changeIds: string[]
  commitMessage: string
  method: 'direct' | 'branch'
  requestId?: string
}

export interface SyncConflictResolveInput {
  changeId: string
  expectedFingerprint: string
  strategy: 'take-remote' | 'keep-local' | 'manual'
  mergedFiles?: Array<{ path: string; content: string }>
  confirm?: boolean
  note?: string
  requestId?: string
}

export interface ConflictResolutionResult {
  changeId: string
  resolved: boolean
  strategy: 'take-remote' | 'keep-local' | 'manual'
  localRevisionId?: string
  outgoingChangeId?: string
}

export type AuditEventType =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'conflict'
  | 'deploy'
  | 'projection'
  | 'blocked'
  | 'connect'
  | 'rollback'
  | 'review'
  | 'backup'
  | 'restore'
  | 'reset'
  | 'security'
  | 'update'

export interface AuditEvent {
  id: string
  at: IsoTimestamp
  type: AuditEventType
  result: 'success' | 'warning' | 'error'
  title: string
  detail?: Record<string, unknown>
  assetId?: string
  targetId?: string
  repoId?: string
  operationId?: string
}

export interface SyncHistoryQuery extends PageRequest {
  type?: AuditEventType
  result?: 'success' | 'warning' | 'error'
  from?: IsoTimestamp
  to?: IsoTimestamp
}

export interface CancelResult {
  cancelled: boolean
}
