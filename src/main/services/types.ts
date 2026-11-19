import type {
  AgentMcpState,
  AiHistoryQuery,
  AiProviderInfo,
  AiProviderSaveInput,
  AiStreamHandle,
  AiTestInput,
  AiTestRun,
  AssetListResult,
  AssetSyncPolicyResult,
  AuditEvent,
  BootstrapSnapshot,
  CancelResult,
  ConflictResolutionResult,
  ContractCompileInput,
  ContractCompileResult,
  ContractCreateInput,
  ContractDetail,
  ContractListItem,
  ContractQuery,
  ContractResolveInput,
  ContractTarget,
  ContractUpdateInput,
  DeleteInput,
  DeleteResult,
  DiagnosticExportResult,
  DispatchDetail,
  DispatchInstallInput,
  DispatchInstallResult,
  DispatchMatrix,
  DispatchMatrixQuery,
  DispatchRemoveInput,
  DispatchRollbackInput,
  DispatchSyncStaleInput,
  FavoriteResult,
  FolderNode,
  GlobalProjectionProjectInput,
  GlobalProjectionQuery,
  GlobalTargetDetail,
  GlobalTargetUpdateInput,
  GlobalTargetUpdateResult,
  McpApplyInput,
  McpApplyResult,
  McpCreateInput,
  McpDetail,
  McpHealthResult,
  McpImportInput,
  McpImportResult,
  McpListItem,
  McpQuery,
  McpRemoveInput,
  McpStoreItem,
  McpUpdateInput,
  OperationRef,
  Page,
  PinnedResult,
  ProjectionDetail,
  ProjectionOverwriteDriftInput,
  ProjectionProjectInput,
  ProjectionQuery,
  ProjectionRemoveResult,
  ProjectRemoveResult,
  ProjectRegisterInput,
  ProjectSummary,
  PromptCopyInput,
  PromptCopyResult,
  PromptCreateInput,
  PromptDetail,
  PromptFolderQuery,
  PromptListItem,
  PromptQuery,
  PromptStoreItem,
  PromptUpdateInput,
  RepoConnectInput,
  RepoConnectResult,
  RepoDisconnectInput,
  RepoDisconnectResult,
  RepoStatus,
  RepoUpdateInput,
  ResetInput,
  ResetResult,
  ResolvedPreview,
  RestoreInput,
  RestoreResult,
  RestoreVersionInput,
  RevisionSummary,
  RevealTarget,
  SearchQuery,
  SearchResultPage,
  SetFavoriteInput,
  SetPinnedInput,
  SetSyncPolicyInput,
  SettingsBackupInput,
  SettingsSnapshot,
  SettingsUpdateInput,
  SkillCreateInput,
  SkillDetail,
  SkillFilesInput,
  SkillFilesResult,
  SkillImportInput,
  SkillImportResult,
  SkillListItem,
  SkillQuery,
  SkillStoreItem,
  SkillUpdateInput,
  StoreQuery,
  SyncChangeDetail,
  SyncChangeQuery,
  SyncChangeSummary,
  SyncConflictResolveInput,
  SyncHistoryQuery,
  SyncPullInput,
  SyncPushInput,
  SyncReviewInput,
  SyncReviewResult,
  ThemeMode,
  ThemeUpdateResult,
  UpdateInstallInput,
  UpdateStatus,
} from '../../shared/contracts'

export interface PromptService {
  list(query: PromptQuery): Promise<AssetListResult<PromptListItem>>
  get(id: string): Promise<PromptDetail>
  versions(id: string): Promise<RevisionSummary[]>
  create(input: PromptCreateInput): Promise<PromptDetail>
  update(input: PromptUpdateInput): Promise<PromptDetail>
  delete(input: DeleteInput): Promise<DeleteResult>
  restore(input: { id: string }): Promise<PromptDetail>
  restoreVersion(input: RestoreVersionInput): Promise<PromptDetail>
  copyRender(input: PromptCopyInput): Promise<PromptCopyResult>
  setSyncPolicy(input: SetSyncPolicyInput): Promise<AssetSyncPolicyResult>
  setFavorite(input: SetFavoriteInput): Promise<FavoriteResult>
  setPinned(input: SetPinnedInput): Promise<PinnedResult>
  folders(query: PromptFolderQuery): Promise<FolderNode[]>
  storeList(query: StoreQuery): Promise<Page<PromptStoreItem>>
}

