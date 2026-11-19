import type { IpcErrorCode, IpcErrorPayload, IsoTimestamp, PageRequest } from './common'

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
