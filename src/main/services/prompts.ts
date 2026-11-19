import { clipboard } from 'electron'
import type {
  AssetListResult,
  AssetSyncPolicyResult,
  AssetSyncState,
  DeleteInput,
  DeleteResult,
  FavoriteResult,
  FolderNode,
  Page,
  PinnedResult,
  PromptCopyInput,
  PromptCopyResult,
  PromptCreateInput,
  PromptDetail,
  PromptFileModel,
  PromptFolderQuery,
  PromptListItem,
  PromptQuery,
  PromptStoreItem,
  PromptUpdateInput,
  PromptVariable,
  RestoreVersionInput,
  RevisionSummary,
  SetFavoriteInput,
  SetPinnedInput,
  SetSyncPolicyInput,
  StoreQuery,
  SyncPolicy,
} from '../../shared/contracts'
import { AppError, validationError } from '../../shared/domain/errors'
import { buildFolderTree, normalizeFolder, validateFolder } from '../../shared/domain/folders'
import { newId } from '../../shared/domain/ids'
import { parsePromptFile, serializePromptFile } from '../../shared/domain/promptFile'
import {
  mergeVariableDefs,
  renderTemplate,
  validateVariableDefinitions,
} from '../../shared/domain/variables'
import type { AppContext } from '../context'
import type { AssetRecord, RevisionRecord } from './assetStore'
import {
  assetBase,
  effectiveSync,
  recordLocalChange,
  syncStateFor,
  withdrawPendingChanges,
} from './assetSyncState'
import type { PromptService } from './types'

const KIND = 'prompt' as const
const EXCERPT_LENGTH = 160
const MAX_REVISION_FILE_BYTES = 256 * 1024
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const BASE_WHERE = ["assets.kind = 'prompt'", 'assets.deleted_at IS NULL']

interface PromptRecord {
  asset: AssetRecord
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  usageCount: number
  isFavorite: boolean
  isPinned: boolean
}

interface PromptRow extends PromptRecord {
  pendingChangeCount: number
}

interface SqlFilter {
  where: string[]
  params: unknown[]
}

function pageParams(query: { limit?: number; offset?: number }): { limit: number; offset: number } {
  const rawLimit = typeof query.limit === 'number' && Number.isFinite(query.limit) ? Math.trunc(query.limit) : DEFAULT_LIMIT
  const rawOffset = typeof query.offset === 'number' && Number.isFinite(query.offset) ? Math.trunc(query.offset) : 0
  return {
    limit: Math.min(Math.max(rawLimit, 1), MAX_LIMIT),
    offset: Math.max(rawOffset, 0),
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function likePattern(value: string): string {
  return `%${escapeLike(value)}%`
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))]
}

function assertSyncPolicy(value: unknown): SyncPolicy {
  if (value === 'inherit' || value === 'sync' || value === 'local') return value
  throw validationError('Sync policy must be inherit, sync, or local.')
}

function isPromptVariable(value: unknown): value is PromptVariable {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PromptVariable>
  return typeof candidate.name === 'string' && typeof candidate.type === 'string'
}

function parseVariables(json: string | null | undefined): PromptVariable[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter(isPromptVariable) : []
  } catch {
    return []
  }
}

function mergeVariables(systemPrompt: string, userPrompt: string, stored: PromptVariable[]): PromptVariable[] {
  return mergeVariableDefs([systemPrompt, userPrompt], stored)
}

function assertPromptFields(
  title: string,
  systemPrompt: string,
  userPrompt: string,
  variables: PromptVariable[],
): void {
  const fields: Array<{ path: string; message: string }> = []
  if (!title.trim()) fields.push({ path: 'title', message: 'Title is required.' })
  if (!systemPrompt.trim() && !userPrompt.trim()) {
    fields.push({ path: 'systemPrompt', message: 'Enter a system prompt or a user prompt.' })
  }
  for (const message of validateVariableDefinitions(variables)) {
    fields.push({ path: 'variables', message })
  }
  if (fields.length) throw validationError('The prompt is invalid.', fields)
}

