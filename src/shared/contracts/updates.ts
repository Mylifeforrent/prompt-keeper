import type { IpcErrorPayload, IsoTimestamp } from './common'

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
