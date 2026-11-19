/**
 * Renderer-main boundary types.
 *
 * This module mirrors docs/api-contract.md. Channel names and payload shapes are
 * authoritative there; when this file and the document disagree, the document wins.
 */

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

/* ------------------------------------------------------------------ */
/* App bootstrap, data locations, projects                             */
/* ------------------------------------------------------------------ */

export type DataLocationId =
  | 'database'
  | 'blobs'
  | 'library'
  | 'clones'
  | 'backups'
  | 'logs'
  | 'operations'

export interface DataLocation {
  id: DataLocationId
  label: string
  path: string
  exists: boolean
  sizeBytes?: number
}

export interface BootstrapSnapshot {
  appVersion: string
  buildId: string
  schemaVersion: number
  contractVersion: 1
  platform: 'darwin' | 'win32'
  locale: string
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
  density: Density
  safeStorage: { available: boolean; reason?: string }
  capabilities: {
    ai: boolean
    updates: boolean
    globalProjections: boolean
    multiWindow: false
  }
  repo: RepoStatus | null
  counts: Record<AssetKind, number>
  pending: {
    incoming: number
    outgoing: number
    conflicts: number
    dispatchStale: number
    dispatchDrifted: number
    projectionStale: number
    projectionDrifted: number
  }
  detectedAgentIds: string[]
  activeOperations: OperationRef[]
  recovery: { degraded: boolean; issues: string[] }
  dataLocations: DataLocation[]
}

export interface ThemeUpdateResult {
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
}

export type RevealTarget =
  | { kind: 'data-location'; location: DataLocationId }
  | { kind: 'projection'; projectionId: string }
  | { kind: 'deployment'; deploymentId: string }

export interface ProjectSummary {
  id: string
  name: string
  rootPath: string
  createdAt: IsoTimestamp
  projectionCount: number
  staleCount: number
  driftedCount: number
}

export interface ProjectRegisterInput {
  name: string
  rootPath: string
}

export interface ProjectRemoveResult {
  projectId: string
  orphanedProjectionIds: string[]
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export type PromptVariableType = 'text' | 'textarea' | 'number' | 'select'

export interface PromptVariable {
  name: string
  type: PromptVariableType
  label?: string
  example?: string
  options?: string[]
  required?: boolean
}

export interface PromptListItem extends AssetBase {
  kind: 'prompt'
  excerpt: string
  variableCount: number
  usageCount: number
  isFavorite: boolean
  isPinned: boolean
  pendingChangeCount: number
}

export interface PromptDetail extends AssetBase {
  kind: 'prompt'
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  usageCount: number
  isFavorite: boolean
  isPinned: boolean
}

export interface PromptQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  favorite?: boolean
  pinned?: boolean
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title' | 'usage'
  order?: 'asc' | 'desc'
}

export interface PromptCreateInput {
  requestId?: string
  title: string
  description?: string
  folder?: string
  tags?: string[]
  systemPrompt?: string
  userPrompt?: string
  variables?: PromptVariable[]
  syncPolicy?: SyncPolicy
}

export interface PromptUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  folder?: string
  tags?: string[]
  systemPrompt?: string
  userPrompt?: string
  variables?: PromptVariable[]
}

export interface PromptCopyInput {
  id: string
  values: Record<string, string>
  writeClipboard?: boolean
}

export interface PromptCopyResult {
  text: string
  unresolvedVariables: string[]
  warnings: string[]
  usageCount: number
  wroteClipboard: boolean
}

export interface PromptStoreItem {
  id: string
  title: string
  description: string
  author: string
  category: string
  tags: string[]
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  uses: number
  updatedAt: IsoTimestamp
}

export interface PromptFolderQuery {
  search?: string
  tags?: string[]
  favorite?: boolean
  pinned?: boolean
}

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

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export type SkillSource = 'local' | 'official' | 'community' | 'import' | 'scan'
export type InstallMode = 'symlink' | 'copy'

export interface SkillFileEntry {
  path: string
  size: number
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

export interface SkillFileWrite {
  path: string
  content: string
}

export interface SkillListItem extends AssetBase {
  kind: 'skill'
  versionLabel: string
  icon: string
  source: SkillSource
  category: string
  fileCount: number
  pendingChangeCount: number
  installSummary: {
    synced: number
    stale: number
    drifted: number
    missing: number
    unsupported: number
  }
}

export interface SkillDetail extends AssetBase {
  kind: 'skill'
  versionLabel: string
  author: string
  category: string
  icon: string
  source: SkillSource
  files: SkillFileEntry[]
  installSummary: SkillListItem['installSummary']
}

export interface SkillQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  source?: SkillSource
  category?: string
  syncState?: AssetSyncState
  sort?: 'updated' | 'created' | 'title'
  order?: 'asc' | 'desc'
}