function normalizeFolderInput(value: string | undefined): string {
  const folder = normalizeFolder(value)
  const error = validateFolder(folder)
  if (error) throw validationError(error, [{ path: 'folder', message: error }])
  return folder
}

function excerptOf(userPrompt: string, systemPrompt: string): string {
  const text = (userPrompt.trim() || systemPrompt.trim()).replace(/\s+/g, ' ')
  if (text.length <= EXCERPT_LENGTH) return text
  return `${text.slice(0, EXCERPT_LENGTH).trimEnd()}...`
}

function rowToAsset(row: Record<string, unknown>): AssetRecord {
  return {
    id: row.id as string,
    kind: row.kind as AssetRecord['kind'],
    title: row.title as string,
    slug: row.slug as string,
    folder: row.folder as string,
    description: row.description as string,
    syncPolicy: row.sync_policy as SyncPolicy,
    source: row.source as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
  }
}

function selectPromptRows(
  ctx: AppContext,
  where: string[],
  params: unknown[],
  sort: PromptQuery['sort'] = 'updated',
  order?: 'asc' | 'desc',
): PromptRow[] {
  const direction = order === 'asc' ? 'ASC' : order === 'desc' ? 'DESC' : sort === 'title' ? 'ASC' : 'DESC'
  let orderBy: string
  switch (sort) {
    case 'created':
      orderBy = `assets.created_at ${direction}, assets.id ASC`
      break
    case 'title':
      orderBy = `assets.title COLLATE NOCASE ${direction}, assets.id ASC`
      break
    case 'usage':
      orderBy = `COALESCE(p.usage_count, 0) ${direction}, assets.id ASC`
      break
    default:
      orderBy = `assets.updated_at ${direction}, assets.id ASC`
      break
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = ctx.db
    .prepare(
      `SELECT assets.id, assets.kind, assets.title, assets.slug, assets.folder, assets.description,
              assets.sync_policy, assets.source, assets.created_at, assets.updated_at, assets.deleted_at,
              p.system_prompt AS systemPrompt, p.user_prompt AS userPrompt,
              p.variables_json AS variablesJson, p.usage_count AS usageCount,
              p.is_favorite AS isFavorite, p.is_pinned AS isPinned,
              (SELECT COUNT(*) FROM sync_changes sc
                WHERE sc.asset_id = assets.id AND sc.status IN ('open', 'reviewed')) AS pendingChangeCount
       FROM assets
       LEFT JOIN prompts p ON p.asset_id = assets.id
       ${clause}
       ORDER BY ${orderBy}`,
    )
    .all(...params) as Array<Record<string, unknown>>

  return rows.map((row) => {
    const systemPrompt = (row.systemPrompt as string | null) ?? ''
    const userPrompt = (row.userPrompt as string | null) ?? ''
    return {
      asset: rowToAsset(row),
      systemPrompt,
      userPrompt,
      variables: mergeVariables(systemPrompt, userPrompt, parseVariables(row.variablesJson as string | null)),
      usageCount: (row.usageCount as number | null) ?? 0,
      isFavorite: !!row.isFavorite,
      isPinned: !!row.isPinned,
      pendingChangeCount: (row.pendingChangeCount as number | null) ?? 0,
    }
  })
}

function promptFilterParts(query: PromptQuery | PromptFolderQuery): SqlFilter {
  const where: string[] = []
  const params: unknown[] = []

  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const pattern = likePattern(search)
    where.push(
      `(assets.title LIKE ? ESCAPE '\\' OR assets.description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = assets.id AND t.tag LIKE ? ESCAPE '\\'))`,
    )
    params.push(pattern, pattern, pattern)
  }

  for (const raw of query.tags ?? []) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim()
    if (!tag) continue
    where.push('EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = assets.id AND t.tag = ?)')
    params.push(tag)
  }

  if (query.favorite !== undefined) {
    where.push('EXISTS (SELECT 1 FROM prompts fp WHERE fp.asset_id = assets.id AND fp.is_favorite = ?)')
    params.push(query.favorite ? 1 : 0)
  }
  if (query.pinned !== undefined) {
    where.push('EXISTS (SELECT 1 FROM prompts pp WHERE pp.asset_id = assets.id AND pp.is_pinned = ?)')
    params.push(query.pinned ? 1 : 0)
  }

  return { where, params }
}