export interface ContractService {
  list(query: ContractQuery): Promise<AssetListResult<ContractListItem>>
  get(id: string): Promise<ContractDetail>
  versions(id: string): Promise<RevisionSummary[]>
  create(input: ContractCreateInput): Promise<ContractDetail>
  update(input: ContractUpdateInput): Promise<ContractDetail>
  delete(input: DeleteInput): Promise<DeleteResult>
  restore(input: { id: string }): Promise<ContractDetail>
  restoreVersion(input: RestoreVersionInput): Promise<ContractDetail>
  resolve(input: ContractResolveInput): Promise<ResolvedPreview>
  compile(input: ContractCompileInput): Promise<ContractCompileResult>
  setSyncPolicy(input: SetSyncPolicyInput): Promise<AssetSyncPolicyResult>
  targets(): Promise<ContractTarget[]>
}

export interface SkillService {
  list(query: SkillQuery): Promise<AssetListResult<SkillListItem>>
  get(id: string): Promise<SkillDetail>
  versions(id: string): Promise<RevisionSummary[]>
  files(input: SkillFilesInput): Promise<SkillFilesResult>
  create(input: SkillCreateInput): Promise<SkillDetail>
  update(input: SkillUpdateInput): Promise<SkillDetail>
  delete(input: DeleteInput): Promise<DeleteResult>
  restore(input: { id: string }): Promise<SkillDetail>
  restoreVersion(input: RestoreVersionInput): Promise<SkillDetail>
  import(input: SkillImportInput): Promise<SkillImportResult>
  storeList(query: StoreQuery): Promise<Page<SkillStoreItem>>
}

export interface McpService {
  list(query: McpQuery): Promise<AssetListResult<McpListItem>>
  get(id: string): Promise<McpDetail>
  versions(id: string): Promise<RevisionSummary[]>
  create(input: McpCreateInput): Promise<McpDetail>
  update(input: McpUpdateInput): Promise<McpDetail>
  delete(input: DeleteInput): Promise<DeleteResult>
  restore(input: { id: string }): Promise<McpDetail>
  restoreVersion(input: RestoreVersionInput): Promise<McpDetail>
  health(input: { id: string }): Promise<McpHealthResult>
  setEnabled(input: { id: string; enabled: boolean }): Promise<McpDetail>
  setFavorite(input: SetFavoriteInput): Promise<FavoriteResult>
  agentState(input: { agentIds?: string[] }): Promise<AgentMcpState[]>
  importExternal(input: McpImportInput): Promise<McpImportResult>
  apply(input: McpApplyInput): Promise<McpApplyResult>
  remove(input: McpRemoveInput): Promise<OperationRef>
  storeList(query: StoreQuery): Promise<Page<McpStoreItem>>
}

export interface ProjectionService {
  list(query: ProjectionQuery): Promise<Page<ProjectionDetail>>
  project(input: ProjectionProjectInput): Promise<OperationRef>
  reproject(input: { projectionId: string }): Promise<ProjectionDetail>
  remove(input: { projectionId: string; confirm: true }): Promise<ProjectionRemoveResult>
  rollback(input: { projectionId: string }): Promise<ProjectionDetail>
  overwriteDrift(input: ProjectionOverwriteDriftInput): Promise<ProjectionDetail>
  globalList(query: GlobalProjectionQuery): Promise<Page<ProjectionDetail>>
  globalProject(input: GlobalProjectionProjectInput): Promise<OperationRef>
  globalReproject(input: { projectionId: string }): Promise<ProjectionDetail>
  globalRemove(input: { projectionId: string; confirm: true }): Promise<ProjectionRemoveResult>
  globalRollback(input: { projectionId: string }): Promise<ProjectionDetail>
  globalOverwriteDrift(input: ProjectionOverwriteDriftInput): Promise<ProjectionDetail>
  globalTargets(): Promise<GlobalTargetDetail[]>
  updateGlobalPath(input: GlobalTargetUpdateInput): Promise<GlobalTargetUpdateResult>
  restoreGlobalDefault(input: { targetId: string }): Promise<GlobalTargetUpdateResult>
}

