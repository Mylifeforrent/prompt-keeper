import type { AiProviderInfo } from './ai'
import type { DataLocation } from './app'
import type { AssetKind, Density, IsoTimestamp, OperationRef, ThemeMode } from './common'
import type { RepoPolicies } from './sync'

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
