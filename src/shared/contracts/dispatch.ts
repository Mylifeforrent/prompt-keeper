import type { IpcErrorCode, IpcErrorPayload, IsoTimestamp, OperationRef } from './common'
import type { InstallMode, SkillFileEntry } from './skills'
import type { SyncRisk } from './sync'

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
