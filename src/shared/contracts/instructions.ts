import type { AssetBase, AssetSyncState, IpcErrorCode, IsoTimestamp, PageRequest, SyncPolicy } from './common'

/* ------------------------------------------------------------------ */
/* Contracts, targets, resolution                                      */
/* ------------------------------------------------------------------ */

export type ContractScope = 'user' | 'project' | 'path'
export type ContractActivationMode = 'always' | 'glob' | 'model' | 'manual'
export type ContractFormat =
  | 'agents-md'
  | 'claude-md'
  | 'copilot-instructions'
  | 'copilot-path'
  | 'cursor-mdc'
  | 'windsurf-rule'

export interface ContractActivation {
  mode: ContractActivationMode
  globs: string[]
  description?: string
}

export interface ContractTarget {
  id: string
  agentId: string
  agentName: string
  label: string
  format: ContractFormat
  pathTemplate: string
  merge: 'single-file' | 'per-contract'
  precedence: 'nearest' | 'concat' | 'override'
  supports: {
    globs: boolean
    modelDecision: boolean
    manual: boolean
    imports: boolean
  }
  maxBytes?: number
  note: string
}

export interface TargetCompatibility {
  targetId: string
  compatible: boolean
  blocking: boolean
  unsupportedFeatures: Array<'globs' | 'modelDecision' | 'manual' | 'imports'>
  warnings: string[]
}

export interface ContractListItem extends AssetBase {
  kind: 'contract'
  scope: ContractScope
  pathPrefix: string | null
  activationMode: ContractActivationMode
  priority: number
  targetIds: string[]
  compatibility: TargetCompatibility[]
  pendingChangeCount: number
}

export interface ContractDetail extends AssetBase {
  kind: 'contract'
  body: string
  scope: ContractScope
  pathPrefix: string | null
  activation: ContractActivation
  priority: number
  imports: string[]
  targetIds: string[]
  compatibility: TargetCompatibility[]
}

export interface ContractQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  scope?: ContractScope
  activationMode?: ContractActivationMode
  targetId?: string
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title' | 'priority'
  order?: 'asc' | 'desc'
}

export interface ContractCreateInput {
  requestId?: string
  title: string
  description?: string
  body?: string
  folder?: string
  scope: ContractScope
  pathPrefix?: string
  activation: ContractActivation
  priority?: number
  imports?: string[]
  targetIds: string[]
  tags?: string[]
  syncPolicy?: SyncPolicy
  acknowledgeTargetWarnings?: boolean
}

export interface ContractUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  body?: string
  folder?: string
  scope?: ContractScope
  pathPrefix?: string | null
  activation?: ContractActivation
  priority?: number
  imports?: string[]
  targetIds?: string[]
  tags?: string[]
  acknowledgeTargetWarnings?: boolean
}

export interface ContractResolveInput {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  samplePath?: string
  contractIds?: string[]
}

export interface ResolvedContractEntry {
  contractId: string
  title: string
  sourcePath: string
  reason: string
  bytes: number
  revisionId: string
  activationMode: ContractActivationMode
}

export interface SkippedContractEntry {
  contractId: string
  title: string
  reason: string
  code:
    | 'path-scope-mismatch'
    | 'glob-not-matched'
    | 'activation-unsupported'
    | 'target-not-selected'
    | 'deleted'
    | 'model-decision'
    | 'manual-only'
}

export interface ResolvedPreview {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  samplePath?: string
  included: ResolvedContractEntry[]
  skipped: SkippedContractEntry[]
  totalBytes: number
  maxBytes?: number
  budgetExceeded: boolean
  warnings: string[]
  compiledFilePaths: string[]
  approximationNotice: string
}

export interface ContractCompileInput {
  targetId: string
  scope: 'project' | 'global'
  projectId?: string
  contractIds: string[]
  samplePath?: string
}

export interface CompiledFile {
  targetId: string
  path: string
  content: string
  bytes: number
}

export interface ContractCompileResult {
  files: CompiledFile[]
  warnings: string[]
  previewToken: string
}

/* ------------------------------------------------------------------ */
/* Projections and global targets                                      */
/* ------------------------------------------------------------------ */

export type ProjectionStatus = 'synced' | 'stale' | 'drifted' | 'missing'

export interface ProjectionDetail {
  id: string
  contractId: string | null
  contractTitle: string
  contractSlug: string
  targetId: string
  scope: 'project' | 'global'
  projectId: string
  targetPath: string
  status: ProjectionStatus
  deployedRevisionId: string | null
  deployedVersion: number | null
  previousVersion?: number
  deployedAt?: IsoTimestamp
  fileHash?: string
  outsideHash?: string
  blockHash?: string
  note?: string
  orphaned: boolean
}

export interface ProjectionQuery extends PageRequest {
  contractId?: string
  targetId?: string
  scope?: 'project' | 'global'
  projectId?: string
  status?: ProjectionStatus
  orphaned?: boolean
}

export type GlobalProjectionQuery = Omit<ProjectionQuery, 'scope' | 'projectId'>

export interface ProjectionProjectInput {
  contractIds: string[]
  targetIds: string[]
  projectId: string
  confirm: true
  previewToken?: string
  requestId?: string
}

export interface GlobalProjectionProjectInput {
  contractIds: string[]
  targetIds: string[]
  confirm: true
  previewToken?: string
  requestId?: string
}

export interface ProjectionFailure {
  contractId: string
  targetId: string
  targetPath?: string
  code: IpcErrorCode
  message: string
}

export interface BatchProjectionResult {
  projected: number
  skipped: number
  driftedNotOverwritten: number
  skippedItems: Array<{ contractId: string; targetId: string; reason: string }>
  failed: ProjectionFailure[]
}

export interface ProjectionOperationResult extends BatchProjectionResult {
  scope: 'project' | 'global'
}

export interface ProjectionRemoveResult {
  projectionId: string
  removed: boolean
  targetPath: string
  note?: string
}

export interface ProjectionOverwriteDriftInput {
  projectionId: string
  expectedFileHash: string
  confirm: true
}

export interface GlobalTargetDetail {
  id: string
  agentId: string
  agentName: string
  label: string
  description: string
  pathMode: 'file' | 'dir'
  defaultPath: string
  path: string
  format: 'claude-md' | 'agents-md' | 'cursor-mdc' | 'windsurf-rule' | 'plain-md'
  merge: 'single-file' | 'per-contract'
  fileExt?: string
  supports: {
    globs: boolean
    modelDecision: boolean
    manual: boolean
    imports: boolean
  }
  maxBytes?: number
  note: string
  exists: boolean
  detected: boolean
  projectionCount: number
  staleCount: number
  driftedCount: number
  updatedAt: IsoTimestamp
}

export interface GlobalTargetUpdateInput {
  targetId: string
  path: string
  expectedUpdatedAt?: IsoTimestamp
}

export interface GlobalTargetUpdateResult {
  target: GlobalTargetDetail
  markedStale: number
  driftedNotChanged: number
}

export interface ContractFileModel {
  id: string
  title: string
  description: string
  folder: string
  scope: ContractScope
  pathPrefix: string | null
  activation: ContractActivation
  priority: number
  imports: string[]
  targetIds: string[]
  tags: string[]
  syncPolicy: SyncPolicy
  body: string
}