function withFolderFilter(parts: SqlFilter, query: PromptQuery): SqlFilter {
  const folder = normalizeFolder(query.folder)
  if (!folder) return parts
  if (query.includeDescendants === false) {
    return { where: [...parts.where, 'assets.folder = ?'], params: [...parts.params, folder] }
  }
  return {
    where: [...parts.where, `(assets.folder = ? OR assets.folder LIKE ? ESCAPE '\\')`],
    params: [...parts.params, folder, `${escapeLike(folder)}/%`],
  }
}

function filterBySyncState(ctx: AppContext, rows: PromptRow[], syncState: AssetSyncState | undefined): PromptRow[] {
  if (!syncState) return rows
  const effective = new Map<SyncPolicy, boolean>()
  return rows.filter((row) => {
    let isEffective = effective.get(row.asset.syncPolicy)
    if (isEffective === undefined) {
      isEffective = effectiveSync(ctx, KIND, row.asset.syncPolicy)
      effective.set(row.asset.syncPolicy, isEffective)
    }
    return syncStateFor(ctx, row.asset.id, isEffective) === syncState
  })
}

function folderTreeFromRows(rows: PromptRow[]): FolderNode[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const folder = row.asset.folder
    if (!folder) continue
    counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  return buildFolderTree(
    [...counts].map(([path, count]) => ({ path, direct: count, total: count })),
  )
}

function currentPromptFile(ctx: AppContext, assetId: string): { revision: RevisionRecord; content: string } {
  const revision = ctx.assets.currentRevision(assetId)
  const files = ctx.assets.revisionFiles(revision.id)
  const file =
    files.find((entry) => entry.mediaKind === 'text' && entry.path.endsWith('.prompt.md')) ??
    files.find((entry) => entry.mediaKind === 'text')
  if (!file) throw new AppError('CORRUPT', 'This prompt has no readable canonical file.')
  return { revision, content: ctx.blobs.readSync(file.blobHash).toString('utf8') }
}

function loadPromptRecord(ctx: AppContext, assetId: string, includeDeleted = false): PromptRecord {
  const asset = ctx.assets.getAsset(assetId, includeDeleted)
  if (asset.kind !== KIND) throw new AppError('NOT_FOUND', 'This prompt no longer exists.')

  const row = ctx.db
    .prepare(
      'SELECT system_prompt AS systemPrompt, user_prompt AS userPrompt, variables_json AS variablesJson, usage_count AS usageCount, is_favorite AS isFavorite, is_pinned AS isPinned FROM prompts WHERE asset_id = ?',
    )
    .get(assetId) as
    | {
        systemPrompt: string
        userPrompt: string
        variablesJson: string
        usageCount: number
        isFavorite: number
        isPinned: number
      }
    | undefined

  if (row) {
    return {
      asset,
      systemPrompt: row.systemPrompt,
      userPrompt: row.userPrompt,
      variables: mergeVariables(row.systemPrompt, row.userPrompt, parseVariables(row.variablesJson)),
      usageCount: row.usageCount,
      isFavorite: !!row.isFavorite,
      isPinned: !!row.isPinned,
    }
  }

  const file = currentPromptFile(ctx, assetId)
  const parsed = parsePromptFile(file.content)
  if (!parsed.model) throw new AppError('CORRUPT', parsed.error ?? 'The canonical prompt file could not be parsed.')
  return {
    asset,
    systemPrompt: parsed.model.systemPrompt,
    userPrompt: parsed.model.userPrompt,
    variables: mergeVariables(parsed.model.systemPrompt, parsed.model.userPrompt, parsed.model.variables),
    usageCount: 0,
    isFavorite: false,
    isPinned: false,
  }
}