export interface SkillCreateInput {
  requestId?: string
  title: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files: SkillFileWrite[]
}

export interface SkillUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  folder?: string
  icon?: string
  author?: string
  versionLabel?: string
  category?: string
  tags?: string[]
  files?: SkillFileWrite[]
}

export interface SkillFilesInput {
  assetId: string
  revisionId?: string
  includeContent?: boolean
}

export interface SkillFilesResult {
  assetId: string
  revisionId: string
  manifestHash: string
  files: SkillFileEntry[]
  contents?: Record<string, string>
  omitted: Array<{ path: string; reason: 'binary' | 'too-large' }>
}

export interface SkillImportInput {
  requestId?: string
  sourcePaths?: string[]
  pickFromDialog?: boolean
  confirm: boolean
  previewToken?: string
  acknowledgeScripts?: boolean
}

export interface SkillImportPreview {
  phase: 'preview'
  sources: Array<{
    sourcePath: string
    name: string
    files: SkillFileEntry[]
    risk: SyncRisk[]
    findings: ScanFinding[]
    warnings: string[]
  }>
  conflicts: Array<{ sourcePath: string; reason: string }>
  previewToken: string
}

export interface SkillImportApplied {
  phase: 'applied'
  imported: SkillDetail[]
  skipped: Array<{ sourcePath: string; reason: string }>
}

export type SkillImportResult = SkillImportPreview | SkillImportApplied

export interface SkillStoreItem {
  id: string
  name: string
  icon: string
  description: string
  author: string
  version: string
  category: string
  downloads: number
  source: 'official' | 'community'
  files: SkillFileEntry[]
}

/* ------------------------------------------------------------------ */
/* MCP                                                                 */
/* ------------------------------------------------------------------ */

export type McpTransport = 'stdio' | 'http'
export type McpSource = 'manual' | 'market' | 'import'

export interface McpFieldValue {
  value: string
  redacted: boolean
  hasValue: boolean
}

export interface McpListItem extends AssetBase {
  kind: 'mcp'
  transport: McpTransport
  source: McpSource
  enabled: boolean
  isFavorite: boolean
  pendingChangeCount: number
  healthStatus: 'ok' | 'warning' | 'error'
}

export interface McpDetail extends AssetBase {
  kind: 'mcp'
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  env: Record<string, McpFieldValue>
  headers: Record<string, McpFieldValue>
  requiredEnv: string[]
  enabled: boolean
  isFavorite: boolean
  notes: string
  source: McpSource
  healthStatus: 'ok' | 'warning' | 'error'
  health: HealthIssue[]
}

export interface McpQuery extends PageRequest {
  search?: string
  folder?: string
  includeDescendants?: boolean
  tags?: string[]
  transport?: McpTransport
  enabled?: boolean
  favorite?: boolean
  healthStatus?: 'ok' | 'warning' | 'error'
  sort?: 'updated' | 'created' | 'title'
  order?: 'asc' | 'desc'
}

export interface McpCreateInput {
  requestId?: string
  title: string
  description?: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  requiredEnv?: string[]
  folder?: string
  tags?: string[]
  notes?: string
  source?: McpSource
}

export interface McpUpdateInput {
  id: string
  expectedRevisionId: string
  requestId?: string
  title?: string
  description?: string
  transport?: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string | null>
  headers?: Record<string, string | null>
  requiredEnv?: string[]
  folder?: string
  tags?: string[]
  notes?: string
  confirmClearSecrets?: boolean
}

export interface McpHealthResult {
  id: string
  status: 'ok' | 'warning' | 'error'
  issues: HealthIssue[]
  checkedAt: IsoTimestamp
}

export interface AgentMcpState {
  agentId: string
  agentName: string
  configPath: string
  exists: boolean
  format: 'json' | 'jsonc' | 'toml'
  servers: Array<{
    name: string
    transport: McpTransport
    managed: boolean
    drift: 'none' | 'modified' | 'unknown'
    redactedConfig: Record<string, unknown>
  }>
}

export interface McpImportInput {
  agentId: string
  serverNames: string[]
  confirm: boolean
  previewToken?: string
  requestId?: string
}

