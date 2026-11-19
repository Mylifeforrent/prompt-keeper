import type { AssetBase, HealthIssue, IpcErrorPayload, IsoTimestamp, OperationRef, PageRequest } from './common'

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
