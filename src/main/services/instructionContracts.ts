import type {
  AssetListResult,
  AssetSyncPolicyResult,
  AssetSyncState,
  CompiledFile,
  ContractActivation,
  ContractCompileInput,
  ContractCompileResult,
  ContractCreateInput,
  ContractDetail,
  ContractFileModel,
  ContractListItem,
  ContractQuery,
  ContractResolveInput,
  ContractScope,
  ContractTarget,
  ContractUpdateInput,
  DeleteInput,
  DeleteResult,
  FolderNode,
  ResolvedPreview,
  RestoreVersionInput,
  RevisionSummary,
  SetSyncPolicyInput,
  TargetCompatibility,
} from '../../shared/contracts'
import { compileFileSet, resolveContracts, type CompileTarget } from '../../shared/domain/compiler'
import {
  normalizeActivation,
  parseContractFile,
  serializeContractFile,
} from '../../shared/domain/contractFile'
import { AppError, validationError } from '../../shared/domain/errors'
import { buildFolderTree, isSafeRelativePath, normalizeFolder, safePathSegment, validateFolder } from '../../shared/domain/folders'
import { newId } from '../../shared/domain/ids'
import {
  GLOBAL_TARGET_BY_ID,
  PROJECT_TARGETS,
  TARGET_BY_ID,
  defaultGlobalTargetPath,
  resolveGlobalProjectionPath,
  targetCompatibility,
  type GlobalTargetDef,
} from '../../shared/domain/targets'
import { sha256Hex } from '../adapters/hash'
import type { AppContext } from '../context'
import type { AssetRecord } from './assetStore'
import {
  assetBase,
  effectiveSync,
  recordLocalChange,
  syncStateFor,
  withdrawPendingChanges,
} from './assetSyncState'
import type { ContractService } from './types'

const KIND = 'contract' as const
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_PRIORITY = 50

const BASE_WHERE = ["assets.kind = 'contract'", 'assets.deleted_at IS NULL']

interface ContractRecord {
  asset: AssetRecord
  body: string
  scope: ContractScope
  pathPrefix: string | null
  activation: ContractActivation
  priority: number
  imports: string[]
  targetIds: string[]
}

interface ContractRow extends ContractRecord {
  pendingChangeCount: number
}

interface SqlFilter {
  where: string[]
  params: unknown[]
}

interface ProjectSelection {
  projectId?: string
  warnings: string[]
}

interface TargetSelection {
  target: CompileTarget
  globalTarget?: GlobalTargetDef
  /** Absolute-ish global path, or the relative template for project targets. */
  basePath: string
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

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseActivation(value: unknown): ContractActivation {
  if (typeof value !== 'string' || !value) return { mode: 'always', globs: [] }
  try {
    return normalizeActivation(JSON.parse(value) as unknown)
  } catch {
    return { mode: 'always', globs: [] }
  }
}

function normalizeActivationInput(value: unknown): ContractActivation {
  const activation = normalizeActivation(value)
  const globs = activation.globs.map((glob) => glob.trim()).filter(Boolean)
  const description = activation.description?.trim()
  return { mode: activation.mode, globs, ...(description ? { description } : {}) }
}

function normalizeImports(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const imports = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\\/g, '/'))
    .filter(Boolean)
  return [...new Set(imports)]
}

function normalizeTargetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(ids)]
}

function normalizePriority(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
}

function normalizeScope(value: unknown): ContractScope | null {
  return value === 'user' || value === 'project' || value === 'path' ? value : null
}

function assertSyncPolicy(value: unknown): 'inherit' | 'sync' | 'local' {
  if (value === 'inherit' || value === 'sync' || value === 'local') return value
  throw validationError('Sync policy must be inherit, sync, or local.')
}

function normalizeFolderInput(value: string | undefined): string {
  const folder = normalizeFolder(value)
  const error = validateFolder(folder)
  if (error) throw validationError(error, [{ path: 'folder', message: error }])
  return folder
}

function rowToAsset(row: Record<string, unknown>): AssetRecord {
  return {
    id: row.id as string,
    kind: row.kind as AssetRecord['kind'],
    title: row.title as string,
    slug: row.slug as string,
    folder: row.folder as string,
    description: row.description as string,
    syncPolicy: row.sync_policy as AssetRecord['syncPolicy'],
    source: row.source as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
  }
}