export interface McpImportPreview {
  phase: 'preview'
  agentId: string
  entries: Array<{
    name: string
    transport: McpTransport
    redactedConfig: Record<string, unknown>
    secretKeys: string[]
    warnings: string[]
  }>
  previewToken: string
}

export interface McpImportApplied {
  phase: 'applied'
  imported: McpDetail[]
  skipped: Array<{ name: string; reason: string }>
}

export type McpImportResult = McpImportPreview | McpImportApplied

export interface McpApplyInput {
  serverIds: string[]
  agentIds: string[]
  confirm: boolean
  previewToken?: string
  acknowledgePlaintextAtRest?: boolean
  requestId?: string
}

export interface McpApplyTarget {
  agentId: string
  agentName: string
  configPath: string
  format: 'json' | 'jsonc' | 'toml'
  entries: Array<{
    serverId: string
    serverName: string
    redactedEntry: Record<string, unknown>
    action: 'create' | 'update' | 'noop'
    drift: boolean
  }>
  warnings: string[]
}

export interface McpApplyPreview {
  phase: 'preview'
  targets: McpApplyTarget[]
  previewToken: string
}

export interface McpApplyResultItem {
  agentId: string
  serverId: string
  ok: boolean
  action: 'created' | 'updated' | 'removed' | 'noop'
  targetPath: string
  error?: IpcErrorPayload
}

export interface McpApplyOperationResult {
  results: McpApplyResultItem[]
}

export type McpApplyResult = McpApplyPreview | OperationRef

export interface McpRemoveInput {
  serverIds: string[]
  agentIds: string[]
  confirm: true
  requestId?: string
}

export interface McpRemoveOperationResult {
  results: McpApplyResultItem[]
}

export interface McpStoreItem {
  id: string
  name: string
  description: string
  whatItDoes: string
  useCases: string[]
  installCommand: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  envDocs: Array<{ key: string; description: string; placeholder: string }>
}

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
  url: string
  provider?: RepoProvider
  branch?: string
  localPath?: string
  cloneMode: 'managed' | 'bound'
  auth: RepoAuthInput
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

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export type DispatchStatus = 'synced' | 'stale' | 'drifted' | 'missing' | 'unsupported'

export interface DispatchAgent {
  id: string
  name: string
  detected: boolean
  supportsSkills: boolean
  supportsMcp: boolean
  skillDir?: string
  mcpFile?: string
}

export interface DispatchCell {
  assetId: string
  agentId: string
  status: DispatchStatus
  deploymentId?: string
  targetPath?: string
  mode?: InstallMode
  deployedVersion?: number
  deployedAt?: IsoTimestamp
  note?: string
}

export interface DispatchMatrixQuery {
  kinds?: Array<'skill' | 'mcp'>
  includeUndetected?: boolean
  onlyAnomalies?: boolean
  folder?: string
}

export interface DispatchMatrix {
  agents: DispatchAgent[]
  rows: Array<{
    assetId: string
    kind: 'skill' | 'mcp'
    title: string
    folder: string
    currentVersion: number
    cells: DispatchCell[]
  }>
  summary: {
    synced: number
    stale: number
    drifted: number
    missing: number
    unsupported: number
  }
}

export interface DeploymentSummary {
  id: string
  agentId: string
  mode: InstallMode
  status: Exclude<DispatchStatus, 'unsupported'>
  deployedVersion: number
  deployedAt: IsoTimestamp
  targetPath: string
}

export interface DispatchDetail {
  assetId: string
  kind: 'skill' | 'mcp'
  title: string
  currentVersion: number
  cells: DispatchCell[]
  history: DeploymentSummary[]
}

export interface DispatchInstallInput {
  assetId: string
  agentIds: string[]
  mode: InstallMode
  confirm: boolean
  previewToken?: string
  confirmOverwriteExternal?: boolean
  acknowledgeScripts?: boolean
  requestId?: string
}

export interface DispatchPreview {
  phase: 'preview'
  assetId: string
  agentIds: string[]
  mode: InstallMode
  risk: SyncRisk[]
  targets: Array<{
    agentId: string
    agentName: string
    targetPath: string
    action: 'create' | 'replace' | 'noop'
    conflict: 'none' | 'external' | 'drifted'
    files: SkillFileEntry[]
    warnings: string[]
  }>
  previewToken: string
}

export interface DispatchResultItem {
  agentId: string
  ok: boolean
  action: 'installed' | 'replaced' | 'removed' | 'rolled-back' | 'noop'
  targetPath: string
  error?: IpcErrorPayload
}

export interface DispatchOperationSummary {
  installed: number
  replaced: number
  removed: number
  rolledBack: number
  skippedDrifted: number
  failed: number
}