export interface SyncService {
  repoGet(): Promise<RepoStatus | null>
  repoConnect(input: RepoConnectInput): Promise<RepoConnectResult>
  repoDisconnect(input: RepoDisconnectInput): Promise<RepoDisconnectResult>
  repoUpdate(input: RepoUpdateInput): Promise<RepoStatus>
  fetch(input: { requestId?: string }): Promise<OperationRef>
  changes(query: SyncChangeQuery): Promise<Page<SyncChangeSummary>>
  changeDetail(input: { changeId: string }): Promise<SyncChangeDetail>
  review(input: SyncReviewInput): Promise<SyncReviewResult>
  pull(input: SyncPullInput): Promise<OperationRef>
  push(input: SyncPushInput): Promise<OperationRef>
  conflictResolve(input: SyncConflictResolveInput): Promise<ConflictResolutionResult>
  history(query: SyncHistoryQuery): Promise<Page<AuditEvent>>
  cancel(input: { operationId: string }): Promise<CancelResult>
}

export interface DispatchService {
  matrix(query: DispatchMatrixQuery): Promise<DispatchMatrix>
  detail(input: { assetId: string }): Promise<DispatchDetail>
  install(input: DispatchInstallInput): Promise<DispatchInstallResult>
  remove(input: DispatchRemoveInput): Promise<OperationRef>
  rollback(input: DispatchRollbackInput): Promise<OperationRef>
  syncStale(input: DispatchSyncStaleInput): Promise<OperationRef>
}

export interface SearchService {
  query(query: SearchQuery): Promise<SearchResultPage>
  rebuild(input: { requestId?: string }): Promise<OperationRef>
}

export interface SettingsService {
  get(): Promise<SettingsSnapshot>
  update(input: SettingsUpdateInput): Promise<SettingsSnapshot>
  backup(input: SettingsBackupInput): Promise<OperationRef>
  restore(input: RestoreInput): Promise<RestoreResult>
  reset(input: ResetInput): Promise<ResetResult>
  diagnostics(input: { requestId?: string }): Promise<DiagnosticExportResult>
}

export interface AiService {
  providers(): Promise<AiProviderInfo[]>
  providerSave(input: AiProviderSaveInput): Promise<AiProviderInfo>
  test(input: AiTestInput): Promise<AiStreamHandle>
  cancel(input: { streamId: string }): Promise<CancelResult>
  history(query: AiHistoryQuery): Promise<Page<AiTestRun>>
}

export interface UpdateService {
  check(): Promise<UpdateStatus>
  download(input: { requestId?: string }): Promise<OperationRef>
  install(input: UpdateInstallInput): Promise<OperationRef>
  status(): Promise<UpdateStatus>
}

export interface AppService {
  bootstrap(): Promise<BootstrapSnapshot>
  theme(input: { theme: ThemeMode }): Promise<ThemeUpdateResult>
  openExternal(input: { url: string }): Promise<void>
  revealPath(input: { target: RevealTarget }): Promise<void>
  projectsList(): Promise<ProjectSummary[]>
  projectsRegister(input: ProjectRegisterInput): Promise<ProjectSummary>
  projectsRemove(input: { projectId: string; confirm: true }): Promise<ProjectRemoveResult>
}

export interface Services {
  app: AppService
  prompts: PromptService
  contracts: ContractService
  skills: SkillService
  mcp: McpService
  projections: ProjectionService
  sync: SyncService
  dispatch: DispatchService
  search: SearchService
  settings: SettingsService
  ai: AiService
  updates: UpdateService
}
