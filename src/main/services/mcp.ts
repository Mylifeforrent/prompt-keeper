import type {
  AgentMcpState,
  AssetListResult,
  DeleteInput,
  DeleteResult,
  FavoriteResult,
  HealthIssue,
  IpcErrorPayload,
  McpApplyInput,
  McpApplyPreview,
  McpApplyResult,
  McpApplyResultItem,
  McpApplyTarget,
  McpCreateInput,
  McpDetail,
  McpFieldValue,
  McpFileFieldValue,
  McpFileModel,
  McpHealthResult,
  McpImportApplied,
  McpImportInput,
  McpImportPreview,
  McpImportResult,
  McpListItem,
  McpQuery,
  McpRemoveInput,
  McpSource,
  McpStoreItem,
  McpTransport,
  McpUpdateInput,
  OperationRef,
  Page,
  RestoreVersionInput,
  RevisionSummary,
  SetFavoriteInput,
  StoreQuery,
} from '../../shared/contracts'
import { AppError, isAppError, validationError } from '../../shared/domain/errors'
import { buildFolderTree, folderInScope, normalizeFolder, validateFolder } from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import {
  checkMcpHealth,
  healthStatus,
  isPlaceholder,
  isSecretKey,
  parseMcpFile,
  serializeMcpFile,
} from '../../shared/domain/mcpFile'
import { AGENT_DEFS, agentConfigFormat } from '../../shared/domain/targets'
import type { AppContext } from '../context'
import { sha256Hex } from '../adapters/hash'
import { pathExists, readTextIfExists, writeAtomic } from '../adapters/fs'
import {
  detectConfigFormat,
  readConfig,
  readConfigText,
  removeEntry,
  stableStringify,
  writeMerge,
  type McpConfigFormat,
  type McpConfigMergeEntry,
  type McpConfigReadResult,
  type McpConfigRootKey,
} from '../adapters/mcpConfig'
import type { OperationContext } from '../operations'
import { expandUserPath } from '../paths'
import type { AssetRecord } from './assetStore'
import { assetBase, recordLocalChange, withdrawPendingChanges } from './assetSyncState'
import type { McpService } from './types'

const SECRET_REDACTED = '[REDACTED]'
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const REVISION_CONTENT_LIMIT = 256 * 1024

type SecretOwner = 'mcp_env' | 'mcp_header'
type StoredFieldValue = string | { $secret: string }

interface McpRow {
  asset_id: string
  transport: McpTransport
  command: string | null
  args_json: string
  url: string | null
  env_json: string
  headers_json: string
  required_env_json: string
  enabled: number
  is_favorite: number
  notes: string
  health_json: string
}

interface DeploymentRow {
  id: string
  asset_id: string
  asset_kind: string
  agent_id: string
  mode: 'symlink' | 'copy'
  status: 'synced' | 'stale' | 'drifted' | 'missing'
  target_path: string
  deployed_revision_id: string | null
  previous_revision_id: string | null
  manifest_hash: string
  managed_keys_json: string
  deployed_at: string
  note: string | null
}

interface ApplyServer {
  asset: AssetRecord
  row: McpRow
  revision: { id: string; version: number }
}

interface AgentTarget {
  agentId: string
  agentName: string
  configPath: string
  format: McpConfigFormat
  rootKey?: McpConfigRootKey
}

interface AgentConfigSnapshot {
  text: string
  format: McpConfigFormat
  read: McpConfigReadResult
  exists: boolean
}

interface ParsedExternalServer {
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  env: Record<string, string>
  headers: Record<string, string>
  description: string
  warnings: string[]
}

interface ImportScan {
  name: string
  transport: McpTransport
  redactedConfig: Record<string, unknown>
  secretKeys: string[]
  warnings: string[]
  config: ParsedExternalServer
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
}

function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function parseStoredFields(json: string): Record<string, StoredFieldValue> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return {}
  }
  if (!isPlainObject(parsed)) return {}
  const fields: Record<string, StoredFieldValue> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      fields[key] = value
    } else if (isPlainObject(value) && typeof value['$secret'] === 'string') {
      fields[key] = { $secret: value['$secret'] }
    }
  }
  return fields
}

function isMcpSecretField(key: string): boolean {
  return key.toLowerCase() === 'authorization' || isSecretKey(key)
}

function readMcpRow(ctx: AppContext, assetId: string): McpRow {
  const row = ctx.db.prepare('SELECT * FROM mcp_servers WHERE asset_id = ?').get(assetId) as
    | McpRow
    | undefined
  if (!row) throw new AppError('CORRUPT', 'The MCP server record is missing. Restore it from a backup.')
  return row
}

function requireMcpAsset(ctx: AppContext, assetId: string): AssetRecord {
  const asset = ctx.assets.getAsset(assetId)
  if (asset.kind !== 'mcp') throw new AppError('NOT_FOUND', 'This MCP server no longer exists.')
  return asset
}

function revisionConflictAt(current: { id: string; version: number }, updatedAt: string): AppError {
  return new AppError('REVISION_CONFLICT', 'This server changed after the editor was opened.', {
    kind: 'revision-conflict',
    currentRevisionId: current.id,
    currentVersion: current.version,
    updatedAt,
  })
}

function assertSecretsAvailable(ctx: AppContext, needed: boolean): void {
  if (!needed) return
  if (!ctx.secrets.available()) {
    throw new AppError(
      'UNSUPPORTED',
      ctx.secrets.reason() ?? 'Operating-system secret encryption is unavailable. Secrets cannot be stored.',
      { kind: 'unsupported', feature: 'safeStorage', reason: ctx.secrets.reason() ?? 'unavailable' },
    )
  }
}

function assertDecryptable(ctx: AppContext, servers: ApplyServer[]): void {
  const hasSecrets = servers.some(
    (server) =>
      ctx.secrets.listKeys('mcp_env', server.asset.id).length > 0 ||
      ctx.secrets.listKeys('mcp_header', server.asset.id).length > 0,
  )
  assertSecretsAvailable(ctx, hasSecrets)
}

function asMcpSource(value: string): McpSource {
  return value === 'market' || value === 'import' ? value : 'manual'
}

function dtoFields(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  stored: Record<string, StoredFieldValue>,
): Record<string, McpFieldValue> {
  const fields: Record<string, McpFieldValue> = {}
  for (const [key, value] of Object.entries(stored)) {
    // Classification is key-name based as well as shape based. A secret-looking
    // key imported from a repository may be stored as a placeholder string.
    const secret = typeof value !== 'string' || isMcpSecretField(key)
    if (!secret) {
      fields[key] = { value, redacted: false, hasValue: value !== '' }
    } else if (
      ctx.secrets.has(ownerType, assetId, key) ||
      (typeof value === 'string' && value !== '' && !isPlaceholder(value))
    ) {
      // Legacy plaintext values under secret-looking keys are hidden too.
      fields[key] = { value: SECRET_REDACTED, redacted: true, hasValue: true }
    } else {
      fields[key] = { value: '', redacted: false, hasValue: false }
    }
  }
  return fields
}

function fileFields(stored: Record<string, StoredFieldValue>): Record<string, McpFileFieldValue> {
  const fields: Record<string, McpFileFieldValue> = {}
  for (const [key, value] of Object.entries(stored)) {
    fields[key] = typeof value === 'string' ? { value, secret: false } : { value: '', secret: true }
  }
  return fields
}

function canonicalModel(
  ctx: AppContext,
  asset: AssetRecord,
  row: McpRow,
  env: Record<string, StoredFieldValue>,
  headers: Record<string, StoredFieldValue>,
): McpFileModel {
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    folder: asset.folder,
    tags: ctx.assets.tags(asset.id),
    transport: row.transport,
    args: row.transport === 'stdio' ? parseStringArray(row.args_json) : [],
    ...(row.transport === 'stdio' ? { command: row.command ?? '' } : { url: row.url ?? '' }),
    env: fileFields(env),
    headers: fileFields(headers),
    requiredEnv: parseStringArray(row.required_env_json),
    enabled: !!row.enabled,
    notes: row.notes,
  }
}

function healthIssues(
  row: Pick<McpRow, 'transport' | 'command' | 'url' | 'required_env_json'>,
  env: Record<string, McpFieldValue>,
  headers: Record<string, McpFieldValue>,
): HealthIssue[] {
  return checkMcpHealth({
    transport: row.transport,
    command: row.command ?? undefined,
    url: row.url ?? undefined,
    env,
    headers,
    requiredEnv: parseStringArray(row.required_env_json),
  })
}

function detailFrom(ctx: AppContext, asset: AssetRecord): McpDetail {
  const row = readMcpRow(ctx, asset.id)
  const envStored = parseStoredFields(row.env_json)
  const headersStored = parseStoredFields(row.headers_json)
  const env = dtoFields(ctx, asset.id, 'mcp_env', envStored)
  const headers = dtoFields(ctx, asset.id, 'mcp_header', headersStored)
  const issues = healthIssues(row, env, headers)
  return {
    ...assetBase(ctx, asset),
    kind: 'mcp',
    transport: row.transport,
    ...(row.command ? { command: row.command } : {}),
    args: parseStringArray(row.args_json),
    ...(row.url ? { url: row.url } : {}),
    env,
    headers,
    requiredEnv: parseStringArray(row.required_env_json),
    enabled: !!row.enabled,
    isFavorite: !!row.is_favorite,
    notes: row.notes,
    source: asMcpSource(asset.source),
    healthStatus: healthStatus(issues),
    health: issues,
  }
}