export type DispatchOperationResult =
  | {
      mode: 'install' | 'remove' | 'rollback'
      results: DispatchResultItem[]
      summary: DispatchOperationSummary
    }
  | { mode: 'sync-stale'; result: DispatchBatchResult }

export type DispatchInstallResult = DispatchPreview | OperationRef

export interface DispatchRemoveInput {
  assetId: string
  agentIds: string[]
  confirm: true
  requestId?: string
}

export interface DispatchRollbackInput {
  assetId: string
  agentIds: string[]
  requestId?: string
}

export interface DispatchSyncStaleInput {
  assetIds?: string[]
  agentIds?: string[]
  requestId?: string
}

export interface DispatchBatchResult {
  synced: number
  skippedDrifted: number
  failed: Array<{ assetId: string; agentId: string; code: IpcErrorCode; message: string }>
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface SearchQuery extends PageRequest {
  q: string
  kinds?: AssetKind[]
  folder?: string
  includeDescendants?: boolean
}

export interface SearchResultItem {
  assetId: string
  kind: AssetKind
  title: string
  path: string
  folder: string
  snippet: string
  rank: number
}

export interface SearchResultPage extends Page<SearchResultItem> {
  rebuilding: boolean
}

/* ------------------------------------------------------------------ */
/* Settings, data, updates                                             */
/* ------------------------------------------------------------------ */

export interface SettingsSnapshot {
  theme: ThemeMode
  effectiveTheme: 'light' | 'dark'
  density: Density
  repository: {
    autoFetch: boolean
    fetchIntervalMin: number
    policies: RepoPolicies
    pushMode: 'direct' | 'branch'
  }
  privacy: {
    telemetry: boolean
    dataDisclosureAcceptedAt?: IsoTimestamp
  }
  updates: {
    channel: 'stable' | 'beta'
    autoCheck: boolean
    lastCheckedAt?: IsoTimestamp
  }
  data: {
    locations: DataLocation[]
    storageBytes: {
      database: number
      blobs: number
      library: number
      backups: number
    }
  }
  ai: {
    configured: boolean
    providers: AiProviderInfo[]
  }
  app: {
    version: string
    buildId: string
    schemaVersion: number
    contractVersion: 1
  }
}

export interface SettingsUpdateInput {
  theme?: ThemeMode
  density?: Density
  privacy?: { telemetry?: boolean }
  updates?: { channel?: 'stable' | 'beta'; autoCheck?: boolean }
}

export interface SettingsBackupInput {
  includeLogs?: boolean
  requestId?: string
}

export interface RestoreInput {
  backupPath?: string
  pickFromDialog?: boolean
  confirm: boolean
  previewToken?: string
  requestId?: string
}

export interface RestorePreview {
  phase: 'preview'
  backupPath: string
  manifest: {
    appVersion: string
    schemaVersion: number
    createdAt: IsoTimestamp
    counts: Record<AssetKind, number>
    blobCount: number
    totalBytes: number
  }
  warnings: string[]
  previewToken: string
}

export type RestoreResult = RestorePreview | OperationRef

export interface ResetInput {
  scope: 'library' | 'all'
  confirm: boolean
  confirmationText?: string
  previewToken?: string
  requestId?: string
}

export interface ResetPreview {
  phase: 'preview'
  scope: 'library' | 'all'
  willDelete: {
    assets: number
    revisions: number
    blobs: number
    deployments: number
    projections: number
    settingsReset: boolean
    repositoryDisconnected: boolean
  }
  willKeep: {
    repositoryFiles: true
    userProvidedClone: true
    backups: boolean
  }
  requiredConfirmationText: string
  previewToken: string
}

export type ResetResult = ResetPreview | OperationRef

export interface DiagnosticExportResult {
  path: string
  sections: string[]
  redacted: true
}

export interface UpdateAvailable {
  version: string
  channel: 'stable' | 'beta'
  releaseNotes: string
  publishedAt: IsoTimestamp
  sizeBytes: number
}

export interface UpdateStatus {
  channel: 'stable' | 'beta'
  currentVersion: string
  available?: UpdateAvailable
  download?: {
    state: 'idle' | 'downloading' | 'downloaded' | 'installing' | 'failed'
    progress: number
    error?: IpcErrorPayload
  }
  lastCheckedAt?: IsoTimestamp
}

export interface UpdateInstallInput {
  version: string
  confirm: true
  requestId?: string
}

/* ------------------------------------------------------------------ */
/* AI test (P1)                                                        */
/* ------------------------------------------------------------------ */

export interface AiProviderInfo {
  id: string
  name: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyUpdatedAt?: IsoTimestamp
  isDefault: boolean
}

export interface AiProviderSaveInput {
  id?: string
  name: string
  baseUrl: string
  model: string
  apiKey?: string | null
  confirmClearKey?: boolean
  isDefault?: boolean
}

export interface AiTestInput {
  providerId: string
  model?: string
  promptId?: string
  systemPrompt: string
  userPrompt: string
  values: Record<string, string>
  acknowledgeDataDisclosure?: boolean
}

export interface AiStreamHandle {
  streamId: string
  startedAt: IsoTimestamp
}

export interface AiStreamEvent {
  streamId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: IpcErrorPayload
  at: IsoTimestamp
}

export interface AiTestRun {
  id: string
  providerId: string
  model: string
  promptId: string | null
  startedAt: IsoTimestamp
  durationMs: number
  status: 'completed' | 'cancelled' | 'failed'
  responsePreview: string
  errorCode?: IpcErrorCode
}

export interface AiHistoryQuery extends PageRequest {
  providerId?: string
  status?: 'completed' | 'cancelled' | 'failed'
}

/* ------------------------------------------------------------------ */
/* Events and operations                                               */
/* ------------------------------------------------------------------ */

export type DomainName =
  | 'prompts'
  | 'contracts'
  | 'skills'
  | 'mcp'
  | 'sync'
  | 'dispatch'
  | 'projections'
  | 'globalTargets'
  | 'settings'
  | 'search'
  | 'ai'

export type DomainChangeReason =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'synced'
  | 'reviewed'
  | 'dispatched'
  | 'projected'
  | 'drift'
  | 'reconciled'

export interface DomainChangedEvent {
  domain: DomainName
  reason: DomainChangeReason
  ids: string[]
  operationId?: string
  at: IsoTimestamp
}

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

export interface OperationProgressEvent {
  operationId: string
  type: OperationType
  phase: string
  completed: number
  total: number
  message?: string
  cancellable: boolean
  at: IsoTimestamp
}

export interface SyncProgressEvent extends OperationProgressEvent {
  repoId: string
  direction?: 'fetch' | 'pull' | 'push'
}

export type OperationResult =
  | { type: 'sync_fetch'; incoming: number; outgoing: number; conflicts: number }
  | { type: 'sync_pull'; applied: number; skipped: number; failed: number }
  | {
      type: 'sync_push'
      commit: string | null
      branch: string
      pushed: number
      failed: number
      compareUrl?: string
    }
  | { type: 'dispatch'; result: DispatchOperationResult }
  | { type: 'projection'; result: ProjectionOperationResult }
  | { type: 'mcp_apply'; result: McpApplyOperationResult }
  | { type: 'mcp_remove'; result: McpRemoveOperationResult }
  | { type: 'backup'; path: string; bytes: number }
  | { type: 'restore'; restored: boolean; safetyBackupPath: string }
  | { type: 'search_rebuild'; indexed: number }
  | { type: 'update_download'; version: string; path: string }
  | { type: 'update_install'; version: string }
  | { type: 'reset'; scope: 'library' | 'all' }

export interface OperationCompletedEvent {
  operationId: string
  type: OperationType
  state: 'committed' | 'failed' | 'cancelled'
  result?: OperationResult
  error?: IpcErrorPayload
  at: IsoTimestamp
}

export interface UpdateAvailableEvent {
  available: UpdateAvailable
  at: IsoTimestamp
}

/* ------------------------------------------------------------------ */
/* Canonical repository file models (shared with serializers)          */
/* ------------------------------------------------------------------ */

export interface PromptFileModel {
  id: string
  title: string
  description: string
  folder: string
  tags: string[]
  variables: PromptVariable[]
  syncPolicy: SyncPolicy
  systemPrompt: string
  userPrompt: string
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

export interface McpFileFieldValue {
  value: string
  secret: boolean
}

export interface McpFileModel {
  id: string
  title: string
  description: string
  folder: string
  tags: string[]
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  env: Record<string, McpFileFieldValue>
  headers: Record<string, McpFileFieldValue>
  requiredEnv: string[]
  enabled: boolean
  notes: string
}

export interface SkillFileModel {
  id: string
  title: string
  description: string
  folder: string
  tags: string[]
  versionLabel: string
  author: string
  category: string
  icon: string
  files: Array<{ path: string; content: string | null; mediaKind: 'text' | 'binary'; isExecutable: boolean }>
}
