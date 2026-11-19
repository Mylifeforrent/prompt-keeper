import type {
  AgentMcpState,
  AiHistoryQuery,
  AiProviderInfo,
  AiProviderSaveInput,
  AiStreamEvent,
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
  DomainChangedEvent,
  FavoriteResult,
  FolderNode,
  GlobalProjectionProjectInput,
  GlobalProjectionQuery,
  GlobalTargetDetail,
  GlobalTargetUpdateInput,
  GlobalTargetUpdateResult,
  IpcResult,
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
  OperationCompletedEvent,
  OperationProgressEvent,
  OperationRef,
  Page,
  PinnedResult,
  ProjectionDetail,
  ProjectionOperationResult,
  ProjectionOverwriteDriftInput,
  ProjectionProjectInput,
  ProjectionQuery,
  ProjectionRemoveResult,
  ProjectRemoveResult,
  ProjectSummary,
  ProjectRegisterInput,
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
  SyncProgressEvent,
  SyncPullInput,
  SyncPushInput,
  SyncReviewInput,
  SyncReviewResult,
  ThemeMode,
  ThemeUpdateResult,
  UpdateAvailableEvent,
  UpdateInstallInput,
  UpdateStatus,
} from './contracts'

/**
 * The frozen object exposed by the preload script at `window.promptKeeper`.
 * Method paths mirror docs/api-contract.md section 6 exactly.
 */