function savePromptRecord(
  ctx: AppContext,
  assetId: string,
  systemPrompt: string,
  userPrompt: string,
  variables: PromptVariable[],
): void {
  ctx.db
    .prepare(
      `INSERT INTO prompts (asset_id, system_prompt, user_prompt, variables_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         system_prompt = excluded.system_prompt,
         user_prompt = excluded.user_prompt,
         variables_json = excluded.variables_json`,
    )
    .run(assetId, systemPrompt, userPrompt, JSON.stringify(variables))
}

function savePromptFlags(ctx: AppContext, assetId: string, flags: Partial<Pick<PromptRecord, 'isFavorite' | 'isPinned'>>): void {
  if (flags.isFavorite !== undefined) {
    ctx.db
      .prepare(
        `INSERT INTO prompts (asset_id, is_favorite) VALUES (?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET is_favorite = excluded.is_favorite`,
      )
      .run(assetId, flags.isFavorite ? 1 : 0)
  }
  if (flags.isPinned !== undefined) {
    ctx.db
      .prepare(
        `INSERT INTO prompts (asset_id, is_pinned) VALUES (?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET is_pinned = excluded.is_pinned`,
      )
      .run(assetId, flags.isPinned ? 1 : 0)
  }
}

function promptDetail(ctx: AppContext, record: PromptRecord): PromptDetail {
  return {
    ...assetBase(ctx, record.asset),
    kind: KIND,
    systemPrompt: record.systemPrompt,
    userPrompt: record.userPrompt,
    variables: record.variables,
    usageCount: record.usageCount,
    isFavorite: record.isFavorite,
    isPinned: record.isPinned,
  }
}

function promptListItem(ctx: AppContext, record: PromptRow): PromptListItem {
  return {
    ...assetBase(ctx, record.asset),
    kind: KIND,
    excerpt: excerptOf(record.userPrompt, record.systemPrompt),
    variableCount: record.variables.length,
    usageCount: record.usageCount,
    isFavorite: record.isFavorite,
    isPinned: record.isPinned,
    pendingChangeCount: record.pendingChangeCount,
  }
}

function revisionSummaries(ctx: AppContext, assetId: string): RevisionSummary[] {
  return ctx.assets.versions(assetId).map((revision) => {
    const files = ctx.assets.revisionFiles(revision.id).map((file) => {
      if (file.mediaKind === 'binary' || file.size > MAX_REVISION_FILE_BYTES) {
        return { path: file.path, content: null }
      }
      try {
        return { path: file.path, content: ctx.blobs.readSync(file.blobHash).toString('utf8') }
      } catch {
        return { path: file.path, content: null }
      }
    })
    return {
      id: revision.id,
      version: revision.version,
      note: revision.note,
      manifestHash: revision.manifestHash,
      createdAt: revision.createdAt,
      files,
    }
  })
}

function serializeModel(
  asset: AssetRecord,
  title: string,
  description: string,
  folder: string,
  tags: string[],
  systemPrompt: string,
  userPrompt: string,
  variables: PromptVariable[],
): string {
  const model: PromptFileModel = {
    id: asset.id,
    title,
    description,
    folder,
    tags,
    variables,
    syncPolicy: asset.syncPolicy,
    systemPrompt,
    userPrompt,
  }
  return serializePromptFile(model)
}

