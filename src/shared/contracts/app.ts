import type { AssetKind, Density, IsoTimestamp, OperationRef, ThemeMode } from './common'
import type { RepoStatus } from './sync'

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