export interface PromptKeeperBridge {
  app: {
    bootstrap(): Promise<IpcResult<BootstrapSnapshot>>
    theme(input: { theme: ThemeMode }): Promise<IpcResult<ThemeUpdateResult>>
    openExternal(input: { url: string }): Promise<IpcResult<void>>
    revealPath(input: { target: RevealTarget }): Promise<IpcResult<void>>
  }
  projects: {
    list(): Promise<IpcResult<ProjectSummary[]>>
    register(input: ProjectRegisterInput): Promise<IpcResult<ProjectSummary>>
    remove(input: { projectId: string; confirm: true }): Promise<IpcResult<ProjectRemoveResult>>
  }
  prompts: {
    list(query: PromptQuery): Promise<IpcResult<AssetListResult<PromptListItem>>>
    get(id: string): Promise<IpcResult<PromptDetail>>
    versions(id: string): Promise<IpcResult<RevisionSummary[]>>
    create(input: PromptCreateInput): Promise<IpcResult<PromptDetail>>
    update(input: PromptUpdateInput): Promise<IpcResult<PromptDetail>>
    delete(input: DeleteInput): Promise<IpcResult<DeleteResult>>
    restore(input: { id: string }): Promise<IpcResult<PromptDetail>>
    restoreVersion(input: RestoreVersionInput): Promise<IpcResult<PromptDetail>>
    copyRender(input: PromptCopyInput): Promise<IpcResult<PromptCopyResult>>
    setSyncPolicy(input: SetSyncPolicyInput): Promise<IpcResult<AssetSyncPolicyResult>>
    setFavorite(input: SetFavoriteInput): Promise<IpcResult<FavoriteResult>>
    setPinned(input: SetPinnedInput): Promise<IpcResult<PinnedResult>>
    folders(query: PromptFolderQuery): Promise<IpcResult<FolderNode[]>>
    storeList(query: StoreQuery): Promise<IpcResult<Page<PromptStoreItem>>>
  }
  targets: {
    list(): Promise<IpcResult<ContractTarget[]>>
  }
  contracts: {
    list(query: ContractQuery): Promise<IpcResult<AssetListResult<ContractListItem>>>
    get(id: string): Promise<IpcResult<ContractDetail>>
    versions(id: string): Promise<IpcResult<RevisionSummary[]>>
    create(input: ContractCreateInput): Promise<IpcResult<ContractDetail>>
    update(input: ContractUpdateInput): Promise<IpcResult<ContractDetail>>
    delete(input: DeleteInput): Promise<IpcResult<DeleteResult>>
    restore(input: { id: string }): Promise<IpcResult<ContractDetail>>
    restoreVersion(input: RestoreVersionInput): Promise<IpcResult<ContractDetail>>
    resolve(input: ContractResolveInput): Promise<IpcResult<ResolvedPreview>>
    compile(input: ContractCompileInput): Promise<IpcResult<ContractCompileResult>>
    setSyncPolicy(input: SetSyncPolicyInput): Promise<IpcResult<AssetSyncPolicyResult>>
  }
  projections: {
    list(query: ProjectionQuery): Promise<IpcResult<Page<ProjectionDetail>>>
    project(input: ProjectionProjectInput): Promise<IpcResult<OperationRef>>
    reproject(input: { projectionId: string }): Promise<IpcResult<ProjectionDetail>>
    remove(input: { projectionId: string; confirm: true }): Promise<IpcResult<ProjectionRemoveResult>>
    rollback(input: { projectionId: string }): Promise<IpcResult<ProjectionDetail>>
    overwriteDrift(input: ProjectionOverwriteDriftInput): Promise<IpcResult<ProjectionDetail>>
  }
  globalProjections: {
    list(query: GlobalProjectionQuery): Promise<IpcResult<Page<ProjectionDetail>>>
    project(input: GlobalProjectionProjectInput): Promise<IpcResult<OperationRef>>
    reproject(input: { projectionId: string }): Promise<IpcResult<ProjectionDetail>>
    remove(input: { projectionId: string; confirm: true }): Promise<IpcResult<ProjectionRemoveResult>>
    rollback(input: { projectionId: string }): Promise<IpcResult<ProjectionDetail>>
    overwriteDrift(input: ProjectionOverwriteDriftInput): Promise<IpcResult<ProjectionDetail>>
  }
  globalTargets: {
    list(): Promise<IpcResult<GlobalTargetDetail[]>>
    updatePath(input: GlobalTargetUpdateInput): Promise<IpcResult<GlobalTargetUpdateResult>>
    restoreDefault(input: { targetId: string }): Promise<IpcResult<GlobalTargetUpdateResult>>
  }
  skills: {
    list(query: SkillQuery): Promise<IpcResult<AssetListResult<SkillListItem>>>
    get(id: string): Promise<IpcResult<SkillDetail>>
    versions(id: string): Promise<IpcResult<RevisionSummary[]>>
    files(input: SkillFilesInput): Promise<IpcResult<SkillFilesResult>>
    create(input: SkillCreateInput): Promise<IpcResult<SkillDetail>>
    update(input: SkillUpdateInput): Promise<IpcResult<SkillDetail>>
    delete(input: DeleteInput): Promise<IpcResult<DeleteResult>>
    restore(input: { id: string }): Promise<IpcResult<SkillDetail>>
    restoreVersion(input: RestoreVersionInput): Promise<IpcResult<SkillDetail>>
    import(input: SkillImportInput): Promise<IpcResult<SkillImportResult>>
    storeList(query: StoreQuery): Promise<IpcResult<Page<SkillStoreItem>>>
  }
  mcp: {
    list(query: McpQuery): Promise<IpcResult<AssetListResult<McpListItem>>>
    get(id: string): Promise<IpcResult<McpDetail>>
    versions(id: string): Promise<IpcResult<RevisionSummary[]>>
    create(input: McpCreateInput): Promise<IpcResult<McpDetail>>
    update(input: McpUpdateInput): Promise<IpcResult<McpDetail>>
    delete(input: DeleteInput): Promise<IpcResult<DeleteResult>>
    restore(input: { id: string }): Promise<IpcResult<McpDetail>>
    restoreVersion(input: RestoreVersionInput): Promise<IpcResult<McpDetail>>
    health(input: { id: string }): Promise<IpcResult<McpHealthResult>>
    setEnabled(input: { id: string; enabled: boolean }): Promise<IpcResult<McpDetail>>
    setFavorite(input: SetFavoriteInput): Promise<IpcResult<FavoriteResult>>
    agentState(input: { agentIds?: string[] }): Promise<IpcResult<AgentMcpState[]>>
    importExternal(input: McpImportInput): Promise<IpcResult<McpImportResult>>
    apply(input: McpApplyInput): Promise<IpcResult<McpApplyResult>>
    remove(input: McpRemoveInput): Promise<IpcResult<OperationRef>>
    storeList(query: StoreQuery): Promise<IpcResult<Page<McpStoreItem>>>
  }
  sync: {
    repoGet(): Promise<IpcResult<RepoStatus | null>>
    repoConnect(input: RepoConnectInput): Promise<IpcResult<RepoConnectResult>>
    repoDisconnect(input: RepoDisconnectInput): Promise<IpcResult<RepoDisconnectResult>>
    repoUpdate(input: RepoUpdateInput): Promise<IpcResult<RepoStatus>>
    fetch(input: { requestId?: string }): Promise<IpcResult<OperationRef>>
    changes(query: SyncChangeQuery): Promise<IpcResult<Page<SyncChangeSummary>>>
    changeDetail(input: { changeId: string }): Promise<IpcResult<SyncChangeDetail>>
    review(input: SyncReviewInput): Promise<IpcResult<SyncReviewResult>>
    pull(input: SyncPullInput): Promise<IpcResult<OperationRef>>
    push(input: SyncPushInput): Promise<IpcResult<OperationRef>>
    conflictResolve(input: SyncConflictResolveInput): Promise<IpcResult<ConflictResolutionResult>>
    history(query: SyncHistoryQuery): Promise<IpcResult<Page<AuditEvent>>>
    cancel(input: { operationId: string }): Promise<IpcResult<CancelResult>>
  }
  dispatch: {
    matrix(query: DispatchMatrixQuery): Promise<IpcResult<DispatchMatrix>>
    detail(input: { assetId: string }): Promise<IpcResult<DispatchDetail>>
    install(input: DispatchInstallInput): Promise<IpcResult<DispatchInstallResult>>
    remove(input: DispatchRemoveInput): Promise<IpcResult<OperationRef>>
    rollback(input: DispatchRollbackInput): Promise<IpcResult<OperationRef>>
    syncStale(input: DispatchSyncStaleInput): Promise<IpcResult<OperationRef>>
  }
  search: {
    query(query: SearchQuery): Promise<IpcResult<SearchResultPage>>
    rebuild(input: { requestId?: string }): Promise<IpcResult<OperationRef>>
  }
  settings: {
    get(): Promise<IpcResult<SettingsSnapshot>>
    update(input: SettingsUpdateInput): Promise<IpcResult<SettingsSnapshot>>
    backup(input: SettingsBackupInput): Promise<IpcResult<OperationRef>>
    restore(input: RestoreInput): Promise<IpcResult<RestoreResult>>
    reset(input: ResetInput): Promise<IpcResult<ResetResult>>
    diagnostics(input: { requestId?: string }): Promise<IpcResult<DiagnosticExportResult>>
  }
  updates: {
    check(): Promise<IpcResult<UpdateStatus>>
    download(input: { requestId?: string }): Promise<IpcResult<OperationRef>>
    install(input: UpdateInstallInput): Promise<IpcResult<OperationRef>>
    status(): Promise<IpcResult<UpdateStatus>>
  }
  ai: {
    providers(): Promise<IpcResult<AiProviderInfo[]>>
    providerSave(input: AiProviderSaveInput): Promise<IpcResult<AiProviderInfo>>
    test(input: AiTestInput): Promise<IpcResult<AiStreamHandle>>
    cancel(input: { streamId: string }): Promise<IpcResult<CancelResult>>
    history(query: AiHistoryQuery): Promise<IpcResult<Page<AiTestRun>>>
  }
  events: {
    onDomainChanged(listener: (event: DomainChangedEvent) => void): () => void
    onOperationProgress(listener: (event: OperationProgressEvent) => void): () => void
    onOperationCompleted(listener: (event: OperationCompletedEvent) => void): () => void
    onSyncProgress(listener: (event: SyncProgressEvent) => void): () => void
    onUpdateAvailable(listener: (event: UpdateAvailableEvent) => void): () => void
    onAiStream(listener: (event: AiStreamEvent) => void): () => void
  }
}

export type { ProjectionOperationResult }