export function createPromptService(ctx: AppContext): PromptService {
  async function get(id: string): Promise<PromptDetail> {
    const record = loadPromptRecord(ctx, id)
    return promptDetail(ctx, record)
  }

  return {
    async list(query: PromptQuery): Promise<AssetListResult<PromptListItem>> {
      const { limit, offset } = pageParams(query)
      const baseParts = promptFilterParts(query)
      const listParts = withFolderFilter(baseParts, query)
      const rows = filterBySyncState(ctx, selectPromptRows(ctx, [...BASE_WHERE, ...listParts.where], listParts.params, query.sort, query.order), query.syncState)
      const total = rows.length
      const pageRows = rows.slice(offset, offset + limit)
      const items = pageRows.map((row) => promptListItem(ctx, row))

      let folders: FolderNode[]
      if (query.syncState) {
        const treeRows = filterBySyncState(
          ctx,
          selectPromptRows(ctx, [...BASE_WHERE, ...baseParts.where], baseParts.params),
          query.syncState,
        )
        folders = folderTreeFromRows(treeRows)
      } else {
        const clause = baseParts.where.length ? ` AND ${baseParts.where.join(' AND ')}` : ''
        folders = ctx.assets.folderTree(KIND, clause, baseParts.params)
      }

      return { items, total, limit, offset, folders }
    },

    get,

    async versions(id: string): Promise<RevisionSummary[]> {
      const record = loadPromptRecord(ctx, id, true)
      return revisionSummaries(ctx, record.asset.id)
    },

    async create(input: PromptCreateInput): Promise<PromptDetail> {
      const title = asText(input.title).trim()
      const folder = normalizeFolderInput(asText(input.folder))
      const systemPrompt = asText(input.systemPrompt).trim()
      const userPrompt = asText(input.userPrompt).trim()
      const storedVariables = Array.isArray(input.variables) ? input.variables.filter(isPromptVariable) : []
      const variables = mergeVariables(systemPrompt, userPrompt, storedVariables)
      assertPromptFields(title, systemPrompt, userPrompt, variables)
      const syncPolicy = input.syncPolicy === undefined ? 'inherit' : assertSyncPolicy(input.syncPolicy)
      const description = asText(input.description).trim()
      const tags = sanitizeTags(input.tags)

      const assetId = newId('ast')
      const slug = ctx.assets.allocateSlug(KIND, folder, title)
      const content = serializePromptFile({
        id: assetId,
        title,
        description,
        folder,
        tags,
        variables,
        syncPolicy,
        systemPrompt,
        userPrompt,
      })

      const { asset } = ctx.assets.createAsset({
        id: assetId,
        kind: KIND,
        title,
        slug,
        folder,
        description,
        tags,
        syncPolicy,
        files: [{ path: `${slug}.prompt.md`, content }],
      })
      savePromptRecord(ctx, asset.id, systemPrompt, userPrompt, variables)
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('prompts', 'created', [asset.id])
      return get(asset.id)
    },

    async update(input: PromptUpdateInput): Promise<PromptDetail> {
      const current = loadPromptRecord(ctx, input.id)
      const title = input.title !== undefined ? asText(input.title).trim() : current.asset.title
      const description = input.description !== undefined ? asText(input.description).trim() : current.asset.description
      const folder = input.folder !== undefined ? normalizeFolderInput(asText(input.folder)) : current.asset.folder
      const tags = input.tags !== undefined ? sanitizeTags(input.tags) : ctx.assets.tags(current.asset.id)
      const systemPrompt = input.systemPrompt !== undefined ? asText(input.systemPrompt).trim() : current.systemPrompt
      const userPrompt = input.userPrompt !== undefined ? asText(input.userPrompt).trim() : current.userPrompt
      const storedVariables =
        input.variables !== undefined
          ? Array.isArray(input.variables)
            ? input.variables.filter(isPromptVariable)
            : []
          : current.variables
      const variables = mergeVariables(systemPrompt, userPrompt, storedVariables)
      assertPromptFields(title, systemPrompt, userPrompt, variables)

      const latest = ctx.assets.currentRevision(current.asset.id)
      if (latest.id !== input.expectedRevisionId) {
        throw new AppError('REVISION_CONFLICT', 'This prompt changed after the editor was opened.', {
          kind: 'revision-conflict',
          currentRevisionId: latest.id,
          currentVersion: latest.version,
          updatedAt: current.asset.updatedAt,
        })
      }

      const asset = ctx.assets.setMetadata(current.asset.id, { title, description, folder, tags })
      const content = serializeModel(asset, title, description, folder, tags, systemPrompt, userPrompt, variables)
      ctx.assets.addRevision(
        asset.id,
        [{ path: `${asset.slug}.prompt.md`, content }],
        null,
        input.expectedRevisionId,
      )
      savePromptRecord(ctx, asset.id, systemPrompt, userPrompt, variables)
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('prompts', 'updated', [asset.id])
      return get(asset.id)
    },

    async delete(input: DeleteInput): Promise<DeleteResult> {
      if (input.confirm !== true) throw validationError('Deleting a prompt requires explicit confirmation.')
      const record = loadPromptRecord(ctx, input.id)
      const withdrawnChangeIds = withdrawPendingChanges(ctx, record.asset.id)
      const deletedAt = ctx.assets.softDelete(record.asset.id)
      ctx.events.domainChanged('prompts', 'deleted', [record.asset.id])
      return { id: record.asset.id, deletedAt, withdrawnChangeIds }
    },

    async restore(input: { id: string }): Promise<PromptDetail> {
      const asset = ctx.assets.getAsset(input.id, true)
      if (asset.kind !== KIND) throw new AppError('NOT_FOUND', 'This prompt no longer exists.')
      ctx.assets.restoreAsset(asset.id)
      ctx.events.domainChanged('prompts', 'restored', [asset.id])
      return get(asset.id)
    },

    async restoreVersion(input: RestoreVersionInput): Promise<PromptDetail> {
      const current = loadPromptRecord(ctx, input.id)
      const revision = ctx.assets.getRevision(input.revisionId)
      if (revision.assetId !== current.asset.id) {
        throw new AppError('NOT_FOUND', 'This version does not belong to the prompt.')
      }
      const files = ctx.assets.revisionFiles(revision.id)
      const file =
        files.find((entry) => entry.mediaKind === 'text' && entry.path.endsWith('.prompt.md')) ??
        files.find((entry) => entry.mediaKind === 'text')
      if (!file) throw new AppError('CORRUPT', 'This version has no readable prompt file.')
      const parsed = parsePromptFile(ctx.blobs.readSync(file.blobHash).toString('utf8'))
      if (!parsed.model) throw new AppError('CORRUPT', parsed.error ?? 'This version could not be parsed.')
      if (parsed.model.id && parsed.model.id !== current.asset.id) {
        throw new AppError('CORRUPT', 'This historical revision belongs to a different prompt.')
      }

      const systemPrompt = parsed.model.systemPrompt
      const userPrompt = parsed.model.userPrompt
      const variables = mergeVariables(systemPrompt, userPrompt, parsed.model.variables)
      const content = serializeModel(
        current.asset,
        current.asset.title,
        current.asset.description,
        current.asset.folder,
        ctx.assets.tags(current.asset.id),
        systemPrompt,
        userPrompt,
        variables,
      )
      ctx.assets.addRevision(
        current.asset.id,
        [{ path: `${current.asset.slug}.prompt.md`, content }],
        input.note ?? `Restored from version ${revision.version}`,
        input.expectedRevisionId,
      )
      savePromptRecord(ctx, current.asset.id, systemPrompt, userPrompt, variables)
      recordLocalChange(ctx, current.asset.id)
      ctx.events.domainChanged('prompts', 'restored', [current.asset.id])
      return get(current.asset.id)
    },

    async copyRender(input: PromptCopyInput): Promise<PromptCopyResult> {
      const record = loadPromptRecord(ctx, input.id)
      const values: Record<string, string> = {}
      if (input.values && typeof input.values === 'object') {
        for (const [key, value] of Object.entries(input.values)) {
          if (typeof value === 'string') values[key] = value
        }
      }

      const renderedSystem = renderTemplate(record.systemPrompt, values)
      const renderedUser = renderTemplate(record.userPrompt, values)
      const text = [renderedSystem.text.trim(), renderedUser.text.trim()].filter(Boolean).join('\n\n')
      const unresolvedVariables = [...new Set([...renderedSystem.unresolved, ...renderedUser.unresolved])]
      const warnings = unresolvedVariables.map(
        (name) => `Variable "{{${name}}}" has no value and remains visible.`,
      )

      savePromptRecord(ctx, record.asset.id, record.systemPrompt, record.userPrompt, record.variables)
      const usageCount = ctx.assets.bumpUsage(record.asset.id)

      let wroteClipboard = false
      if (input.writeClipboard === true) {
        try {
          clipboard.writeText(text)
          wroteClipboard = true
        } catch {
          warnings.push('The clipboard could not be written. Select the text and copy it manually.')
        }
      }

      ctx.events.domainChanged('prompts', 'updated', [record.asset.id])
      return { text, unresolvedVariables, warnings, usageCount, wroteClipboard }
    },

    async setSyncPolicy(input: SetSyncPolicyInput): Promise<AssetSyncPolicyResult> {
      const syncPolicy = assertSyncPolicy(input.syncPolicy)
      const record = loadPromptRecord(ctx, input.id)
      const withdrawnChangeIds =
        syncPolicy === 'local' ? withdrawPendingChanges(ctx, record.asset.id) : []
      const asset = ctx.assets.setMetadata(record.asset.id, { syncPolicy })
      ctx.events.domainChanged('prompts', 'updated', [asset.id])
      return {
        id: asset.id,
        syncPolicy,
        effectiveSync: effectiveSync(ctx, KIND, syncPolicy),
        withdrawnChangeIds,
      }
    },

    async setFavorite(input: SetFavoriteInput): Promise<FavoriteResult> {
      const record = loadPromptRecord(ctx, input.id)
      savePromptRecord(ctx, record.asset.id, record.systemPrompt, record.userPrompt, record.variables)
      savePromptFlags(ctx, record.asset.id, { isFavorite: input.favorite === true })
      ctx.events.domainChanged('prompts', 'updated', [record.asset.id])
      return { id: record.asset.id, isFavorite: input.favorite === true }
    },

    async setPinned(input: SetPinnedInput): Promise<PinnedResult> {
      const record = loadPromptRecord(ctx, input.id)
      savePromptRecord(ctx, record.asset.id, record.systemPrompt, record.userPrompt, record.variables)
      savePromptFlags(ctx, record.asset.id, { isPinned: input.pinned === true })
      ctx.events.domainChanged('prompts', 'updated', [record.asset.id])
      return { id: record.asset.id, isPinned: input.pinned === true }
    },

    async folders(query: PromptFolderQuery): Promise<FolderNode[]> {
      const parts = promptFilterParts(query)
      const clause = parts.where.length ? ` AND ${parts.where.join(' AND ')}` : ''
      return ctx.assets.folderTree(KIND, clause, parts.params)
    },

    async storeList(query: StoreQuery): Promise<Page<PromptStoreItem>> {
      const { limit, offset } = pageParams(query)
      const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''
      const category = typeof query.category === 'string' ? query.category.trim().toLowerCase() : ''
      const filtered = STORE_ITEMS.filter((item) => {
        if (category && item.category.toLowerCase() !== category) return false
        if (!search) return true
        return (
          item.title.toLowerCase().includes(search) ||
          item.description.toLowerCase().includes(search) ||
          item.tags.some((tag) => tag.toLowerCase().includes(search))
        )
      })
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      }
    },
  }
}

