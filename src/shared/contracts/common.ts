export type IsoTimestamp = string
export type AssetKind = 'prompt' | 'contract' | 'skill' | 'mcp'
export type SyncPolicy = 'inherit' | 'sync' | 'local'
export type ThemeMode = 'light' | 'dark' | 'system'
export type Density = 'comfortable' | 'compact'

export type AssetSyncState =
  | 'not-connected'
  | 'local-only'
  | 'in-sync'
  | 'outgoing'
  | 'incoming'
  | 'conflict'
  | 'blocked'

export interface PageRequest {
  limit?: number
  offset?: number
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface FolderNode {
  path: string
  name: string
  directCount: number
  totalCount: number
  children: FolderNode[]
}

export interface AssetListResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  folders: FolderNode[]
}

export interface RevisionSummary {
  id: string
  version: number
  note: string | null
  manifestHash: string
  createdAt: IsoTimestamp
  /**
   * Optional text content for version review. Additive extension to the
   * contract so the renderer can compare a historical revision with the
   * current content without a second channel. Binary files use `content: null`.
   */
  files?: Array<{ path: string; content: string | null }>
}

export interface AssetBase {
  id: string
  kind: AssetKind
  title: string
  slug: string
  folder: string
  description: string
  tags: string[]
  syncPolicy: SyncPolicy
  effectiveSync: boolean
  syncState: AssetSyncState
  inRepo: boolean
  currentRevisionId: string
  currentVersion: number
  versionCount: number
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export interface DeleteInput {
  id: string
  confirm: true
  requestId?: string
}

export interface DeleteResult {
  id: string
  deletedAt: IsoTimestamp
  withdrawnChangeIds: string[]
}

export interface SetFavoriteInput {
  id: string
  favorite: boolean
}

export interface FavoriteResult {
  id: string
  isFavorite: boolean
}

export interface SetPinnedInput {
  id: string
  pinned: boolean
}

export interface PinnedResult {
  id: string
  isPinned: boolean
}

export interface SetSyncPolicyInput {
  id: string
  syncPolicy: SyncPolicy
}

export interface AssetSyncPolicyResult {
  id: string
  syncPolicy: SyncPolicy
  effectiveSync: boolean
  withdrawnChangeIds: string[]
}

export interface RestoreVersionInput {
  id: string
  revisionId: string
  expectedRevisionId: string
  note?: string
  requestId?: string
}

export interface StoreQuery extends PageRequest {
  search?: string
  category?: string
}

export interface ScanFinding {
  ruleId: string
  confidence: 'high' | 'medium'
  path?: string
  line?: number
  column?: number
  preview: string
  replacement: '{{variable}}' | '${VAR}'
}

export interface HealthIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type IpcErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'PERMISSION'
  | 'LOCKED'
  | 'GIT_NOT_FOUND'
  | 'GIT_AUTH'
  | 'GIT_CONFLICT'
  | 'NETWORK'
  | 'SECURITY_BLOCK'
  | 'UNSUPPORTED'
  | 'CORRUPT'
  | 'INTERNAL'

export type IpcErrorDetails =
  | { kind: 'validation'; fields: Array<{ path: string; message: string }> }
  | { kind: 'limit-exceeded'; limitBytes: number }
  | { kind: 'revision-conflict'; currentRevisionId: string; currentVersion: number; updatedAt: string }
  | { kind: 'projection-drift'; projectionId: string; targetPath: string; fileHash?: string }
  | { kind: 'review-required'; changeIds: string[] }
  | { kind: 'review-invalidated'; changeIds: string[]; currentFingerprints: Record<string, string> }
  | { kind: 'per-item-required'; changeIds: string[]; reason: string }
  | { kind: 'security-block'; operation: 'push' | 'apply' | 'import' | 'export'; findings: ScanFinding[] }
  | { kind: 'unsupported'; targetId?: string; feature?: string; reason: string }
  | { kind: 'lock'; operationId?: string; operationType?: OperationType }
  | { kind: 'target-warnings'; warnings: string[]; requiresAcknowledgement: true }
  | { kind: 'data-disclosure-required'; providerId: string }
  | { kind: 'duplicate'; field: string; value: string }
  | { kind: 'unknown'; [key: string]: unknown }

export interface IpcErrorPayload {
  code: IpcErrorCode
  message: string
  details?: IpcErrorDetails
  retryable: boolean
  traceId?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorPayload }

export type OperationType =
  | 'sync_fetch'
  | 'sync_pull'
  | 'sync_push'
  | 'dispatch'
  | 'projection'
  | 'mcp_apply'
  | 'mcp_remove'
  | 'backup'
  | 'restore'
  | 'search_rebuild'
  | 'update_download'
  | 'update_install'
  | 'reset'

export interface OperationRef {
  phase: 'started'
  operationId: string
  type: OperationType
  startedAt: IsoTimestamp
}