function listItemFrom(ctx: AppContext, asset: AssetRecord, row: McpRow): McpListItem {
  const env = dtoFields(ctx, asset.id, 'mcp_env', parseStoredFields(row.env_json))
  const headers = dtoFields(ctx, asset.id, 'mcp_header', parseStoredFields(row.headers_json))
  const issues = healthIssues(row, env, headers)
  return {
    ...assetBase(ctx, asset),
    kind: 'mcp',
    transport: row.transport,
    source: asMcpSource(asset.source),
    enabled: !!row.enabled,
    isFavorite: !!row.is_favorite,
    pendingChangeCount: ctx.assets.pendingChangeCount(asset.id),
    healthStatus: healthStatus(issues),
  }
}

/** Newest first with bounded text content so the renderer can review a version. */
function revisionSummaries(ctx: AppContext, assetId: string): RevisionSummary[] {
  return ctx.assets.versions(assetId).map((revision) => ({
    id: revision.id,
    version: revision.version,
    note: revision.note,
    manifestHash: revision.manifestHash,
    createdAt: revision.createdAt,
    files: revisionFileContents(ctx, revision.id),
  }))
}

function revisionFileContents(ctx: AppContext, revisionId: string): Array<{ path: string; content: string | null }> {
  return ctx.assets.revisionFiles(revisionId).map((file) => {
    if (file.mediaKind !== 'text' || file.size > REVISION_CONTENT_LIMIT) {
      return { path: file.path, content: null }
    }
    try {
      return { path: file.path, content: ctx.blobs.readSync(file.blobHash).toString('utf8') }
    } catch {
      return { path: file.path, content: null }
    }
  })
}

function markDeploymentsStale(ctx: AppContext, assetId: string): number {
  const result = ctx.db
    .prepare("UPDATE deployments SET status = 'stale' WHERE asset_id = ? AND status = 'synced'")
    .run(assetId)
  return result.changes
}

function ftsExpression(search: string): string | null {
  const terms = search
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["*:^()]/g, '').trim())
    .filter(Boolean)
  if (!terms.length) return null
  return terms.map((term) => `"${term}"*`).join(' AND ')
}

function matchingMcpIds(ctx: AppContext, query: McpQuery): string[] {
  const baseWhere: string[] = ["a.kind = 'mcp'", 'a.deleted_at IS NULL', 'm.asset_id = a.id']
  const filterParams: unknown[] = []
  if (query.transport) {
    baseWhere.push('m.transport = ?')
    filterParams.push(query.transport)
  }
  if (query.enabled !== undefined) {
    baseWhere.push('m.enabled = ?')
    filterParams.push(query.enabled ? 1 : 0)
  }
  if (query.favorite !== undefined) {
    baseWhere.push('m.is_favorite = ?')
    filterParams.push(query.favorite ? 1 : 0)
  }
  for (const tag of uniqueStrings(query.tags)) {
    baseWhere.push('EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = a.id AND t.tag = ?)')
    filterParams.push(tag)
  }

  const search = query.search?.trim() ?? ''
  const expression = search ? ftsExpression(search) : null
  if (expression) {
    try {
      return (
        ctx.db
          .prepare(
            `SELECT a.id AS id FROM assets a, mcp_servers m WHERE ${baseWhere.join(' AND ')} AND a.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?)`,
          )
          .all(...filterParams, expression) as Array<{ id: string }>
      ).map((row) => row.id)
    } catch {
      // Fall through to a LIKE search when the FTS query is malformed.
    }
  }
  const likeValues = search ? [`%${search.replace(/[%_]/g, ' ')}%`] : []
  const where = [...baseWhere]
  if (search) where.push('(a.title LIKE ? OR a.description LIKE ?)')
  return (
    ctx.db
      .prepare(`SELECT a.id AS id FROM assets a, mcp_servers m WHERE ${where.join(' AND ')}`)
      .all(...filterParams, ...(likeValues.length ? [likeValues[0], likeValues[0]] : [])) as Array<{ id: string }>
  ).map((row) => row.id)
}

function sortMcpItems(items: McpListItem[], sort: McpQuery['sort'], order: McpQuery['order']): McpListItem[] {
  const direction = order === 'asc' ? 1 : -1
  const key = sort ?? 'updated'
  return [...items].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title) * direction
    if (key === 'created') return (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) * direction
    return (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0) * direction
  })
}

/* ------------------------------------------------------------------ */
/* Write helpers                                                       */
/* ------------------------------------------------------------------ */

function normalizeCreateFields(value: Record<string, string> | undefined, label: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isPlainObject(value)) throw validationError(`${label} must be an object of string values.`)
  const fields: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw validationError(`${label}.${key} must be a string.`)
    }
    const name = key.trim()
    if (!name) throw validationError(`${label} contains an empty key.`)
    fields[name] = entry
  }
  return fields
}

function normalizePatchFields(
  value: Record<string, string | null> | undefined,
  label: string,
): Record<string, string | null> | null {
  if (value === undefined) return null
  if (!isPlainObject(value)) throw validationError(`${label} must be an object of string or null values.`)
  const fields: Record<string, string | null> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry !== 'string') {
      throw validationError(`${label}.${key} must be a string or null.`)
    }
    const name = key.trim()
    if (!name) throw validationError(`${label} contains an empty key.`)
    fields[name] = entry
  }
  return fields
}

function assertHeaderNames(fields: Record<string, unknown>): void {
  for (const key of Object.keys(fields)) {
    if (!HEADER_NAME_RE.test(key)) throw validationError(`The header name "${key}" is not valid.`)
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (tags === undefined) return []
  if (!Array.isArray(tags)) throw validationError('Tags must be an array of strings.')
  return [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))]
}

function normalizeArgs(args: string[] | undefined): string[] {
  if (args === undefined) return []
  if (!Array.isArray(args)) throw validationError('Arguments must be an array of strings.')
  return args.filter((arg): arg is string => typeof arg === 'string')
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function validateTransportFields(transport: McpTransport, command: string | undefined, url: string | undefined): void {
  if (transport === 'stdio') {
    if (!command?.trim()) throw validationError('A stdio server needs a command.')
    return
  }
  const value = url?.trim() ?? ''
  if (!value) throw validationError('An HTTP server needs a URL.')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw validationError('The URL is not valid.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validationError('The URL must use http or https.')
  }
}

function pendingSecretWrites(env: Record<string, string>, headers: Record<string, string>): boolean {
  const hasEnv = Object.entries(env).some(
    ([key, value]) => isMcpSecretField(key) && value !== '' && !isPlaceholder(value),
  )
  const hasHeaders = Object.entries(headers).some(
    ([key, value]) => isMcpSecretField(key) && value !== '' && !isPlaceholder(value),
  )
  return hasEnv || hasHeaders
}

function buildCreateFields(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  values: Record<string, string>,
): Record<string, StoredFieldValue> {
  const fields: Record<string, StoredFieldValue> = {}
  for (const [key, value] of Object.entries(values)) {
    if (isMcpSecretField(key)) {
      if (value !== '' && !isPlaceholder(value)) ctx.secrets.set(ownerType, assetId, key, value)
      fields[key] = { $secret: key }
    } else {
      fields[key] = value
    }
  }
  return fields
}

function hasStoredSecretValue(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  key: string,
  stored: StoredFieldValue | undefined,
): boolean {
  if (ctx.secrets.has(ownerType, assetId, key)) return true
  return (
    typeof stored === 'string' &&
    isMcpSecretField(key) &&
    stored !== '' &&
    !isPlaceholder(stored)
  )
}

function patchStoredFields(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  current: Record<string, StoredFieldValue>,
  patch: Record<string, string | null>,
  confirmClearSecrets: boolean,
): { fields: Record<string, StoredFieldValue>; secretsChanged: boolean } {
  const next: Record<string, StoredFieldValue> = { ...current }
  let clearsSecret = false
  for (const [key, value] of Object.entries(patch)) {
    if (!isMcpSecretField(key)) continue
    const clears = value === null || value === '' || isPlaceholder(value)
    if (clears && hasStoredSecretValue(ctx, assetId, ownerType, key, current[key])) clearsSecret = true
  }
  if (clearsSecret && !confirmClearSecrets) {
    throw validationError('Clearing a stored secret requires confirmClearSecrets: true.')
  }

  let secretsChanged = false
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (isMcpSecretField(key) && ctx.secrets.has(ownerType, assetId, key)) {
        ctx.secrets.delete(ownerType, assetId, key)
        secretsChanged = true
      }
      if (typeof next[key] === 'string' && isMcpSecretField(key) && next[key] !== '') {
        secretsChanged = true
      }
      delete next[key]
      continue
    }
    if (isMcpSecretField(key)) {
      if (value === '' || isPlaceholder(value)) {
        if (ctx.secrets.has(ownerType, assetId, key)) {
          ctx.secrets.delete(ownerType, assetId, key)
          secretsChanged = true
        }
        if (typeof next[key] === 'string' && next[key] !== '') secretsChanged = true
        next[key] = { $secret: key }
        continue
      }
      if (value === SECRET_REDACTED) {
        throw validationError(
          'The redacted placeholder is not a value. Omit the key to keep the stored secret or send a new value.',
        )
      }
      const existing = ctx.secrets.has(ownerType, assetId, key) ? ctx.secrets.get(ownerType, assetId, key) : null
      if (existing !== value) {
        ctx.secrets.set(ownerType, assetId, key, value)
        secretsChanged = true
      }
      next[key] = { $secret: key }
      continue
    }
    if (next[key] !== value) {
      next[key] = value
    }
  }
  return { fields: next, secretsChanged }
}

