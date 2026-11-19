import type { AssetBase, AssetSyncState, IsoTimestamp, PageRequest, SyncPolicy } from './common'

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