/**
 * Curated demo catalog. These entries are static English sample data and are
 * intentionally not part of the user's library until the renderer creates a Prompt.
 */
const STORE_ITEMS: PromptStoreItem[] = [
  {
    id: 'store-code-review',
    title: 'Code Review Assistant',
    description: 'Reviews a change for correctness, readability, performance, and security.',
    author: 'Prompt Keeper Team',
    category: 'Engineering',
    tags: ['Engineering', 'Code Review'],
    systemPrompt: 'You are a senior engineer reviewing code. Be direct, cite lines, and rank findings by severity.',
    userPrompt: 'Review this {{language}} code:\n\n{{code}}',
    variables: [
      { name: 'language', type: 'text', label: 'Language', example: 'TypeScript', required: true },
      { name: 'code', type: 'textarea', label: 'Code', required: true },
    ],
    uses: 1280,
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
  {
    id: 'store-incident-postmortem',
    title: 'Incident Postmortem Writer',
    description: 'Turns an incident timeline into a blameless postmortem with action items.',
    author: 'Prompt Keeper Team',
    category: 'Operations',
    tags: ['Operations', 'Incident'],
    systemPrompt: 'You write blameless postmortems. Separate contributing factors from the root cause and assign owners.',
    userPrompt: 'Write a postmortem for {{service}} using this timeline:\n\n{{timeline}}',
    variables: [
      { name: 'service', type: 'text', label: 'Service', example: 'Checkout API', required: true },
      { name: 'timeline', type: 'textarea', label: 'Timeline', required: true },
    ],
    uses: 640,
    updatedAt: '2026-09-18T14:30:00.000Z',
  },
  {
    id: 'store-api-contract-review',
    title: 'API Contract Reviewer',
    description: 'Checks an API change for breaking changes, naming consistency, and error handling.',
    author: 'Prompt Keeper Team',
    category: 'Engineering',
    tags: ['API', 'Review'],
    systemPrompt: 'You are an API reviewer. Flag breaking changes and missing error semantics before style issues.',
    userPrompt: 'Review this API specification:\n\n{{spec}}\n\nRecent changes:\n\n{{changes}}',
    variables: [
      { name: 'spec', type: 'textarea', label: 'API specification', required: true },
      { name: 'changes', type: 'textarea', label: 'Recent changes', required: true },
    ],
    uses: 512,
    updatedAt: '2026-09-05T11:15:00.000Z',
  },
  {
    id: 'store-launch-copy',
    title: 'Product Launch Copy',
    description: 'Drafts a concise launch announcement and a short social post.',
    author: 'Prompt Keeper Team',
    category: 'Marketing',
    tags: ['Marketing', 'Launch'],
    systemPrompt: 'You write plain, specific launch copy with no hype. Lead with the user benefit.',
    userPrompt: 'Write launch copy for {{product}} aimed at {{audience}}. Key features:\n\n{{features}}',
    variables: [
      { name: 'product', type: 'text', label: 'Product', required: true },
      { name: 'audience', type: 'text', label: 'Audience', example: 'Backend developers', required: true },
      { name: 'features', type: 'textarea', label: 'Features', required: true },
    ],
    uses: 730,
    updatedAt: '2026-08-22T08:45:00.000Z',
  },
  {
    id: 'store-sql-explainer',
    title: 'SQL Query Explainer',
    description: 'Explains a query step by step and suggests safer or faster alternatives.',
    author: 'Prompt Keeper Team',
    category: 'Data',
    tags: ['Data', 'SQL'],
    systemPrompt: 'You explain SQL precisely. Describe joins and filters in execution order and call out unsafe updates.',
    userPrompt: 'Explain this {{dialect}} query:\n\n{{query}}',
    variables: [
      { name: 'dialect', type: 'select', label: 'Dialect', options: ['PostgreSQL', 'MySQL', 'SQLite'], required: true },
      { name: 'query', type: 'textarea', label: 'Query', required: true },
    ],
    uses: 421,
    updatedAt: '2026-07-30T16:20:00.000Z',
  },
]