function restoreStoredFields(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  snapshot: Record<string, McpFileFieldValue>,
): Record<string, StoredFieldValue> {
  const fields: Record<string, StoredFieldValue> = {}
  for (const key of ctx.secrets.listKeys(ownerType, assetId)) {
    if (!(key in snapshot) || !snapshot[key].secret) {
      ctx.secrets.delete(ownerType, assetId, key)
    }
  }
  for (const [key, field] of Object.entries(snapshot)) {
    if (field.secret) {
      fields[key] = { $secret: key }
    } else {
      fields[key] = field.value
    }
  }
  return fields
}

function createMcpRecord(ctx: AppContext, input: McpCreateInput): string {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw validationError('A title is required.', [{ path: 'title', message: 'Required.' }])
  if (input.transport !== 'stdio' && input.transport !== 'http') {
    throw validationError('The transport must be "stdio" or "http".')
  }
  const folder = normalizeFolder(input.folder)
  const folderError = validateFolder(folder)
  if (folderError) throw validationError(folderError, [{ path: 'folder', message: folderError }])
  const args = normalizeArgs(input.args)
  const tags = normalizeTags(input.tags)
  const requiredEnv = uniqueStrings(input.requiredEnv)
  const env = normalizeCreateFields(input.env, 'env')
  const headers = normalizeCreateFields(input.headers, 'headers')
  assertHeaderNames(headers)
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  validateTransportFields(input.transport, command, url)
  assertSecretsAvailable(ctx, pendingSecretWrites(env, headers))

  const assetId = newId('ast')
  const slug = ctx.assets.allocateSlug('mcp', folder, title)
  const notes = textValue(input.notes, '')
  const description = textValue(input.description, '')
  const source = input.source === 'market' || input.source === 'import' ? input.source : 'manual'

  const tx = ctx.db.transaction(() => {
    const envStored = buildCreateFields(ctx, assetId, 'mcp_env', env)
    const headersStored = buildCreateFields(ctx, assetId, 'mcp_header', headers)
    const provisional: McpFileModel = {
      id: assetId,
      title,
      description,
      folder,
      tags,
      transport: input.transport,
      args: input.transport === 'stdio' ? args : [],
      ...(input.transport === 'stdio' ? { command } : { url }),
      env: fileFields(envStored),
      headers: fileFields(headersStored),
      requiredEnv,
      enabled: true,
      notes,
    }
    const issues = healthIssues(
      {
        transport: input.transport,
        command: input.transport === 'stdio' ? command : null,
        url: input.transport === 'http' ? url : null,
        required_env_json: JSON.stringify(requiredEnv),
      },
      dtoFields(ctx, assetId, 'mcp_env', envStored),
      dtoFields(ctx, assetId, 'mcp_header', headersStored),
    )
    ctx.assets.createAsset({
      id: assetId,
      kind: 'mcp',
      title,
      slug,
      folder,
      description,
      tags,
      source,
      files: [{ path: `${slug}.json`, content: serializeMcpFile(provisional) }],
      note: 'Created',
    })
    ctx.db
      .prepare(
        `INSERT INTO mcp_servers
         (asset_id, transport, command, args_json, url, env_json, headers_json, required_env_json, enabled, is_favorite, notes, health_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(
        assetId,
        input.transport,
        input.transport === 'stdio' ? command || null : null,
        JSON.stringify(input.transport === 'stdio' ? args : []),
        input.transport === 'http' ? url || null : null,
        JSON.stringify(envStored),
        JSON.stringify(headersStored),
        JSON.stringify(requiredEnv),
        notes,
        JSON.stringify(issues),
      )
  })
  tx()
  recordLocalChange(ctx, assetId)
  ctx.events.domainChanged('mcp', 'created', [assetId])
  return assetId
}

function findDeployment(ctx: AppContext, assetId: string, agentId: string): DeploymentRow | null {
  const row = ctx.db
    .prepare("SELECT * FROM deployments WHERE asset_id = ? AND agent_id = ? AND asset_kind = 'mcp'")
    .get(assetId, agentId) as DeploymentRow | undefined
  return row ?? null
}

function loadApplyServer(ctx: AppContext, assetId: string, requireEnabled = true): ApplyServer {
  const asset = requireMcpAsset(ctx, assetId)
  const row = readMcpRow(ctx, asset.id)
  if (requireEnabled && !row.enabled) {
    throw new AppError('UNSUPPORTED', `"${asset.title}" is disabled. Enable it before applying.`, {
      kind: 'unsupported',
      targetId: asset.id,
      feature: 'mcp.apply',
      reason: 'A disabled server cannot be applied.',
    })
  }
  return { asset, row, revision: ctx.assets.currentRevision(asset.id) }
}

function rootKeyForAgent(agentId: string): McpConfigRootKey | undefined {
  return agentId === 'opencode' ? 'mcp' : undefined
}

function resolveAgentTargets(ctx: AppContext, agentIds: string[]): AgentTarget[] {
  const requested = uniqueStrings(agentIds)
  const defs = AGENT_DEFS.filter((agent) => agent.supportsMcp)
  const selected = requested.length ? requested : defs.map((agent) => agent.id)
  const targets: AgentTarget[] = []
  for (const agentId of selected) {
    const def = defs.find((agent) => agent.id === agentId)
    if (!def) {
      throw new AppError('UNSUPPORTED', `${agentId} cannot receive MCP server configuration.`, {
        kind: 'unsupported',
        targetId: agentId,
        feature: 'mcp',
        reason: 'The Agent does not support MCP.',
      })
    }
    const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
    if (!paths.mcpFile) {
      throw new AppError('UNSUPPORTED', `${def.name} has no MCP configuration path on this platform.`, {
        kind: 'unsupported',
        targetId: agentId,
        feature: 'mcp',
        reason: 'The Agent has no MCP file.',
      })
    }
    targets.push({
      agentId,
      agentName: def.name,
      configPath: expandUserPath(paths.mcpFile),
      format: agentConfigFormat(agentId, ctx.platform),
      ...(rootKeyForAgent(agentId) ? { rootKey: rootKeyForAgent(agentId) } : {}),
    })
  }
  return targets
}

async function readAgentConfig(target: AgentTarget): Promise<AgentConfigSnapshot> {
  const text = await readTextIfExists(target.configPath)
  if (text === null) {
    return {
      text: '',
      format: target.format,
      read: readConfigText('', target.format, { ...(target.rootKey ? { rootKey: target.rootKey } : {}) }),
      exists: false,
    }
  }
  const format = detectConfigFormat(target.configPath, text)
  return {
    text,
    format,
    read: readConfigText(text, format, { ...(target.rootKey ? { rootKey: target.rootKey } : {}) }),
    exists: true,
  }
}

function resolveFieldValue(
  ctx: AppContext,
  assetId: string,
  ownerType: SecretOwner,
  key: string,
  stored: StoredFieldValue,
  redacted: boolean,
): string {
  if (typeof stored === 'string' && (!isMcpSecretField(key) || !isPlaceholder(stored))) {
    return stored
  }
  if (!ctx.secrets.has(ownerType, assetId, key)) return ''
  if (redacted) return SECRET_REDACTED
  return ctx.secrets.get(ownerType, assetId, key) ?? ''
}

function buildDesiredEntry(ctx: AppContext, server: ApplyServer, redacted: boolean): Record<string, unknown> {
  const envStored = parseStoredFields(server.row.env_json)
  const headerStored = parseStoredFields(server.row.headers_json)
  if (server.row.transport === 'http') {
    const headers: Record<string, string> = {}
    for (const [key, stored] of Object.entries(headerStored)) {
      headers[key] = resolveFieldValue(ctx, server.asset.id, 'mcp_header', key, stored, redacted)
    }
    return {
      url: server.row.url ?? '',
      ...(Object.keys(headers).length ? { headers } : {}),
    }
  }
  const env: Record<string, string> = {}
  for (const [key, stored] of Object.entries(envStored)) {
    env[key] = resolveFieldValue(ctx, server.asset.id, 'mcp_env', key, stored, redacted)
  }
  return {
    command: server.row.command ?? '',
    args: parseStringArray(server.row.args_json),
    ...(Object.keys(env).length ? { env } : {}),
  }
}

function missingRequiredEnv(ctx: AppContext, server: ApplyServer): string[] {
  const envStored = parseStoredFields(server.row.env_json)
  const required = parseStringArray(server.row.required_env_json)
  return required.filter((key) => {
    const stored = envStored[key]
    if (stored === undefined) return true
    if (typeof stored === 'string') return stored === ''
    return !ctx.secrets.has('mcp_env', server.asset.id, key)
  })
}

function applyToken(
  servers: ApplyServer[],
  targets: McpApplyTarget[],
  fileHashes: Record<string, string | null>,
): string {
  const payload = {
    servers: [...servers]
      .sort((a, b) => (a.asset.id < b.asset.id ? -1 : 1))
      .map((server) => ({
        id: server.asset.id,
        revisionId: server.revision.id,
        slug: server.asset.slug,
        entry: sha256Hex(stableStringify(buildDesiredEntryPayload(server))),
      })),
    targets: targets
      .map((target) => ({
        agentId: target.agentId,
        configPath: target.configPath,
        format: target.format,
        file: fileHashes[target.agentId] ?? null,
      }))
      .sort((a, b) => (a.agentId < b.agentId ? -1 : 1)),
  }
  return sha256Hex(stableStringify(payload))
}

/**
 * Token input intentionally excludes secret values. Secret changes always create a
 * revision, so the revision id is sufficient to invalidate a stale preview.
 */
function buildDesiredEntryPayload(server: ApplyServer): Record<string, unknown> {
  return {
    transport: server.row.transport,
    command: server.row.command,
    args: parseStringArray(server.row.args_json),
    url: server.row.url,
    env: Object.keys(parseStoredFields(server.row.env_json)).sort(),
    headers: Object.keys(parseStoredFields(server.row.headers_json)).sort(),
  }
}

async function buildApplyPreview(
  ctx: AppContext,
  servers: ApplyServer[],
  agentIds: string[],
): Promise<McpApplyPreview> {
  const agentTargets = resolveAgentTargets(ctx, agentIds)
  const targets: McpApplyTarget[] = []
  const fileHashes: Record<string, string | null> = {}
  for (const target of agentTargets) {
    const snapshot = await readAgentConfig(target)
    fileHashes[target.agentId] = snapshot.exists ? sha256Hex(snapshot.text) : null
    const warnings: string[] = []
    if (!snapshot.exists) {
      warnings.push(`The configuration file ${target.configPath} does not exist yet and will be created.`)
    }
    const entries: McpApplyTarget['entries'] = []
    for (const server of servers) {
      const name = server.asset.slug
      const existing = snapshot.read.servers[name]
      const existingHash =
        existing !== undefined ? sha256Hex(stableStringify(existing)) : null
      const deployment = findDeployment(ctx, server.asset.id, target.agentId)
      let action: 'create' | 'update' | 'noop'
      let drift = false
      if (deployment) {
        drift = existingHash === null || existingHash !== deployment.manifest_hash
        if (existingHash === null) action = 'create'
        else if (drift) action = 'update'
        else action = deployment.deployed_revision_id === server.revision.id ? 'noop' : 'update'
      } else {
        action = existing !== undefined ? 'update' : 'create'
        if (existing !== undefined) {
          warnings.push(
            `An existing server named "${name}" in ${target.agentName} was not created by this app and will be replaced.`,
          )
        }
      }
      if (existing !== undefined && !isPlainObject(existing)) {
        warnings.push(`The existing "${name}" entry is not an object and will be replaced.`)
      }
      for (const key of missingRequiredEnv(ctx, server)) {
        warnings.push(`"${name}" has no value for required environment variable ${key}.`)
      }
      entries.push({
        serverId: server.asset.id,
        serverName: name,
        redactedEntry: buildDesiredEntry(ctx, server, true),
        action,
        drift,
      })
    }
    // Validate that the target file structure can be edited before the user confirms.
    try {
      writeMerge(
        snapshot.text,
        snapshot.format,
        entries.map((entry) => ({ name: entry.serverName, config: entry.redactedEntry })),
        { ...(target.rootKey ? { rootKey: target.rootKey } : {}) },
      )
    } catch (error) {
      warnings.push(
        `This target cannot be edited automatically: ${error instanceof Error ? error.message : 'unsupported file structure'}`,
      )
    }
    targets.push({
      agentId: target.agentId,
      agentName: target.agentName,
      configPath: target.configPath,
      format: snapshot.format,
      entries,
      warnings: [...new Set(warnings)],
    })
  }
  return { phase: 'preview', targets, previewToken: applyToken(servers, targets, fileHashes) }
}

function errorPayload(error: unknown): IpcErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      retryable: error.retryable,
    }
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : 'Unexpected internal error.',
    retryable: false,
  }
}

function upsertDeployment(
  ctx: AppContext,
  server: ApplyServer,
  agentId: string,
  targetPath: string,
  entryHash: string,
): void {
  const existing = findDeployment(ctx, server.asset.id, agentId)
  const at = nowIso()
  const managedKeys = JSON.stringify([server.asset.slug])
  if (existing) {
    ctx.db
      .prepare(
        `UPDATE deployments
         SET status = 'synced', target_path = ?, previous_revision_id = ?, deployed_revision_id = ?,
             manifest_hash = ?, managed_keys_json = ?, deployed_at = ?
         WHERE id = ?`,
      )
      .run(
        targetPath,
        existing.deployed_revision_id,
        server.revision.id,
        entryHash,
        managedKeys,
        at,
        existing.id,
      )
    return
  }
  ctx.db
    .prepare(
      `INSERT INTO deployments
       (id, asset_id, asset_kind, agent_id, mode, status, target_path, deployed_revision_id,
        previous_revision_id, manifest_hash, managed_keys_json, deployed_at)
       VALUES (?, ?, 'mcp', ?, 'copy', 'synced', ?, ?, NULL, ?, ?, ?)`,
    )
    .run(newId('dep'), server.asset.id, agentId, targetPath, server.revision.id, entryHash, managedKeys, at)
}

async function executeApply(
  ctx: AppContext,
  servers: ApplyServer[],
  targets: McpApplyTarget[],
  opCtx: OperationContext,
): Promise<McpApplyResultItem[]> {
  const results: McpApplyResultItem[] = []
  const agentTargets = resolveAgentTargets(ctx, targets.map((target) => target.agentId))
  for (let index = 0; index < agentTargets.length; index++) {
    const target = agentTargets[index]
    const previewTarget = targets.find((entry) => entry.agentId === target.agentId)
    opCtx.progress('apply', index, agentTargets.length, `Applying MCP servers to ${target.agentName}`)
    const targetResults: McpApplyResultItem[] = []
    try {
      const snapshot = await readAgentConfig(target)
      const mergeEntries: McpConfigMergeEntry[] = []
      const pending: Array<{ server: ApplyServer; action: 'create' | 'update'; entryHash: string }> = []
      for (const server of servers) {
        const previewEntry = previewTarget?.entries.find((entry) => entry.serverId === server.asset.id)
        if (previewEntry?.action === 'noop') {
          targetResults.push({
            agentId: target.agentId,
            serverId: server.asset.id,
            ok: true,
            action: 'noop',
            targetPath: target.configPath,
          })
          continue
        }
        const fresh: ApplyServer = {
          asset: ctx.assets.getAsset(server.asset.id),
          row: readMcpRow(ctx, server.asset.id),
          revision: ctx.assets.currentRevision(server.asset.id),
        }
        const entry = buildDesiredEntry(ctx, fresh, false)
        mergeEntries.push({ name: fresh.asset.slug, config: entry })
        pending.push({
          server: fresh,
          action: snapshot.read.servers[fresh.asset.slug] === undefined ? 'create' : 'update',
          entryHash: sha256Hex(stableStringify(entry)),
        })
      }
      if (mergeEntries.length) {
        const merged = writeMerge(snapshot.text, snapshot.format, mergeEntries, {
          ...(target.rootKey ? { rootKey: target.rootKey } : {}),
        })
        if (merged.changed) await writeAtomic(target.configPath, merged.text)
        for (const item of pending) {
          upsertDeployment(ctx, item.server, target.agentId, target.configPath, item.entryHash)
          const action: McpApplyResultItem['action'] =
            item.action === 'create' ? 'created' : merged.changed ? 'updated' : 'noop'
          targetResults.push({
            agentId: target.agentId,
            serverId: item.server.asset.id,
            ok: true,
            action,
            targetPath: target.configPath,
          })
          ctx.audit.log({
            type: 'deploy',
            result: 'success',
            title: `Applied MCP server "${item.server.asset.title}" to ${target.agentName}`,
            detail: {
              agentId: target.agentId,
              serverId: item.server.asset.id,
              action,
              targetPath: target.configPath,
              revisionId: item.server.revision.id,
            },
            assetId: item.server.asset.id,
            targetId: target.agentId,
            operationId: opCtx.operationId,
          })
        }
      }
      results.push(...targetResults)
    } catch (error) {
      const payload = errorPayload(error)
      const failedIds = (previewTarget?.entries ?? [])
        .filter((entry) => entry.action !== 'noop')
        .map((entry) => entry.serverId)
      const ids = failedIds.length ? failedIds : servers.map((server) => server.asset.id)
      for (const serverId of ids) {
        results.push({
          agentId: target.agentId,
          serverId,
          ok: false,
          action: 'noop',
          targetPath: target.configPath,
          error: payload,
        })
      }
      const noopResults = targetResults.filter((entry) => entry.action === 'noop')
      results.push(...noopResults)
      ctx.audit.log({
        type: 'deploy',
        result: 'error',
        title: `Applying MCP servers to ${target.agentName} failed`,
        detail: { agentId: target.agentId, code: payload.code, message: payload.message },
        targetId: target.agentId,
        operationId: opCtx.operationId,
      })
    }
  }
  return results
}

async function executeRemove(
  ctx: AppContext,
  servers: ApplyServer[],
  agentIds: string[],
  opCtx: OperationContext,
): Promise<McpApplyResultItem[]> {
  const results: McpApplyResultItem[] = []
  const targets = resolveAgentTargets(ctx, agentIds)
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]
    opCtx.progress('remove', index, targets.length, `Removing MCP entries from ${target.agentName}`)
    const targetResults: McpApplyResultItem[] = []
    try {
      const snapshot = await readAgentConfig(target)
      let text = snapshot.text
      let changed = false
      const removed: Array<{ server: ApplyServer; deployment: DeploymentRow }> = []
      for (const server of servers) {
        const deployment = findDeployment(ctx, server.asset.id, target.agentId)
        if (!deployment) {
          targetResults.push({
            agentId: target.agentId,
            serverId: server.asset.id,
            ok: true,
            action: 'noop',
            targetPath: target.configPath,
          })
          continue
        }
        const managedKeys = parseStringArray(deployment.managed_keys_json)
        if (!managedKeys.length) {
          targetResults.push({
            agentId: target.agentId,
            serverId: server.asset.id,
            ok: true,
            action: 'noop',
            targetPath: target.configPath,
          })
          continue
        }
        let entryChanged = false
        for (const key of managedKeys) {
          const removal = removeEntry(text, snapshot.format, key, {
            ...(target.rootKey ? { rootKey: target.rootKey } : {}),
          })
          text = removal.text
          if (removal.changed) entryChanged = true
        }
        changed = changed || entryChanged
        removed.push({ server, deployment })
      }
      if (changed) await writeAtomic(target.configPath, text)
      for (const entry of removed) {
        ctx.db.prepare('DELETE FROM deployments WHERE id = ?').run(entry.deployment.id)
        targetResults.push({
          agentId: target.agentId,
          serverId: entry.server.asset.id,
          ok: true,
          action: 'removed',
          targetPath: target.configPath,
        })
        ctx.audit.log({
          type: 'deploy',
          result: 'success',
          title: `Removed MCP server "${entry.server.asset.title}" from ${target.agentName}`,
          detail: {
            agentId: target.agentId,
            serverId: entry.server.asset.id,
            targetPath: target.configPath,
            managedKeys: parseStringArray(entry.deployment.managed_keys_json),
          },
          assetId: entry.server.asset.id,
          targetId: target.agentId,
          operationId: opCtx.operationId,
        })
      }
      results.push(...targetResults)
    } catch (error) {
      const payload = errorPayload(error)
      for (const server of servers) {
        results.push({
          agentId: target.agentId,
          serverId: server.asset.id,
          ok: false,
          action: 'noop',
          targetPath: target.configPath,
          error: payload,
        })
      }
      ctx.audit.log({
        type: 'deploy',
        result: 'error',
        title: `Removing MCP entries from ${target.agentName} failed`,
        detail: { agentId: target.agentId, code: payload.code, message: payload.message },
        targetId: target.agentId,
        operationId: opCtx.operationId,
      })
    }
  }
  return results
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (isMcpSecretField(key)) {
        out[key] = entry === '' || entry === null || entry === undefined ? entry : SECRET_REDACTED
      } else {
        out[key] = redactValue(entry)
      }
    }
    return out
  }
  return value
}

function redactedConfig(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return { value: redactValue(value) }
  return redactValue(value) as Record<string, unknown>
}

function transportFromEntry(entry: unknown): McpTransport {
  if (!isPlainObject(entry)) return 'stdio'
  if (typeof entry.url === 'string') return 'http'
  if (entry.type === 'remote') return 'http'
  return 'stdio'
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

function parseExternalEntry(name: string, entry: Record<string, unknown>): ParsedExternalServer {
  const warnings: string[] = []
  const env = stringRecord(entry.env ?? entry.environment)
  const headers = stringRecord(entry.headers ?? entry.http_headers)
  let command = ''
  let args: string[] = []
  if (typeof entry.command === 'string') {
    command = entry.command
  } else if (Array.isArray(entry.command)) {
    const parts = entry.command.filter((part): part is string => typeof part === 'string')
    command = parts[0] ?? ''
    args = parts.slice(1)
  }
  if (Array.isArray(entry.args)) {
    args = args.concat(entry.args.filter((part): part is string => typeof part === 'string'))
  }
  const url = typeof entry.url === 'string' ? entry.url : ''
  const isHttp = url !== '' && (entry.type === 'remote' || command === '')
  if (command && url) {
    warnings.push(`Server "${name}" defines both a command and a URL; the transport was inferred from the entry type.`)
  }
  if (!isHttp && !command) {
    throw validationError(`Server "${name}" has no command or URL that the app can import.`)
  }
  return {
    transport: isHttp ? 'http' : 'stdio',
    args: isHttp ? [] : args,
    ...(isHttp ? { url } : { command }),
    env,
    headers,
    description: typeof entry.description === 'string' ? entry.description : '',
    warnings,
  }
}

function secretKeysOf(parsed: ParsedExternalServer): string[] {
  const keys = [
    ...Object.keys(parsed.env).filter(
      (key) => isMcpSecretField(key) && parsed.env[key] !== '' && !isPlaceholder(parsed.env[key]),
    ),
    ...Object.keys(parsed.headers).filter(
      (key) => isMcpSecretField(key) && parsed.headers[key] !== '' && !isPlaceholder(parsed.headers[key]),
    ),
  ]
  return [...new Set(keys)]
}

/**
 * Placeholder values are references, not secrets. Importing them as literal
 * ciphertext would make the library claim a value it does not have.
 */
function importableFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isMcpSecretField(key) && isPlaceholder(value) ? '' : value
  }
  return out
}

function scanExternalEntry(name: string, entry: unknown): ImportScan {
  if (!isPlainObject(entry)) {
    throw validationError(`Server "${name}" is not a configuration object.`)
  }
  const parsed = parseExternalEntry(name, entry)
  return {
    name,
    transport: parsed.transport,
    redactedConfig: redactedConfig(entry),
    secretKeys: secretKeysOf(parsed),
    warnings: parsed.warnings,
    config: parsed,
  }
}

async function readExternalConfig(
  ctx: AppContext,
  agentId: string,
): Promise<{ defName: string; configPath: string; text: string; read: McpConfigReadResult }> {
  const def = AGENT_DEFS.find((agent) => agent.id === agentId && agent.supportsMcp)
  if (!def) {
    throw new AppError('UNSUPPORTED', `${agentId} cannot provide MCP configuration.`, {
      kind: 'unsupported',
      targetId: agentId,
      feature: 'mcp',
      reason: 'The Agent does not support MCP.',
    })
  }
  const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
  if (!paths.mcpFile) {
    throw new AppError('UNSUPPORTED', `${def.name} has no MCP configuration path on this platform.`, {
      kind: 'unsupported',
      targetId: agentId,
      feature: 'mcp',
      reason: 'The Agent has no MCP file.',
    })
  }
  const configPath = expandUserPath(paths.mcpFile)
  const text = await readTextIfExists(configPath)
  if (text === null) {
    throw new AppError('NOT_FOUND', `The ${def.name} configuration file does not exist at ${configPath}.`)
  }
  const format = detectConfigFormat(configPath, text)
  const read = readConfigText(text, format, {
    ...(rootKeyForAgent(agentId) ? { rootKey: rootKeyForAgent(agentId) } : {}),
  })
  return { defName: def.name, configPath, text, read }
}

function importToken(agentId: string, names: string[], text: string): string {
  return sha256Hex(
    stableStringify({
      agentId,
      names: [...names].sort(),
      configHash: sha256Hex(text),
    }),
  )
}

/* ------------------------------------------------------------------ */
/* Store catalog                                                       */
/* ------------------------------------------------------------------ */

const MCP_STORE: McpStoreItem[] = [
  {
    id: 'ms-notion',
    name: 'notion',
    description: 'Connect a Notion workspace to search and edit pages and databases.',
    whatItDoes: 'Searches shared pages, creates pages, appends blocks, and queries database views.',
    useCases: ['Write meeting notes to Notion', 'Search project material across databases'],
    installCommand: 'npx -y @mcp/notion',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/notion'],
    envDocs: [
      {
        key: 'NOTION_API_KEY',
        description: 'Create an internal integration token under Notion integrations.',
        placeholder: 'ntn_xxxxxxxx',
      },
    ],
  },
  {
    id: 'ms-postgres',
    name: 'postgres',
    description: 'Query PostgreSQL databases with read-only access.',
    whatItDoes: 'Lists schemas, runs read-only SQL, and explains query plans.',
    useCases: ['Let an Agent inspect business data', 'Review slow queries'],
    installCommand: 'npx -y @mcp/postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/postgres'],
    envDocs: [
      {
        key: 'DATABASE_URL',
        description: 'PostgreSQL connection string. A read-only account is recommended.',
        placeholder: 'postgres://user:pass@host:5432/db',
      },
    ],
  },
  {
    id: 'ms-brave-search',
    name: 'brave-search',
    description: 'Web and news search through the Brave Search API.',
    whatItDoes: 'Runs web, news, and image searches and returns titles, snippets, and links.',
    useCases: ['Look up current information', 'Track competitor updates'],
    installCommand: 'npx -y @mcp/brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/brave-search'],
    envDocs: [
      {
        key: 'BRAVE_API_KEY',
        description: 'Apply for a key in the Brave Search API dashboard.',
        placeholder: 'BSAxxxxxxxx',
      },
    ],
  },
  {
    id: 'ms-firecrawl',
    name: 'firecrawl',
    description: 'Crawl web pages into clean Markdown and structured data.',
    whatItDoes: 'Scrapes single pages and whole sites, renders JavaScript, and converts output to Markdown.',
    useCases: ['Scrape documentation sites', 'Prepare content for retrieval'],
    installCommand: 'npx -y @mcp/firecrawl',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/firecrawl'],
    envDocs: [
      {
        key: 'FIRECRAWL_API_KEY',
        description: 'Create a key in the Firecrawl console.',
        placeholder: 'fc-xxxxxxxx',
      },
    ],
  },
  {
    id: 'ms-memory',
    name: 'memory',
    description: 'Local knowledge graph memory across sessions.',
    whatItDoes: 'Stores entities and relationships in a local file and recalls them later.',
    useCases: ['Remember project context', 'Keep long-term preferences'],
    installCommand: 'npx -y @mcp/memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/memory'],
    envDocs: [],
  },
  {
    id: 'ms-puppeteer',
    name: 'puppeteer',
    description: 'Browser automation with navigation, clicks, and screenshots.',
    whatItDoes: 'Drives headless Chromium and returns screenshots and page content.',
    useCases: ['Check rendered pages', 'Automate a repeatable browser flow'],
    installCommand: 'npx -y @mcp/puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/puppeteer'],
    envDocs: [],
  },
  {
    id: 'ms-github',
    name: 'github',
    description: 'Read repositories, issues, and pull requests from GitHub.',
    whatItDoes: 'Exposes repository search, file reads, issue lookup, and pull request summaries.',
    useCases: ['Summarize open pull requests', 'Search issues across repositories'],
    installCommand: 'npx -y @mcp/github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/github'],
    envDocs: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        description: 'Create a fine-grained token with repository read access.',
        placeholder: 'github_pat_xxxxxxxx',
      },
    ],
  },
  {
    id: 'ms-slack',
    name: 'slack',
    description: 'Send and search Slack messages in a workspace.',
    whatItDoes: 'Reads channel history, searches messages, and sends replies.',
    useCases: ['Summarize a channel', 'Post a status update'],
    installCommand: 'npx -y @mcp/slack',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcp/slack'],
    envDocs: [
      {
        key: 'SLACK_BOT_TOKEN',
        description: 'Install a Slack app and copy the bot token.',
        placeholder: 'xoxb-xxxxxxxx',
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export function createMcpService(ctx: AppContext): McpService {
  return {
    async list(query: McpQuery): Promise<AssetListResult<McpListItem>> {
      const ids = matchingMcpIds(ctx, query)
      let items = ids.map((id) => {
        const asset = ctx.assets.getAsset(id)
        return listItemFrom(ctx, asset, readMcpRow(ctx, asset.id))
      })
      if (query.healthStatus) {
        items = items.filter((item) => item.healthStatus === query.healthStatus)
      }
      items = sortMcpItems(items, query.sort, query.order)
      const folders = buildFolderTree(
        items
          .filter((item) => item.folder)
          .map((item) => ({ path: item.folder, direct: 1, total: 1 })),
      )
      const folder = normalizeFolder(query.folder)
      const includeDescendants = query.includeDescendants !== false
      const scoped = folder ? items.filter((item) => folderInScope(item.folder, folder, includeDescendants)) : items
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      const offset = Math.max(query.offset ?? 0, 0)
      return {
        items: scoped.slice(offset, offset + limit),
        total: scoped.length,
        limit,
        offset,
        folders,
      }
    },

    async get(id: string): Promise<McpDetail> {
      return detailFrom(ctx, requireMcpAsset(ctx, id))
    },

    async versions(id: string): Promise<RevisionSummary[]> {
      requireMcpAsset(ctx, id)
      return revisionSummaries(ctx, id)
    },

    async create(input: McpCreateInput): Promise<McpDetail> {
      const assetId = createMcpRecord(ctx, input)
      return detailFrom(ctx, ctx.assets.getAsset(assetId))
    },

    async update(input: McpUpdateInput): Promise<McpDetail> {
      const asset = requireMcpAsset(ctx, input.id)
      const current = ctx.assets.currentRevision(asset.id)
      if (current.id !== input.expectedRevisionId) {
        throw revisionConflictAt(current, asset.updatedAt)
      }
      const row = readMcpRow(ctx, asset.id)
      const currentEnv = parseStoredFields(row.env_json)
      const currentHeaders = parseStoredFields(row.headers_json)

      const nextTransport: McpTransport = input.transport ?? row.transport
      if (input.transport !== undefined && input.transport !== 'stdio' && input.transport !== 'http') {
        throw validationError('The transport must be "stdio" or "http".')
      }
      const switching = input.transport !== undefined && input.transport !== row.transport
      if (
        switching &&
        nextTransport === 'stdio' &&
        (typeof input.command !== 'string' || !input.command.trim())
      ) {
        throw validationError('Switching to stdio requires a command.')
      }
      if (
        switching &&
        nextTransport === 'http' &&
        (typeof input.url !== 'string' || !input.url.trim())
      ) {
        throw validationError('Switching to HTTP requires a URL.')
      }

      const nextCommand =
        nextTransport === 'stdio'
          ? typeof input.command === 'string'
            ? input.command.trim()
            : row.command?.trim() ?? ''
          : ''
      const nextUrl =
        nextTransport === 'http'
          ? typeof input.url === 'string'
            ? input.url.trim()
            : row.url?.trim() ?? ''
          : ''
      validateTransportFields(nextTransport, nextCommand, nextUrl)

      const envPatch = normalizePatchFields(input.env, 'env')
      const headerPatch = normalizePatchFields(input.headers, 'headers')
      if (headerPatch) assertHeaderNames(headerPatch)
      const secretWrites =
        (envPatch
          ? Object.entries(envPatch).some(
              ([key, value]) => isMcpSecretField(key) && !!value && !isPlaceholder(value),
            )
          : false) ||
        (headerPatch
          ? Object.entries(headerPatch).some(
              ([key, value]) => isMcpSecretField(key) && !!value && !isPlaceholder(value),
            )
          : false)
      assertSecretsAvailable(ctx, secretWrites)

      const nextTitle =
        input.title !== undefined ? (typeof input.title === 'string' ? input.title.trim() : '') : asset.title
      if (!nextTitle) throw validationError('A title is required.', [{ path: 'title', message: 'Required.' }])
      const nextFolder = input.folder !== undefined ? normalizeFolder(input.folder) : asset.folder
      const folderError = validateFolder(nextFolder)
      if (folderError) throw validationError(folderError, [{ path: 'folder', message: folderError }])
      const nextDescription =
        input.description !== undefined ? textValue(input.description, asset.description) : asset.description
      const nextTags = input.tags !== undefined ? normalizeTags(input.tags) : ctx.assets.tags(asset.id)
      const nextArgs =
        nextTransport === 'stdio'
          ? input.args !== undefined
            ? normalizeArgs(input.args)
            : parseStringArray(row.args_json)
          : []
      const nextRequiredEnv =
        input.requiredEnv !== undefined ? uniqueStrings(input.requiredEnv) : parseStringArray(row.required_env_json)
      const nextNotes = input.notes !== undefined ? textValue(input.notes, row.notes) : row.notes

      const currentText = await ctx.assets.readFileContent(current.id)
      let patchedEnv = currentEnv
      let patchedHeaders = currentHeaders
      let secretsChanged = false
      let shouldRevise = false
      let updatedSlug = asset.slug

      const tx = ctx.db.transaction(() => {
        if (envPatch) {
          const patched = patchStoredFields(
            ctx,
            asset.id,
            'mcp_env',
            currentEnv,
            envPatch,
            input.confirmClearSecrets === true,
          )
          patchedEnv = patched.fields
          secretsChanged = secretsChanged || patched.secretsChanged
        }
        if (headerPatch) {
          const patched = patchStoredFields(
            ctx,
            asset.id,
            'mcp_header',
            currentHeaders,
            headerPatch,
            input.confirmClearSecrets === true,
          )
          patchedHeaders = patched.fields
          secretsChanged = secretsChanged || patched.secretsChanged
        }

        const nextModel: McpFileModel = {
          id: asset.id,
          title: nextTitle,
          description: nextDescription,
          folder: nextFolder,
          tags: nextTags,
          transport: nextTransport,
          args: nextTransport === 'stdio' ? nextArgs : [],
          ...(nextTransport === 'stdio'
            ? { command: nextCommand }
            : { url: nextUrl }),
          env: fileFields(patchedEnv),
          headers: fileFields(patchedHeaders),
          requiredEnv: nextRequiredEnv,
          enabled: !!row.enabled,
          notes: nextNotes,
        }
        const nextText = serializeMcpFile(nextModel)
        shouldRevise = secretsChanged || currentText === null || currentText !== nextText

        if (input.title !== undefined || input.folder !== undefined || input.description !== undefined || input.tags !== undefined) {
          const updated = ctx.assets.setMetadata(asset.id, {
            ...(input.title !== undefined ? { title: nextTitle } : {}),
            ...(input.folder !== undefined ? { folder: nextFolder } : {}),
            ...(input.description !== undefined ? { description: nextDescription } : {}),
            ...(input.tags !== undefined ? { tags: nextTags } : {}),
          })
          updatedSlug = updated.slug
        }

        if (shouldRevise) {
          ctx.assets.addRevision(
            asset.id,
            [{ path: `${updatedSlug}.json`, content: nextText }],
            'Updated',
            input.expectedRevisionId,
          )
        }

        const issues = healthIssues(
          {
            transport: nextTransport,
            command: nextTransport === 'stdio' ? nextCommand : null,
            url: nextTransport === 'http' ? nextUrl : null,
            required_env_json: JSON.stringify(nextRequiredEnv),
          },
          dtoFields(ctx, asset.id, 'mcp_env', patchedEnv),
          dtoFields(ctx, asset.id, 'mcp_header', patchedHeaders),
        )
        ctx.db
          .prepare(
            `UPDATE mcp_servers
             SET transport = ?, command = ?, args_json = ?, url = ?, env_json = ?, headers_json = ?,
                 required_env_json = ?, notes = ?, health_json = ?
             WHERE asset_id = ?`,
          )
          .run(
            nextTransport,
            nextTransport === 'stdio' ? nextCommand || null : null,
            JSON.stringify(nextArgs),
            nextTransport === 'http' ? nextUrl || null : null,
            JSON.stringify(patchedEnv),
            JSON.stringify(patchedHeaders),
            JSON.stringify(nextRequiredEnv),
            nextNotes,
            JSON.stringify(issues),
            asset.id,
          )
      })
      tx()

      if (shouldRevise) {
        recordLocalChange(ctx, asset.id)
        markDeploymentsStale(ctx, asset.id)
        ctx.events.domainChanged('dispatch', 'reconciled', [asset.id])
      }
      ctx.events.domainChanged('mcp', 'updated', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async delete(input: DeleteInput): Promise<DeleteResult> {
      if (input.confirm !== true) throw validationError('Deletion requires confirmation.')
      const asset = requireMcpAsset(ctx, input.id)
      const withdrawnChangeIds = withdrawPendingChanges(ctx, asset.id)
      const deletedAt = ctx.assets.softDelete(asset.id)
      ctx.events.domainChanged('mcp', 'deleted', [asset.id])
      return { id: asset.id, deletedAt, withdrawnChangeIds }
    },

    async restore(input: { id: string }): Promise<McpDetail> {
      const existing = ctx.assets.getAsset(input.id, true)
      if (existing.kind !== 'mcp') throw new AppError('NOT_FOUND', 'This MCP server no longer exists.')
      const asset = ctx.assets.restoreAsset(existing.id)
      ctx.events.domainChanged('mcp', 'restored', [asset.id])
      return detailFrom(ctx, asset)
    },

    async restoreVersion(input: RestoreVersionInput): Promise<McpDetail> {
      const asset = requireMcpAsset(ctx, input.id)
      const current = ctx.assets.currentRevision(asset.id)
      if (current.id !== input.expectedRevisionId) {
        throw revisionConflictAt(current, asset.updatedAt)
      }
      const revision = ctx.assets.getRevision(input.revisionId)
      if (revision.assetId !== asset.id) {
        throw new AppError('NOT_FOUND', 'This version does not belong to this server.')
      }
      const file = revision.files.find((entry) => entry.mediaKind === 'text') ?? revision.files[0]
      if (!file) throw new AppError('CORRUPT', 'The selected version has no file.')
      const text = (await ctx.blobs.read(file.blobHash)).toString('utf8')
      const parsed = parseMcpFile(text)
      if (!parsed.model) {
        throw new AppError('CORRUPT', `The selected version cannot be restored: ${parsed.error ?? 'invalid file'}.`)
      }
      const snapshot = parsed.model
      const folderError = validateFolder(normalizeFolder(snapshot.folder))
      if (folderError) throw new AppError('CORRUPT', `The selected version has an invalid folder: ${folderError}`)

      let updatedSlug = asset.slug
      const tx = ctx.db.transaction(() => {
        const envStored = restoreStoredFields(ctx, asset.id, 'mcp_env', snapshot.env)
        const headersStored = restoreStoredFields(ctx, asset.id, 'mcp_header', snapshot.headers)
        const restoredModel: McpFileModel = {
          id: asset.id,
          title: snapshot.title,
          description: snapshot.description,
          folder: normalizeFolder(snapshot.folder),
          tags: snapshot.tags,
          transport: snapshot.transport,
          args: snapshot.transport === 'stdio' ? snapshot.args : [],
          ...(snapshot.transport === 'stdio'
            ? { command: snapshot.command ?? '' }
            : { url: snapshot.url ?? '' }),
          env: fileFields(envStored),
          headers: fileFields(headersStored),
          requiredEnv: snapshot.requiredEnv,
          enabled: snapshot.enabled,
          notes: snapshot.notes,
        }
        const updated = ctx.assets.setMetadata(asset.id, {
          title: snapshot.title,
          description: snapshot.description,
          folder: normalizeFolder(snapshot.folder),
          tags: snapshot.tags,
        })
        updatedSlug = updated.slug
        ctx.assets.addRevision(
          asset.id,
          [{ path: `${updatedSlug}.json`, content: serializeMcpFile(restoredModel) }],
          input.note ?? `Restored from version ${revision.version}`,
          input.expectedRevisionId,
        )
        const issues = healthIssues(
          {
            transport: snapshot.transport,
            command: snapshot.transport === 'stdio' ? snapshot.command ?? '' : null,
            url: snapshot.transport === 'http' ? snapshot.url ?? '' : null,
            required_env_json: JSON.stringify(snapshot.requiredEnv),
          },
          dtoFields(ctx, asset.id, 'mcp_env', envStored),
          dtoFields(ctx, asset.id, 'mcp_header', headersStored),
        )
        ctx.db
          .prepare(
            `UPDATE mcp_servers
             SET transport = ?, command = ?, args_json = ?, url = ?, env_json = ?, headers_json = ?,
                 required_env_json = ?, enabled = ?, notes = ?, health_json = ?
             WHERE asset_id = ?`,
          )
          .run(
            snapshot.transport,
            snapshot.transport === 'stdio' ? snapshot.command ?? null : null,
            JSON.stringify(snapshot.transport === 'stdio' ? snapshot.args : []),
            snapshot.transport === 'http' ? snapshot.url ?? null : null,
            JSON.stringify(envStored),
            JSON.stringify(headersStored),
            JSON.stringify(snapshot.requiredEnv),
            snapshot.enabled ? 1 : 0,
            snapshot.notes,
            JSON.stringify(issues),
            asset.id,
          )
      })
      tx()
      recordLocalChange(ctx, asset.id)
      markDeploymentsStale(ctx, asset.id)
      ctx.events.domainChanged('mcp', 'restored', [asset.id])
      ctx.events.domainChanged('dispatch', 'reconciled', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async health(input: { id: string }): Promise<McpHealthResult> {
      const asset = requireMcpAsset(ctx, input.id)
      const detail = detailFrom(ctx, asset)
      ctx.db
        .prepare('UPDATE mcp_servers SET health_json = ? WHERE asset_id = ?')
        .run(JSON.stringify(detail.health), asset.id)
      return {
        id: asset.id,
        status: detail.healthStatus,
        issues: detail.health,
        checkedAt: nowIso(),
      }
    },

    async setEnabled(input: { id: string; enabled: boolean }): Promise<McpDetail> {
      const asset = requireMcpAsset(ctx, input.id)
      if (typeof input.enabled !== 'boolean') throw validationError('The enabled flag must be a boolean.')
      ctx.db.prepare('UPDATE mcp_servers SET enabled = ? WHERE asset_id = ?').run(input.enabled ? 1 : 0, asset.id)
      ctx.events.domainChanged('mcp', 'updated', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async setFavorite(input: SetFavoriteInput): Promise<FavoriteResult> {
      const asset = requireMcpAsset(ctx, input.id)
      if (typeof input.favorite !== 'boolean') throw validationError('The favorite flag must be a boolean.')
      ctx.db.prepare('UPDATE mcp_servers SET is_favorite = ? WHERE asset_id = ?').run(input.favorite ? 1 : 0, asset.id)
      ctx.events.domainChanged('mcp', 'updated', [asset.id])
      return { id: asset.id, isFavorite: input.favorite }
    },

    async agentState(input: { agentIds?: string[] }): Promise<AgentMcpState[]> {
      const requested = uniqueStrings(input.agentIds)
      const defs = AGENT_DEFS.filter((agent) => agent.supportsMcp)
      const selected = requested.length ? requested : defs.map((agent) => agent.id)
      for (const agentId of selected) {
        if (!defs.some((agent) => agent.id === agentId)) {
          throw validationError(`Unknown Agent: ${agentId}.`)
        }
      }
      const states: AgentMcpState[] = []
      for (const agentId of selected) {
        const def = defs.find((agent) => agent.id === agentId)
        if (!def) continue
        const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
        const format = agentConfigFormat(agentId, ctx.platform)
        if (!paths.mcpFile) {
          states.push({
            agentId,
            agentName: def.name,
            configPath: '',
            exists: false,
            format,
            servers: [],
          })
          continue
        }
        const configPath = expandUserPath(paths.mcpFile)
        const exists = await pathExists(configPath)
        if (!exists) {
          states.push({ agentId, agentName: def.name, configPath, exists: false, format, servers: [] })
          continue
        }
        let read: McpConfigReadResult | null = null
        try {
          read = await readConfig(configPath, format, {
            ...(rootKeyForAgent(agentId) ? { rootKey: rootKeyForAgent(agentId) } : {}),
          })
        } catch (error) {
          ctx.logger.warn('mcp', 'Agent MCP configuration could not be parsed', {
            agentId,
            message: error instanceof Error ? error.message : 'unknown error',
          })
        }
        const deployments = ctx.db
          .prepare("SELECT * FROM deployments WHERE agent_id = ? AND asset_kind = 'mcp'")
          .all(agentId) as DeploymentRow[]
        const managed = new Map<string, DeploymentRow[]>()
        for (const deployment of deployments) {
          for (const key of parseStringArray(deployment.managed_keys_json)) {
            const list = managed.get(key) ?? []
            list.push(deployment)
            managed.set(key, list)
          }
        }
        const servers: AgentMcpState['servers'] = []
        if (read) {
          for (const [name, entry] of Object.entries(read.servers)) {
            const known = managed.get(name) ?? []
            const entryHash = sha256Hex(stableStringify(entry))
            const drift: 'none' | 'modified' | 'unknown' = !known.length
              ? 'unknown'
              : known.some((deployment) => deployment.manifest_hash === entryHash)
                ? 'none'
                : 'modified'
            servers.push({
              name,
              transport: transportFromEntry(entry),
              managed: known.length > 0,
              drift,
              redactedConfig: redactedConfig(entry),
            })
          }
        }
        states.push({
          agentId,
          agentName: def.name,
          configPath,
          exists: true,
          format: read?.format ?? format,
          servers,
        })
      }
      return states
    },

    async importExternal(input: McpImportInput): Promise<McpImportResult> {
      const names = uniqueStrings(input.serverNames)
      if (!names.length) throw validationError('Select at least one server to import.')
      const external = await readExternalConfig(ctx, input.agentId)
      const scans: ImportScan[] = []
      for (const name of names) {
        const entry = external.read.servers[name]
        if (entry === undefined) throw validationError(`Server "${name}" is not present in the ${external.defName} configuration.`)
        scans.push(scanExternalEntry(name, entry))
      }
      const token = importToken(input.agentId, names, external.text)
      if (input.confirm !== true || !input.previewToken) {
        const preview: McpImportPreview = {
          phase: 'preview',
          agentId: input.agentId,
          entries: scans.map((scan) => ({
            name: scan.name,
            transport: scan.transport,
            redactedConfig: scan.redactedConfig,
            secretKeys: scan.secretKeys,
            warnings: scan.warnings,
          })),
          previewToken: token,
        }
        return preview
      }
      if (input.previewToken !== token) {
        throw validationError('The import preview is stale; review the servers again.')
      }
      assertSecretsAvailable(ctx, scans.some((scan) => scan.secretKeys.length > 0))

      const imported: McpDetail[] = []
      const skipped: McpImportApplied['skipped'] = []
      for (const scan of scans) {
        const duplicate = ctx.db
          .prepare("SELECT id FROM assets WHERE kind = 'mcp' AND folder = '' AND lower(title) = lower(?) AND deleted_at IS NULL")
          .get(scan.name) as { id: string } | undefined
        if (duplicate) {
          skipped.push({ name: scan.name, reason: 'A server with this name already exists in the library.' })
          continue
        }
        try {
          const assetId = createMcpRecord(ctx, {
            title: scan.name,
            description: scan.config.description,
            transport: scan.config.transport,
            ...(scan.config.transport === 'stdio'
              ? { command: scan.config.command ?? '', args: scan.config.args }
              : { url: scan.config.url ?? '' }),
            env: importableFields(scan.config.env),
            headers: importableFields(scan.config.headers),
            requiredEnv: [],
            folder: '',
            tags: [],
            notes: '',
            source: 'import',
          })
          imported.push(detailFrom(ctx, ctx.assets.getAsset(assetId)))
        } catch (error) {
          skipped.push({
            name: scan.name,
            reason: error instanceof Error ? error.message : 'The server could not be imported.',
          })
        }
      }
      return { phase: 'applied', imported, skipped }
    },

    async apply(input: McpApplyInput): Promise<McpApplyResult> {
      const serverIds = uniqueStrings(input.serverIds)
      if (!serverIds.length) throw validationError('Select at least one MCP server.')
      const servers = serverIds.map((id) => loadApplyServer(ctx, id))
      if (input.confirm !== true || !input.previewToken) {
        return buildApplyPreview(ctx, servers, input.agentIds)
      }
      const preview = await buildApplyPreview(ctx, servers, input.agentIds)
      if (preview.previewToken !== input.previewToken) {
        throw validationError('The apply preview is stale; review the changes again.')
      }
      if (input.acknowledgePlaintextAtRest !== true) {
        throw validationError(
          'Acknowledge that Agent configuration files will contain secret values in plaintext at rest.',
        )
      }
      assertDecryptable(ctx, servers)
      const ref: OperationRef = ctx.operations.start(
        'mcp_apply',
        async (opCtx): Promise<{ type: 'mcp_apply'; result: { results: McpApplyResultItem[] } }> => {
          const results = await executeApply(ctx, servers, preview.targets, opCtx)
          const ids = servers.map((server) => server.asset.id)
          ctx.events.domainChanged('mcp', 'dispatched', ids, opCtx.operationId)
          ctx.events.domainChanged('dispatch', 'dispatched', ids, opCtx.operationId)
          return { type: 'mcp_apply', result: { results } }
        },
        { assetId: servers[0]?.asset.id },
      )
      return ref
    },

    async remove(input: McpRemoveInput): Promise<OperationRef> {
      if (input.confirm !== true) throw validationError('Removal requires confirmation.')
      const serverIds = uniqueStrings(input.serverIds)
      if (!serverIds.length) throw validationError('Select at least one MCP server.')
      const servers = serverIds.map((id) => loadApplyServer(ctx, id, false))
      return ctx.operations.start(
        'mcp_remove',
        async (opCtx): Promise<{ type: 'mcp_remove'; result: { results: McpApplyResultItem[] } }> => {
          const results = await executeRemove(ctx, servers, input.agentIds, opCtx)
          const ids = servers.map((server) => server.asset.id)
          ctx.events.domainChanged('mcp', 'dispatched', ids, opCtx.operationId)
          ctx.events.domainChanged('dispatch', 'dispatched', ids, opCtx.operationId)
          return { type: 'mcp_remove', result: { results } }
        },
        { assetId: servers[0]?.asset.id },
      )
    },

    async storeList(query: StoreQuery): Promise<Page<McpStoreItem>> {
      const search = (query.search ?? '').trim().toLowerCase()
      const filtered = MCP_STORE.filter((item) => {
        if (!search) return true
        const haystack = [item.name, item.description, item.whatItDoes, ...item.useCases, ...item.envDocs.map((doc) => doc.key)]
        return haystack.some((value) => value.toLowerCase().includes(search))
      })
      const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
      const offset = Math.max(query.offset ?? 0, 0)
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      }
    },
  }
}
