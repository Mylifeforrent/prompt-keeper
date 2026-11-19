import type { IpcErrorPayload, IsoTimestamp, OperationType } from './common'
import type { DispatchOperationResult } from './dispatch'
import type { ProjectionOperationResult } from './instructions'
import type { McpApplyOperationResult, McpRemoveOperationResult } from './mcp'
import type { UpdateAvailable } from './updates'

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