function rowToContractRow(row: Record<string, unknown>): ContractRow {
  const rawPathPrefix = row.path_prefix as string | null
  return {
    asset: rowToAsset(row),
    body: (row.body as string | null) ?? '',
    scope: (row.scope as ContractScope | null) ?? 'project',
    pathPrefix: rawPathPrefix && rawPathPrefix.trim() ? rawPathPrefix : null,
    activation: parseActivation(row.activation_json),
    priority: (row.priority as number | null) ?? DEFAULT_PRIORITY,
    imports: parseStringArray(row.imports_json),
    targetIds: parseStringArray(row.target_ids_json),
    pendingChangeCount: (row.pendingChangeCount as number | null) ?? 0,
  }
}

function selectContractRows(
  ctx: AppContext,
  where: string[],
  params: unknown[],
  sort: ContractQuery['sort'] = 'updated',
  order?: 'asc' | 'desc',
): ContractRow[] {
  const direction = order === 'asc' ? 'ASC' : order === 'desc' ? 'DESC' : sort === 'title' ? 'ASC' : 'DESC'
  let orderBy: string
  switch (sort) {
    case 'created':
      orderBy = `assets.created_at ${direction}, assets.id ASC`
      break
    case 'title':
      orderBy = `assets.title COLLATE NOCASE ${direction}, assets.id ASC`
      break
    case 'priority':
      orderBy = `COALESCE(c.priority, ${DEFAULT_PRIORITY}) ${direction}, assets.id ASC`
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
              c.body, c.scope, c.path_prefix, c.activation_json, c.priority, c.imports_json, c.target_ids_json,
              (SELECT COUNT(*) FROM sync_changes sc
                WHERE sc.asset_id = assets.id AND sc.status IN ('open', 'reviewed')) AS pendingChangeCount
       FROM assets
       LEFT JOIN contracts c ON c.asset_id = assets.id
       ${clause}
       ORDER BY ${orderBy}`,
    )
    .all(...params) as Array<Record<string, unknown>>
  return rows.map(rowToContractRow)
}

function contractFilterParts(query: ContractQuery): SqlFilter {
  const where: string[] = []
  const params: unknown[] = []

  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const pattern = likePattern(search)
    where.push(
      `(assets.title LIKE ? ESCAPE '\\' OR assets.description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM contracts cs WHERE cs.asset_id = assets.id AND cs.body LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = assets.id AND t.tag LIKE ? ESCAPE '\\'))`,
    )
    params.push(pattern, pattern, pattern, pattern)
  }

  for (const raw of query.tags ?? []) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim()
    if (!tag) continue
    where.push('EXISTS (SELECT 1 FROM tags t WHERE t.asset_id = assets.id AND t.tag = ?)')
    params.push(tag)
  }

  if (query.scope) {
    where.push('EXISTS (SELECT 1 FROM contracts c WHERE c.asset_id = assets.id AND c.scope = ?)')
    params.push(query.scope)
  }
  if (query.activationMode) {
    where.push(
      `EXISTS (SELECT 1 FROM contracts c WHERE c.asset_id = assets.id
         AND json_valid(c.activation_json)
         AND json_extract(c.activation_json, '$.mode') = ?)`,
    )
    params.push(query.activationMode)
  }
  if (query.targetId) {
    where.push(
      `EXISTS (SELECT 1 FROM contracts c WHERE c.asset_id = assets.id
         AND json_valid(c.target_ids_json)
         AND EXISTS (SELECT 1 FROM json_each(c.target_ids_json) j WHERE j.value = ?))`,
    )
    params.push(query.targetId)
  }

  return { where, params }
}

function withFolderFilter(parts: SqlFilter, query: ContractQuery): SqlFilter {
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

function filterBySyncState(
  ctx: AppContext,
  rows: ContractRow[],
  syncState: AssetSyncState | undefined,
): ContractRow[] {
  if (!syncState) return rows
  const effective = new Map<AssetRecord['syncPolicy'], boolean>()
  return rows.filter((row) => {
    let isEffective = effective.get(row.asset.syncPolicy)
    if (isEffective === undefined) {
      isEffective = effectiveSync(ctx, KIND, row.asset.syncPolicy)
      effective.set(row.asset.syncPolicy, isEffective)
    }
    return syncStateFor(ctx, row.asset.id, isEffective) === syncState
  })
}

function folderTreeFromRows(rows: ContractRow[]): FolderNode[] {
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

function currentContractFile(ctx: AppContext, assetId: string): string {
  const revision = ctx.assets.currentRevision(assetId)
  const files = ctx.assets.revisionFiles(revision.id)
  const file =
    files.find((entry) => entry.mediaKind === 'text' && entry.path.endsWith('.contract.md')) ??
    files.find((entry) => entry.mediaKind === 'text')
  if (!file) throw new AppError('CORRUPT', 'This contract has no readable canonical file.')
  return ctx.blobs.readSync(file.blobHash).toString('utf8')
}

function loadContractRecord(ctx: AppContext, assetId: string, includeDeleted = false): ContractRecord {
  const asset = ctx.assets.getAsset(assetId, includeDeleted)
  if (asset.kind !== KIND) throw new AppError('NOT_FOUND', 'This contract no longer exists.')

  const row = ctx.db
    .prepare(
      `SELECT c.body, c.scope, c.path_prefix, c.activation_json, c.priority, c.imports_json, c.target_ids_json
       FROM contracts c WHERE c.asset_id = ?`,
    )
    .get(assetId) as Record<string, unknown> | undefined

  if (row) {
    const rawPathPrefix = row.path_prefix as string | null
    return {
      asset,
      body: (row.body as string | null) ?? '',
      scope: (row.scope as ContractScope | null) ?? 'project',
      pathPrefix: rawPathPrefix && rawPathPrefix.trim() ? rawPathPrefix : null,
      activation: parseActivation(row.activation_json),
      priority: (row.priority as number | null) ?? DEFAULT_PRIORITY,
      imports: parseStringArray(row.imports_json),
      targetIds: parseStringArray(row.target_ids_json),
    }
  }

  const parsed = parseContractFile(currentContractFile(ctx, assetId))
  if (!parsed.model) throw new AppError('CORRUPT', parsed.error ?? 'The canonical contract file could not be parsed.')
  return {
    asset,
    body: parsed.model.body,
    scope: parsed.model.scope,
    pathPrefix: parsed.model.pathPrefix,
    activation: parsed.model.activation,
    priority: parsed.model.priority,
    imports: parsed.model.imports,
    targetIds: parsed.model.targetIds,
  }
}

function saveContractRecord(ctx: AppContext, assetId: string, record: Omit<ContractRecord, 'asset'>): void {
  ctx.db
    .prepare(
      `INSERT INTO contracts (asset_id, body, scope, path_prefix, activation_json, priority, imports_json, target_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         body = excluded.body,
         scope = excluded.scope,
         path_prefix = excluded.path_prefix,
         activation_json = excluded.activation_json,
         priority = excluded.priority,
         imports_json = excluded.imports_json,
         target_ids_json = excluded.target_ids_json`,
    )
    .run(
      assetId,
      record.body,
      record.scope,
      record.pathPrefix,
      JSON.stringify(record.activation),
      record.priority,
      JSON.stringify(record.imports),
      JSON.stringify(record.targetIds),
    )
}

function contractModel(ctx: AppContext, record: ContractRecord): ContractFileModel {
  return {
    id: record.asset.id,
    title: record.asset.title,
    description: record.asset.description,
    folder: record.asset.folder,
    scope: record.scope,
    pathPrefix: record.pathPrefix,
    activation: record.activation,
    priority: record.priority,
    imports: record.imports,
    targetIds: record.targetIds,
    tags: ctx.assets.tags(record.asset.id),
    syncPolicy: record.asset.syncPolicy,
    body: record.body,
  }
}

function compatibilityFor(record: ContractRecord): TargetCompatibility[] {
  const model = { activation: record.activation, imports: record.imports }
  return record.targetIds
    .map((targetId) => TARGET_BY_ID[targetId])
    .filter((target): target is ContractTarget => !!target)
    .map((target) => targetCompatibility(model, target))
}

function contractDetail(ctx: AppContext, record: ContractRecord): ContractDetail {
  return {
    ...assetBase(ctx, record.asset),
    kind: KIND,
    body: record.body,
    scope: record.scope,
    pathPrefix: record.pathPrefix,
    activation: record.activation,
    priority: record.priority,
    imports: record.imports,
    targetIds: record.targetIds,
    compatibility: compatibilityFor(record),
  }
}

function contractListItem(ctx: AppContext, record: ContractRow): ContractListItem {
  return {
    ...assetBase(ctx, record.asset),
    kind: KIND,
    scope: record.scope,
    pathPrefix: record.pathPrefix,
    activationMode: record.activation.mode,
    priority: record.priority,
    targetIds: record.targetIds,
    compatibility: compatibilityFor(record),
    pendingChangeCount: record.pendingChangeCount,
  }
}

function revisionSummaries(ctx: AppContext, assetId: string): RevisionSummary[] {
  const MAX_REVISION_FILE_BYTES = 256 * 1024
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

interface ContractFields {
  title: string
  scope: ContractScope
  pathPrefix: string | null
  activation: ContractActivation
  imports: string[]
  targetIds: string[]
  priority: number
}

function validateContractFields(fields: ContractFields): void {
  const errors: Array<{ path: string; message: string }> = []
  if (!fields.title.trim()) errors.push({ path: 'title', message: 'Title is required.' })

  if (fields.scope === 'path') {
    if (!fields.pathPrefix) {
      errors.push({ path: 'pathPrefix', message: 'Path scope requires a non-empty path prefix.' })
    } else if (!isSafeRelativePath(fields.pathPrefix)) {
      errors.push({
        path: 'pathPrefix',
        message: 'The path prefix must be a relative directory path without "." or ".." segments.',
      })
    }
  }

  if (fields.activation.mode === 'glob' && fields.activation.globs.length === 0) {
    errors.push({ path: 'activation.globs', message: 'Glob activation requires at least one glob.' })
  }
  if (fields.activation.mode === 'model' && !(fields.activation.description ?? '').trim()) {
    errors.push({
      path: 'activation.description',
      message: 'Model-decision activation requires a description of when the contract applies.',
    })
  }

  for (const importPath of fields.imports) {
    const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(importPath)
    if (isUrl || !isSafeRelativePath(importPath)) {
      errors.push({
        path: 'imports',
        message: `Import "${importPath}" must be a relative path inside the repository and must not be a URL.`,
      })
    }
  }

  for (const targetId of fields.targetIds) {
    if (!TARGET_BY_ID[targetId]) {
      errors.push({ path: 'targetIds', message: `Target "${targetId}" is not registered.` })
    }
  }

  if (!Number.isFinite(fields.priority)) {
    errors.push({ path: 'priority', message: 'Priority must be a finite number.' })
  }

  if (errors.length) throw validationError('The contract is invalid.', errors)
}

function assertTargetWarnings(fields: ContractFields, acknowledge: boolean | undefined): void {
  const model = { activation: fields.activation, imports: fields.imports }
  const warnings = [
    ...new Set(
      fields.targetIds
        .map((targetId) => TARGET_BY_ID[targetId])
        .filter((target): target is ContractTarget => !!target)
        .flatMap((target) => targetCompatibility(model, target).warnings),
    ),
  ]
  if (warnings.length && acknowledge !== true) {
    throw new AppError('VALIDATION', 'Some selected targets cannot fully represent this contract.', {
      kind: 'target-warnings',
      warnings,
      requiresAcknowledgement: true,
    })
  }
}

function markProjectionsStale(ctx: AppContext, contractId: string): void {
  ctx.db
    .prepare("UPDATE projections SET status = 'stale' WHERE contract_id = ? AND scope = 'project' AND status = 'synced'")
    .run(contractId)
}

function selectProject(ctx: AppContext, requestedId?: string): ProjectSelection {
  const first = ctx.db
    .prepare('SELECT id, name FROM projects ORDER BY created_at LIMIT 1')
    .get() as { id: string; name: string } | undefined

  if (requestedId) {
    const requested = ctx.db
      .prepare('SELECT id, name FROM projects WHERE id = ?')
      .get(requestedId) as { id: string; name: string } | undefined
    if (requested) return { projectId: requested.id, warnings: [] }
    if (first) {
      return {
        projectId: first.id,
        warnings: [
          `Project "${requestedId}" is not registered. Previewing against "${first.name}" instead.`,
        ],
      }
    }
    return {
      warnings: [
        `Project "${requestedId}" is not registered and no project is available. Paths are previewed without a project root.`,
      ],
    }
  }

  if (first) return { projectId: first.id, warnings: [] }
  return {
    warnings: ['No project is registered. Paths are previewed without a project root.'],
  }
}

function assertResolveScope(input: { scope: unknown; projectId?: string }): 'project' | 'global' {
  if (input.scope !== 'project' && input.scope !== 'global') {
    throw validationError('Scope must be "project" or "global".')
  }
  if (input.scope === 'global' && input.projectId) {
    throw validationError('Global resolution must not include a project ID.')
  }
  return input.scope
}

function globalTargetPath(ctx: AppContext, def: GlobalTargetDef): string {
  const row = ctx.db
    .prepare('SELECT path FROM global_targets WHERE id = ?')
    .get(def.id) as { path: string } | undefined
  return row?.path?.trim() || defaultGlobalTargetPath(def, ctx.platform)
}

function selectTarget(ctx: AppContext, targetId: string, scope: 'project' | 'global'): TargetSelection {
  const id = typeof targetId === 'string' ? targetId.trim() : ''
  if (!id) throw validationError('A target is required.')

  if (scope === 'global') {
    const def = GLOBAL_TARGET_BY_ID[id]
    if (!def) {
      if (TARGET_BY_ID[id]) {
        throw new AppError('UNSUPPORTED', 'This target is a project target and cannot be used for global resolution.', {
          kind: 'unsupported',
          targetId: id,
          feature: 'scope',
          reason: 'Use scope "project" for project targets.',
        })
      }
      throw validationError(`Target "${id}" is not registered.`)
    }
    return {
      target: {
        id: def.id,
        label: def.label,
        format: def.format,
        merge: def.merge,
        supports: def.supports,
        ...(def.maxBytes !== undefined ? { maxBytes: def.maxBytes } : {}),
      },
      globalTarget: def,
      basePath: globalTargetPath(ctx, def),
    }
  }

  const target = TARGET_BY_ID[id]
  if (!target) {
    if (GLOBAL_TARGET_BY_ID[id]) {
      throw new AppError('UNSUPPORTED', 'This target is a global target and cannot be used for project resolution.', {
        kind: 'unsupported',
        targetId: id,
        feature: 'scope',
        reason: 'Use scope "global" for global targets.',
      })
    }
    throw validationError(`Target "${id}" is not registered.`)
  }
  return {
    target: {
      id: target.id,
      label: target.label,
      format: target.format,
      merge: target.merge,
      supports: target.supports,
      ...(target.maxBytes !== undefined ? { maxBytes: target.maxBytes } : {}),
    },
    basePath: target.pathTemplate,
  }
}

function contractOutputPath(selection: TargetSelection, asset: AssetRecord): string {
  const slug = safePathSegment(asset.slug, asset.id)
  if (selection.globalTarget) {
    const def = selection.globalTarget
    return resolveGlobalProjectionPath(
      {
        path: selection.basePath,
        pathMode: def.pathMode,
        merge: def.merge,
        ...(def.fileExt ? { fileExt: def.fileExt } : {}),
      },
      slug,
    )
  }
  const template = selection.basePath
  if (selection.target.merge === 'single-file') return template
  return template.replace('{slug}', slug)
}

function loadContractModelsByIds(ctx: AppContext, ids: string[]): { models: ContractRecord[]; missing: string[] } {
  const models: ContractRecord[] = []
  const missing: string[] = []
  for (const id of ids) {
    try {
      const record = loadContractRecord(ctx, id)
      models.push(record)
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') {
        missing.push(id)
      } else {
        throw error
      }
    }
  }
  return { models, missing }
}

function sortForCompile(records: ContractRecord[]): ContractRecord[] {
  return [...records].sort((a, b) => {
    const priority = b.priority - a.priority
    if (priority !== 0) return priority
    const updated = a.asset.updatedAt.localeCompare(b.asset.updatedAt)
    if (updated !== 0) return updated
    return a.asset.id.localeCompare(b.asset.id)
  })
}

/**
 * Global dispatch selects instructions independently of project target and
 * repository scope fields, so a global preview treats every contract as eligible
 * for the selected global target.
 */
function resolveModelForScope(
  ctx: AppContext,
  record: ContractRecord,
  selection: TargetSelection,
  scope: 'project' | 'global',
): ContractFileModel {
  const model = contractModel(ctx, record)
  if (scope === 'global') {
    if (!model.targetIds.includes(selection.target.id)) {
      model.targetIds = [...model.targetIds, selection.target.id]
    }
    model.scope = 'user'
    model.pathPrefix = null
  }
  return model
}

export function createContractService(ctx: AppContext): ContractService {
  async function get(id: string): Promise<ContractDetail> {
    const record = loadContractRecord(ctx, id)
    return contractDetail(ctx, record)
  }

  return {
    async list(query: ContractQuery): Promise<AssetListResult<ContractListItem>> {
      const { limit, offset } = pageParams(query)
      const baseParts = contractFilterParts(query)
      const listParts = withFolderFilter(baseParts, query)
      const rows = filterBySyncState(
        ctx,
        selectContractRows(ctx, [...BASE_WHERE, ...listParts.where], listParts.params, query.sort, query.order),
        query.syncState,
      )
      const total = rows.length
      const pageRows = rows.slice(offset, offset + limit)
      const items = pageRows.map((row) => contractListItem(ctx, row))

      let folders: FolderNode[]
      if (query.syncState) {
        const treeRows = filterBySyncState(
          ctx,
          selectContractRows(ctx, [...BASE_WHERE, ...baseParts.where], baseParts.params),
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
      const record = loadContractRecord(ctx, id, true)
      return revisionSummaries(ctx, record.asset.id)
    },

    async create(input: ContractCreateInput): Promise<ContractDetail> {
      const title = asText(input.title).trim()
      const scope = normalizeScope(input.scope)
      if (!scope) throw validationError('Scope must be user, project, or path.', [{ path: 'scope', message: 'Choose a scope.' }])
      const folder = normalizeFolderInput(asText(input.folder))
      const activation = normalizeActivationInput(input.activation)
      const pathPrefix =
        scope === 'path' && typeof input.pathPrefix === 'string' ? normalizeFolder(input.pathPrefix) : null
      const imports = normalizeImports(input.imports)
      const targetIds = normalizeTargetIds(input.targetIds)
      const priority = normalizePriority(input.priority, DEFAULT_PRIORITY)
      const description = asText(input.description).trim()
      const tags = sanitizeTags(input.tags)
      const body = asText(input.body).trim()
      const syncPolicy = input.syncPolicy === undefined ? 'inherit' : assertSyncPolicy(input.syncPolicy)

      const fields: ContractFields = { title, scope, pathPrefix, activation, imports, targetIds, priority }
      validateContractFields(fields)
      assertTargetWarnings(fields, input.acknowledgeTargetWarnings)

      const assetId = newId('ast')
      const slug = ctx.assets.allocateSlug(KIND, folder, title)
      const content = serializeContractFile({
        id: assetId,
        title,
        description,
        folder,
        scope,
        pathPrefix,
        activation,
        priority,
        imports,
        targetIds,
        tags,
        syncPolicy,
        body,
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
        files: [{ path: `${slug}.contract.md`, content }],
      })
      saveContractRecord(ctx, asset.id, {
        body,
        scope,
        pathPrefix,
        activation,
        priority,
        imports,
        targetIds,
      })
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('contracts', 'created', [asset.id])
      return get(asset.id)
    },

    async update(input: ContractUpdateInput): Promise<ContractDetail> {
      const current = loadContractRecord(ctx, input.id)
      const title = input.title !== undefined ? asText(input.title).trim() : current.asset.title
      const description = input.description !== undefined ? asText(input.description).trim() : current.asset.description
      const folder = input.folder !== undefined ? normalizeFolderInput(asText(input.folder)) : current.asset.folder
      const tags = input.tags !== undefined ? sanitizeTags(input.tags) : ctx.assets.tags(current.asset.id)
      const body = input.body !== undefined ? asText(input.body).trim() : current.body
      const scope = input.scope !== undefined ? normalizeScope(input.scope) : current.scope
      if (!scope) throw validationError('Scope must be user, project, or path.', [{ path: 'scope', message: 'Choose a scope.' }])
      const pathPrefix =
        scope !== 'path'
          ? null
          : input.pathPrefix !== undefined
            ? typeof input.pathPrefix === 'string'
              ? normalizeFolder(input.pathPrefix)
              : null
            : current.pathPrefix
      const activation =
        input.activation !== undefined ? normalizeActivationInput(input.activation) : current.activation
      const priority = normalizePriority(input.priority, current.priority)
      const imports = input.imports !== undefined ? normalizeImports(input.imports) : current.imports
      const targetIds = input.targetIds !== undefined ? normalizeTargetIds(input.targetIds) : current.targetIds

      const fields: ContractFields = { title, scope, pathPrefix, activation, imports, targetIds, priority }
      validateContractFields(fields)
      assertTargetWarnings(fields, input.acknowledgeTargetWarnings)

      const latest = ctx.assets.currentRevision(current.asset.id)
      if (latest.id !== input.expectedRevisionId) {
        throw new AppError('REVISION_CONFLICT', 'This contract changed after the editor was opened.', {
          kind: 'revision-conflict',
          currentRevisionId: latest.id,
          currentVersion: latest.version,
          updatedAt: current.asset.updatedAt,
        })
      }

      const asset = ctx.assets.setMetadata(current.asset.id, { title, description, folder, tags })
      const content = serializeContractFile({
        id: asset.id,
        title,
        description,
        folder,
        scope,
        pathPrefix,
        activation,
        priority,
        imports,
        targetIds,
        tags,
        syncPolicy: asset.syncPolicy,
        body,
      })
      ctx.assets.addRevision(
        asset.id,
        [{ path: `${asset.slug}.contract.md`, content }],
        null,
        input.expectedRevisionId,
      )
      saveContractRecord(ctx, asset.id, {
        body,
        scope,
        pathPrefix,
        activation,
        priority,
        imports,
        targetIds,
      })
      markProjectionsStale(ctx, asset.id)
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('contracts', 'updated', [asset.id])
      return get(asset.id)
    },

    async delete(input: DeleteInput): Promise<DeleteResult> {
      if (input.confirm !== true) throw validationError('Deleting a contract requires explicit confirmation.')
      const record = loadContractRecord(ctx, input.id)
      const withdrawnChangeIds = withdrawPendingChanges(ctx, record.asset.id)
      const deletedAt = ctx.assets.softDelete(record.asset.id)
      ctx.db
        .prepare('UPDATE projections SET orphaned = 1 WHERE contract_id = ?')
        .run(record.asset.id)
      ctx.events.domainChanged('contracts', 'deleted', [record.asset.id])
      return { id: record.asset.id, deletedAt, withdrawnChangeIds }
    },

    async restore(input: { id: string }): Promise<ContractDetail> {
      const asset = ctx.assets.getAsset(input.id, true)
      if (asset.kind !== KIND) throw new AppError('NOT_FOUND', 'This contract no longer exists.')
      ctx.assets.restoreAsset(asset.id)
      ctx.db
        .prepare('UPDATE projections SET orphaned = 0 WHERE contract_id = ?')
        .run(asset.id)
      ctx.events.domainChanged('contracts', 'restored', [asset.id])
      return get(asset.id)
    },

    async restoreVersion(input: RestoreVersionInput): Promise<ContractDetail> {
      const current = loadContractRecord(ctx, input.id)
      const revision = ctx.assets.getRevision(input.revisionId)
      if (revision.assetId !== current.asset.id) {
        throw new AppError('NOT_FOUND', 'This version does not belong to the contract.')
      }
      const files = ctx.assets.revisionFiles(revision.id)
      const file =
        files.find((entry) => entry.mediaKind === 'text' && entry.path.endsWith('.contract.md')) ??
        files.find((entry) => entry.mediaKind === 'text')
      if (!file) throw new AppError('CORRUPT', 'This version has no readable contract file.')
      const parsed = parseContractFile(ctx.blobs.readSync(file.blobHash).toString('utf8'))
      if (!parsed.model) throw new AppError('CORRUPT', parsed.error ?? 'This version could not be parsed.')
      if (parsed.model.id && parsed.model.id !== current.asset.id) {
        throw new AppError('CORRUPT', 'This historical revision belongs to a different contract.')
      }

      const restored = parsed.model
      const fields: ContractFields = {
        title: restored.title,
        scope: restored.scope,
        pathPrefix: restored.pathPrefix,
        activation: restored.activation,
        imports: restored.imports,
        targetIds: restored.targetIds,
        priority: restored.priority,
      }
      validateContractFields(fields)

      const latest = ctx.assets.currentRevision(current.asset.id)
      if (latest.id !== input.expectedRevisionId) {
        throw new AppError('REVISION_CONFLICT', 'This contract changed after the editor was opened.', {
          kind: 'revision-conflict',
          currentRevisionId: latest.id,
          currentVersion: latest.version,
          updatedAt: current.asset.updatedAt,
        })
      }

      const asset = ctx.assets.setMetadata(current.asset.id, {
        title: restored.title,
        description: restored.description,
        folder: restored.folder,
        tags: restored.tags,
      })
      const content = serializeContractFile({
        id: asset.id,
        title: restored.title,
        description: restored.description,
        folder: restored.folder,
        scope: restored.scope,
        pathPrefix: restored.pathPrefix,
        activation: restored.activation,
        priority: restored.priority,
        imports: restored.imports,
        targetIds: restored.targetIds,
        tags: restored.tags,
        syncPolicy: asset.syncPolicy,
        body: restored.body,
      })
      ctx.assets.addRevision(
        asset.id,
        [{ path: `${asset.slug}.contract.md`, content }],
        input.note ?? `Restored from version ${revision.version}`,
        input.expectedRevisionId,
      )
      saveContractRecord(ctx, asset.id, {
        body: restored.body,
        scope: restored.scope,
        pathPrefix: restored.pathPrefix,
        activation: restored.activation,
        priority: restored.priority,
        imports: restored.imports,
        targetIds: restored.targetIds,
      })
      markProjectionsStale(ctx, asset.id)
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('contracts', 'restored', [asset.id])
      return get(asset.id)
    },

    async resolve(input: ContractResolveInput): Promise<ResolvedPreview> {
      const scope = assertResolveScope(input)
      const selection = selectTarget(ctx, input.targetId, scope)
      const project = scope === 'project' ? selectProject(ctx, input.projectId) : { warnings: [] }
      const contractIds = input.contractIds === undefined
        ? undefined
        : normalizeTargetIds(input.contractIds)
      const assetRows = ctx.db
        .prepare("SELECT id FROM assets WHERE kind = 'contract' AND deleted_at IS NULL")
        .all() as Array<{ id: string }>
      const records = assetRows.map((row) => loadContractRecord(ctx, row.id))
      const models = records.map((record) => ({
        model: resolveModelForScope(ctx, record, selection, scope),
        sourcePath: ctx.assets.repoPathFor(record.asset),
        updatedAt: record.asset.updatedAt,
      }))

      const preview = resolveContracts({
        contracts: models,
        target: selection.target,
        scope,
        ...(input.samplePath ? { samplePath: input.samplePath } : {}),
        ...(contractIds !== undefined ? { contractIds } : {}),
      })

      const revisionIdByContract = new Map<string, string>()
      for (const record of records) {
        const revision = ctx.assets.currentRevisionOrNull(record.asset.id)
        if (revision) revisionIdByContract.set(record.asset.id, revision.id)
      }
      const assetByContract = new Map(records.map((record) => [record.asset.id, record.asset]))
      const included = preview.included.map((entry) => ({
        ...entry,
        revisionId: revisionIdByContract.get(entry.contractId) ?? '',
      }))
      const compiledFilePaths =
        selection.target.merge === 'single-file'
          ? [selection.basePath]
          : included
              .map((entry) => assetByContract.get(entry.contractId))
              .filter((asset): asset is AssetRecord => !!asset)
              .map((asset) => contractOutputPath(selection, asset))

      return {
        ...preview,
        included,
        compiledFilePaths,
        warnings: [...project.warnings, ...preview.warnings],
        ...(project.projectId ? { projectId: project.projectId } : {}),
      }
    },

    async compile(input: ContractCompileInput): Promise<ContractCompileResult> {
      const scope = assertResolveScope(input)
      const selection = selectTarget(ctx, input.targetId, scope)
      const project = scope === 'project' ? selectProject(ctx, input.projectId) : { warnings: [] }
      const contractIds = normalizeTargetIds(input.contractIds)
      const { models, missing } = loadContractModelsByIds(ctx, contractIds)
      const ordered = sortForCompile(models)
      const warnings = [
        ...project.warnings,
        ...missing.map((id) => `Contract "${id}" was not found and was skipped.`),
      ]

      const compiled = compileFileSet({
        contracts: ordered.map((record) => ({
          model: contractModel(ctx, record),
          sourcePath: ctx.assets.repoPathFor(record.asset),
        })),
        target: selection.target,
      })
      warnings.push(...compiled.warnings)

      const files: CompiledFile[] = compiled.files.map((file, index) => {
        const record = selection.target.merge === 'single-file' ? ordered[0] : ordered[index]
        const path = record
          ? contractOutputPath(selection, record.asset)
          : selection.target.merge === 'single-file'
            ? selection.basePath
            : file.path
        return { ...file, path }
      })

      const previewToken = sha256Hex(
        JSON.stringify({
          targetId: selection.target.id,
          scope,
          contractIds,
          fileContents: files.map((file) => ({ path: file.path, content: file.content })),
        }),
      )

      return { files, warnings, previewToken }
    },

    async setSyncPolicy(input: SetSyncPolicyInput): Promise<AssetSyncPolicyResult> {
      const syncPolicy = assertSyncPolicy(input.syncPolicy)
      const record = loadContractRecord(ctx, input.id)
      const withdrawnChangeIds =
        syncPolicy === 'local' ? withdrawPendingChanges(ctx, record.asset.id) : []
      const asset = ctx.assets.setMetadata(record.asset.id, { syncPolicy })
      ctx.events.domainChanged('contracts', 'updated', [asset.id])
      return {
        id: asset.id,
        syncPolicy,
        effectiveSync: effectiveSync(ctx, KIND, syncPolicy),
        withdrawnChangeIds,
      }
    },

    async targets(): Promise<ContractTarget[]> {
      return [...PROJECT_TARGETS]
    },
  }
}
