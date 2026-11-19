import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog } from 'electron'
import type {
  AssetListResult,
  DeleteInput,
  DeleteResult,
  Page,
  RestoreVersionInput,
  RevisionSummary,
  ScanFinding,
  SkillCreateInput,
  SkillDetail,
  SkillFileEntry,
  SkillFilesInput,
  SkillFilesResult,
  SkillFileWrite,
  SkillImportApplied,
  SkillImportInput,
  SkillImportPreview,
  SkillImportResult,
  SkillListItem,
  SkillQuery,
  SkillSource,
  SkillStoreItem,
  SkillUpdateInput,
  StoreQuery,
  SyncRisk,
} from '../../shared/contracts'
import { AppError, validationError } from '../../shared/domain/errors'
import {
  buildFolderTree,
  folderInScope,
  isSafeFileName,
  isSafeRelativePath,
  normalizeFolder,
  validateFolder,
} from '../../shared/domain/folders'
import {
  canonicalManifestJson,
  isScriptFile,
  isTextFile,
  toSkillFiles,
  type ManifestFile,
} from '../../shared/domain/manifest'
import { scanText } from '../../shared/domain/credentialScanner'
import type { AppContext } from '../context'
import { sha256Hex } from '../adapters/hash'
import { listFilesRecursive } from '../adapters/fs'
import type { AssetRecord, NewAssetFile } from './assetStore'
import { assetBase, recordLocalChange, withdrawPendingChanges } from './assetSyncState'
import type { SkillService } from './types'

const FILE_CONTENT_LIMIT = 1024 * 1024
const TOTAL_CONTENT_LIMIT = 8 * 1024 * 1024
const VERSION_CONTENT_LIMIT = 256 * 1024

interface SkillRow {
  asset_id: string
  version_label: string
  author: string | null
  category: string | null
  icon: string | null
}

interface PreparedSkillFile {
  path: string
  content: Buffer
  mediaKind: 'text'
  isExecutable: boolean
}

interface ScannedSkillFile {
  path: string
  size: number
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
  content: Buffer
}

interface ScannedSkillSource {
  sourcePath: string
  name: string
  files: ScannedSkillFile[]
  risk: SyncRisk[]
  findings: ScanFinding[]
  warnings: string[]
}

interface ScannedImport {
  sources: ScannedSkillSource[]
  conflicts: Array<{ sourcePath: string; reason: string }>
  previewToken: string
}

/* ------------------------------------------------------------------ */
/* Store catalog                                                       */
/* ------------------------------------------------------------------ */

const SKILL_STORE: SkillStoreItem[] = [
  {
    id: 'ss-code-review',
    name: 'code-review',
    icon: '🔍',
    description: 'Reviews a diff for correctness, security, and missing tests.',
    author: 'Prompt Keeper',
    version: '1.2.0',
    category: 'Development',
    downloads: 4210,
    source: 'official',
    files: [
      { path: 'SKILL.md', size: 3200, mediaKind: 'text', isExecutable: false },
      { path: 'references/checklist.md', size: 1800, mediaKind: 'text', isExecutable: false },
    ],
  },
  {
    id: 'ss-release-notes',
    name: 'release-notes',
    icon: '📝',
    description: 'Turns merged changes into reader-friendly release notes.',
    author: 'Prompt Keeper',
    version: '1.0.3',
    category: 'Writing',
    downloads: 2870,
    source: 'official',
    files: [{ path: 'SKILL.md', size: 2400, mediaKind: 'text', isExecutable: false }],
  },
  {
    id: 'ss-sql-audit',
    name: 'sql-audit',
    icon: '🧮',
    description: 'Audits SQL queries for missing indexes and unsafe scans.',
    author: 'Community Lab',
    version: '0.9.1',
    category: 'Data',
    downloads: 1640,
    source: 'community',
    files: [
      { path: 'SKILL.md', size: 2800, mediaKind: 'text', isExecutable: false },
      { path: 'scripts/explain.sh', size: 460, mediaKind: 'text', isExecutable: true },
    ],
  },
  {
    id: 'ss-api-design',
    name: 'api-design',
    icon: '🧱',
    description: 'Checks API proposals for naming, versioning, and error handling.',
    author: 'Prompt Keeper',
    version: '1.1.0',
    category: 'Development',
    downloads: 3120,
    source: 'official',
    files: [{ path: 'SKILL.md', size: 3600, mediaKind: 'text', isExecutable: false }],
  },
  {
    id: 'ss-doc-outline',
    name: 'doc-outline',
    icon: '🗂️',
    description: 'Builds a documentation outline from a repository tree and README.',
    author: 'Community Lab',
    version: '0.8.4',
    category: 'Writing',
    downloads: 980,
    source: 'community',
    files: [{ path: 'SKILL.md', size: 2100, mediaKind: 'text', isExecutable: false }],
  },
  {
    id: 'ss-test-plan',
    name: 'test-plan',
    icon: '✅',
    description: 'Derives a test plan from a feature description and its acceptance criteria.',
    author: 'Prompt Keeper',
    version: '1.0.0',
    category: 'Development',
    downloads: 2055,
    source: 'official',
    files: [{ path: 'SKILL.md', size: 2900, mediaKind: 'text', isExecutable: false }],
  },
]

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function asSkillSource(value: string): SkillSource {
  if (value === 'official' || value === 'community' || value === 'import' || value === 'scan') return value
  return 'local'
}

function readSkillRow(ctx: AppContext, assetId: string): SkillRow {
  const row = ctx.db.prepare('SELECT * FROM skills WHERE asset_id = ?').get(assetId) as
    | SkillRow
    | undefined
  if (!row) throw new AppError('CORRUPT', 'The skill record is missing. Restore it from a backup.')
  return row
}

function requireSkillAsset(ctx: AppContext, assetId: string): AssetRecord {
  const asset = ctx.assets.getAsset(assetId)
  if (asset.kind !== 'skill') throw new AppError('NOT_FOUND', 'This skill no longer exists.')
  return asset
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (tags === undefined) return []
  if (!Array.isArray(tags)) throw validationError('Tags must be an array of strings.')
  return [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))]
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function assertUniqueTitle(ctx: AppContext, folder: string, title: string, excludeId?: string): void {
  const row = ctx.db
    .prepare(
      "SELECT id FROM assets WHERE kind = 'skill' AND folder = ? AND lower(title) = lower(?) AND deleted_at IS NULL AND id <> ?",
    )
    .get(folder, title, excludeId ?? '') as { id: string } | undefined
  if (row) {
    throw new AppError('CONFLICT', `A skill titled "${title}" already exists in this folder.`, {
      kind: 'duplicate',
      field: 'title',
      value: title,
    })
  }
}

function normalizeSkillFiles(files: SkillFileWrite[] | undefined): PreparedSkillFile[] {
  if (!Array.isArray(files)) {
    throw validationError('A skill needs a complete file set including SKILL.md at the root.')
  }
  if (!files.length) throw validationError('A skill needs at least SKILL.md.')
  const seen = new Set<string>()
  const prepared: PreparedSkillFile[] = []
  for (const file of files) {
    if (!file || typeof file !== 'object') throw validationError('Every file entry must have a path and content.')
    const path = typeof file.path === 'string' ? file.path.replace(/\\/g, '/') : ''
    if (!path) throw validationError('A file path is required.')
    if (path !== path.trim()) throw validationError(`The file path "${path}" has leading or trailing whitespace.`)
    if (!isSafeRelativePath(path)) {
      throw validationError(`The file path "${file.path}" is not a safe relative path.`)
    }
    for (const segment of path.split('/')) {
      if (!isSafeFileName(segment)) {
        throw validationError(`The file path "${file.path}" contains an invalid directory or file name.`)
      }
    }
    if (seen.has(path)) throw validationError(`The file "${path}" appears more than once.`)
    seen.add(path)
    if (typeof file.content !== 'string') throw validationError(`The file "${path}" needs text content.`)
    prepared.push({
      path,
      content: Buffer.from(file.content, 'utf8'),
      mediaKind: 'text',
      isExecutable: /\.(sh|bat|ps1)$/i.test(path),
    })
  }
  if (!seen.has('SKILL.md')) {
    throw validationError('A skill must contain SKILL.md at its root.')
  }
  return prepared
}

function manifestFor(files: PreparedSkillFile[]): ManifestFile[] {
  return files.map((file) => ({
    path: file.path,
    blobHash: sha256Hex(file.content),
    size: file.content.length,
    mediaKind: 'text',
    isExecutable: file.isExecutable,
  }))
}

function filesDiffer(ctx: AppContext, revisionId: string, files: PreparedSkillFile[]): boolean {
  return canonicalManifestJson(ctx.assets.revisionFiles(revisionId)) !== canonicalManifestJson(manifestFor(files))
}

function toNewAssetFiles(files: PreparedSkillFile[]): NewAssetFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    mediaKind: file.mediaKind,
    isExecutable: file.isExecutable,
  }))
}

async function revisionAsNewFiles(ctx: AppContext, revisionId: string): Promise<NewAssetFile[]> {
  const revision = ctx.assets.getRevision(revisionId)
  const files: NewAssetFile[] = []
  for (const file of revision.files) {
    files.push({
      path: file.path,
      content: await ctx.blobs.read(file.blobHash),
      mediaKind: file.mediaKind,
      isExecutable: file.isExecutable,
    })
  }
  return files
}

function installSummary(
  ctx: AppContext,
  assetId: string,
  currentRevisionId: string,
): SkillListItem['installSummary'] {
  const rows = ctx.db
    .prepare("SELECT status, deployed_revision_id FROM deployments WHERE asset_id = ? AND asset_kind = 'skill'")
    .all(assetId) as Array<{ status: 'synced' | 'stale' | 'drifted' | 'missing'; deployed_revision_id: string | null }>
  const summary: SkillListItem['installSummary'] = {
    synced: 0,
    stale: 0,
    drifted: 0,
    missing: 0,
    unsupported: 0,
  }
  for (const row of rows) {
    let status = row.status
    if (status === 'synced' && row.deployed_revision_id !== currentRevisionId) status = 'stale'
    summary[status] += 1
  }
  return summary
}

function fileCount(ctx: AppContext, revisionId: string): number {
  const row = ctx.db
    .prepare('SELECT COUNT(*) AS count FROM asset_files WHERE revision_id = ?')
    .get(revisionId) as { count: number }
  return row.count
}

function listItemFrom(ctx: AppContext, asset: AssetRecord, row: SkillRow): SkillListItem {
  const revision = ctx.assets.currentRevision(asset.id)
  return {
    ...assetBase(ctx, asset),
    kind: 'skill',
    versionLabel: row.version_label,
    icon: row.icon ?? '',
    source: asSkillSource(asset.source),
    category: row.category ?? '',
    fileCount: fileCount(ctx, revision.id),
    pendingChangeCount: ctx.assets.pendingChangeCount(asset.id),
    installSummary: installSummary(ctx, asset.id, revision.id),
  }
}

function detailFrom(ctx: AppContext, asset: AssetRecord): SkillDetail {
  const row = readSkillRow(ctx, asset.id)
  const revision = ctx.assets.currentRevision(asset.id)
  return {
    ...assetBase(ctx, asset),
    kind: 'skill',
    versionLabel: row.version_label,
    author: row.author ?? '',
    category: row.category ?? '',
    icon: row.icon ?? '',
    source: asSkillSource(asset.source),
    files: toSkillFiles(ctx.assets.revisionFiles(revision.id)),
    installSummary: installSummary(ctx, asset.id, revision.id),
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
    if (file.mediaKind !== 'text' || file.size > VERSION_CONTENT_LIMIT) {
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

function insertSkillRow(
  ctx: AppContext,
  assetId: string,
  values: { versionLabel: string; author: string; category: string; icon: string },
): void {
  ctx.db.prepare('INSERT INTO skills (asset_id, version_label, author, category, icon) VALUES (?, ?, ?, ?, ?)').run(
    assetId,
    values.versionLabel,
    values.author || null,
    values.category || null,
    values.icon || null,
  )
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

function matchingSkillIds(ctx: AppContext, query: SkillQuery): string[] {
  const baseWhere: string[] = ["a.kind = 'skill'", 'a.deleted_at IS NULL', 's.asset_id = a.id']
  const filterParams: unknown[] = []
  if (query.source) {
    baseWhere.push('a.source = ?')
    filterParams.push(query.source)
  }
  if (query.category) {
    baseWhere.push('s.category = ?')
    filterParams.push(query.category)
  }
  for (const tag of normalizeTags(query.tags)) {
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
            `SELECT a.id AS id FROM assets a, skills s WHERE ${baseWhere.join(' AND ')} AND a.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?)`,
          )
          .all(...filterParams, expression) as Array<{ id: string }>
      ).map((row) => row.id)
    } catch {
      // Fall through to a LIKE search when the FTS query is malformed.
    }
  }
  const where = [...baseWhere]
  const params = [...filterParams]
  if (search) {
    where.push('(a.title LIKE ? OR a.description LIKE ?)')
    const like = `%${search.replace(/[%_]/g, ' ')}%`
    params.push(like, like)
  }
  return (
    ctx.db
      .prepare(`SELECT a.id AS id FROM assets a, skills s WHERE ${where.join(' AND ')}`)
      .all(...params) as Array<{ id: string }>
  ).map((row) => row.id)
}

function sortSkillItems(
  items: SkillListItem[],
  sort: SkillQuery['sort'],
  order: SkillQuery['order'],
): SkillListItem[] {
  const direction = order === 'asc' ? 1 : -1
  const key = sort ?? 'updated'
  return [...items].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title) * direction
    if (key === 'created') return (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) * direction
    return (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0) * direction
  })
}

/* ------------------------------------------------------------------ */
/* Import scanning                                                     */
/* ------------------------------------------------------------------ */

function scanSourceFiles(files: ScannedSkillFile[]): { findings: ScanFinding[]; risk: SyncRisk[]; warnings: string[] } {
  const findings: ScanFinding[] = []
  const risk = new Set<SyncRisk>()
  const warnings: string[] = []
  let binaryCount = 0
  let executableCount = 0
  let largeCount = 0

  for (const file of files) {
    if (file.isExecutable) executableCount++
    if (file.size > FILE_CONTENT_LIMIT) largeCount++
    if (isScriptFile(file.path)) risk.add('scripts')
    if (file.mediaKind === 'binary') {
      binaryCount++
      continue
    }
    const text = file.content.toString('utf8')
    const fileFindings = scanText(text, { path: file.path, replacement: '${VAR}', includeMedium: true })
    findings.push(...fileFindings)
    if (fileFindings.some((finding) => finding.confidence === 'high')) risk.add('secrets')
    if (isScriptFile(file.path, text)) risk.add('scripts')
  }

  if (binaryCount) warnings.push(`${binaryCount} binary file(s) are stored but not shown as text.`)
  if (executableCount) warnings.push('Executable files are stored with their permission bit and are never executed.')
  if (largeCount) warnings.push(`${largeCount} file(s) are larger than 1 MiB; their content is omitted from review.`)
  if (risk.has('secrets')) warnings.push('The scanner found credential-like values. Review them before importing.')
  if (risk.has('scripts')) warnings.push('Script files are stored but never executed by the app.')
  return { findings, risk: [...risk], warnings }
}

async function scanImportSources(ctx: AppContext, input: SkillImportInput): Promise<ScannedImport> {
  let sourcePaths = Array.isArray(input.sourcePaths)
    ? [...new Set(input.sourcePaths.filter((path) => typeof path === 'string' && path.trim()))]
    : []
  if (!sourcePaths.length && input.pickFromDialog) {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] })
    if (!result.canceled) {
      sourcePaths = [...new Set(result.filePaths)]
    }
  }
  if (!sourcePaths.length && input.confirm === true && input.previewToken) {
    throw validationError('The source directories are required to apply this import. Review the preview again.')
  }
  const sources: ScannedSkillSource[] = []
  const conflicts: Array<{ sourcePath: string; reason: string }> = []
  for (const sourcePath of sourcePaths) {
    const name = basename(sourcePath.replace(/[\\/]+$/, '')).trim()
    if (!name) {
      conflicts.push({ sourcePath, reason: 'The source directory has no usable name.' })
      continue
    }
    let entries: Array<{ path: string; size: number; isExecutable: boolean }>
    try {
      entries = await listFilesRecursive(sourcePath, { rejectSymlinks: true })
    } catch (error) {
      conflicts.push({ sourcePath, reason: error instanceof Error ? error.message : 'The directory could not be read.' })
      continue
    }
    if (!entries.some((entry) => entry.path === 'SKILL.md')) {
      conflicts.push({ sourcePath, reason: 'SKILL.md is required at the source root.' })
      continue
    }
    const files: ScannedSkillFile[] = []
    let failed: string | null = null
    for (const entry of entries) {
      try {
        const content = await readFile(join(sourcePath, ...entry.path.split('/')))
        const binary = !isTextFile(entry.path) || content.includes(0)
        files.push({
          path: entry.path,
          size: content.length,
          mediaKind: binary ? 'binary' : 'text',
          isExecutable: entry.isExecutable || /\.(sh|bat|ps1)$/i.test(entry.path),
          content,
        })
      } catch (error) {
        failed = error instanceof Error ? error.message : 'A file could not be read.'
        break
      }
    }
    if (failed) {
      conflicts.push({ sourcePath, reason: failed })
      continue
    }
    const scanned = scanSourceFiles(files)
    const duplicate = ctx.db
      .prepare("SELECT id FROM assets WHERE kind = 'skill' AND folder = '' AND lower(title) = lower(?) AND deleted_at IS NULL")
      .get(name) as { id: string } | undefined
    if (duplicate) {
      scanned.warnings.push('A skill with this name already exists; the import will skip this source.')
    }
    sources.push({
      sourcePath,
      name,
      files,
      risk: scanned.risk,
      findings: scanned.findings,
      warnings: scanned.warnings,
    })
  }
  return { sources, conflicts, previewToken: importToken(sources) }
}

function importToken(sources: ScannedSkillSource[]): string {
  const payload = [...sources]
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
    .map((source) => ({
      sourcePath: source.sourcePath,
      files: source.files.map((file) => ({
        path: file.path,
        size: file.size,
        hash: sha256Hex(file.content),
      })),
    }))
  return sha256Hex(JSON.stringify(payload))
}

function previewSource(source: ScannedSkillSource): SkillImportPreview['sources'][number] {
  return {
    sourcePath: source.sourcePath,
    name: source.name,
    files: source.files.map<SkillFileEntry>((file) => ({
      path: file.path,
      size: file.size,
      mediaKind: file.mediaKind,
      isExecutable: file.isExecutable,
    })),
    risk: source.risk,
    findings: source.findings,
    warnings: source.warnings,
  }
}

function scannedFilesToNewFiles(files: ScannedSkillFile[]): NewAssetFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    mediaKind: file.mediaKind,
    isExecutable: file.isExecutable,
  }))
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export function createSkillService(ctx: AppContext): SkillService {
  return {
    async list(query: SkillQuery): Promise<AssetListResult<SkillListItem>> {
      const ids = matchingSkillIds(ctx, query)
      let items = ids.map((id) => {
        const asset = ctx.assets.getAsset(id)
        return listItemFrom(ctx, asset, readSkillRow(ctx, asset.id))
      })
      if (query.syncState) {
        items = items.filter((item) => item.syncState === query.syncState)
      }
      items = sortSkillItems(items, query.sort, query.order)
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

    async get(id: string): Promise<SkillDetail> {
      return detailFrom(ctx, requireSkillAsset(ctx, id))
    },

    async versions(id: string): Promise<RevisionSummary[]> {
      requireSkillAsset(ctx, id)
      return revisionSummaries(ctx, id)
    },

    async files(input: SkillFilesInput): Promise<SkillFilesResult> {
      const asset = requireSkillAsset(ctx, input.assetId)
      const full = input.revisionId ? ctx.assets.getRevision(input.revisionId) : null
      const revision = full ?? ctx.assets.currentRevision(asset.id)
      if (revision.assetId !== asset.id) {
        throw new AppError('NOT_FOUND', 'This version does not belong to this skill.')
      }
      const revisionFiles: ManifestFile[] = full ? full.files : ctx.assets.revisionFiles(revision.id)
      const entries = toSkillFiles(revisionFiles)
      const contents: Record<string, string> = {}
      const omitted: SkillFilesResult['omitted'] = []
      let total = 0
      for (const file of revisionFiles) {
        if (file.mediaKind !== 'text') {
          omitted.push({ path: file.path, reason: 'binary' })
          continue
        }
        if (file.size > FILE_CONTENT_LIMIT) {
          omitted.push({ path: file.path, reason: 'too-large' })
          continue
        }
        if (!input.includeContent) continue
        if (total + file.size > TOTAL_CONTENT_LIMIT) {
          omitted.push({ path: file.path, reason: 'too-large' })
          continue
        }
        const buffer = await ctx.blobs.read(file.blobHash)
        contents[file.path] = buffer.toString('utf8')
        total += buffer.length
      }
      return {
        assetId: asset.id,
        revisionId: revision.id,
        manifestHash: revision.manifestHash,
        files: entries,
        ...(input.includeContent ? { contents } : {}),
        omitted,
      }
    },

    async create(input: SkillCreateInput): Promise<SkillDetail> {
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      if (!title) throw validationError('A title is required.', [{ path: 'title', message: 'Required.' }])
      const folder = normalizeFolder(input.folder)
      const folderError = validateFolder(folder)
      if (folderError) throw validationError(folderError, [{ path: 'folder', message: folderError }])
      assertUniqueTitle(ctx, folder, title)
      const prepared = normalizeSkillFiles(input.files)
      const { asset } = ctx.assets.createAsset({
        kind: 'skill',
        title,
        slug: title,
        folder,
        description: textValue(input.description, ''),
        tags: normalizeTags(input.tags),
        source: 'local',
        files: toNewAssetFiles(prepared),
        note: 'Created',
      })
      try {
        insertSkillRow(ctx, asset.id, {
          versionLabel: textValue(input.versionLabel, '') || '1.0.0',
          author: textValue(input.author, ''),
          category: textValue(input.category, ''),
          icon: textValue(input.icon, ''),
        })
      } catch (error) {
        ctx.assets.softDelete(asset.id)
        throw error
      }
      recordLocalChange(ctx, asset.id)
      ctx.events.domainChanged('skills', 'created', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async update(input: SkillUpdateInput): Promise<SkillDetail> {
      const asset = requireSkillAsset(ctx, input.id)
      const current = ctx.assets.currentRevision(asset.id)
      if (current.id !== input.expectedRevisionId) {
        throw new AppError('REVISION_CONFLICT', 'This skill changed after the editor was opened.', {
          kind: 'revision-conflict',
          currentRevisionId: current.id,
          currentVersion: current.version,
          updatedAt: asset.updatedAt,
        })
      }
      const titleChanged =
        input.title !== undefined && typeof input.title === 'string' && input.title.trim() !== asset.title
      const nextTitle =
        input.title !== undefined ? (typeof input.title === 'string' ? input.title.trim() : '') : asset.title
      if (!nextTitle) throw validationError('A title is required.', [{ path: 'title', message: 'Required.' }])
      const nextFolder = input.folder !== undefined ? normalizeFolder(input.folder) : asset.folder
      const folderError = validateFolder(nextFolder)
      if (folderError) throw validationError(folderError, [{ path: 'folder', message: folderError }])
      if (input.title !== undefined || input.folder !== undefined) {
        assertUniqueTitle(ctx, nextFolder, nextTitle, asset.id)
      }
      const nextTags = input.tags !== undefined ? normalizeTags(input.tags) : ctx.assets.tags(asset.id)
      const nextDescription = input.description !== undefined ? textValue(input.description, asset.description) : asset.description
      const prepared = input.files !== undefined ? normalizeSkillFiles(input.files) : null
      const filesChanged = prepared ? filesDiffer(ctx, current.id, prepared) : false

      const revisionFiles =
        filesChanged || titleChanged
          ? prepared
            ? toNewAssetFiles(prepared)
            : await revisionAsNewFiles(ctx, current.id)
          : null

      const row = readSkillRow(ctx, asset.id)
      let revisionCreated = false
      const tx = ctx.db.transaction(() => {
        if (
          input.title !== undefined ||
          input.folder !== undefined ||
          input.description !== undefined ||
          input.tags !== undefined
        ) {
          ctx.assets.setMetadata(asset.id, {
            ...(input.title !== undefined ? { title: nextTitle } : {}),
            ...(input.folder !== undefined ? { folder: nextFolder } : {}),
            ...(input.description !== undefined ? { description: nextDescription } : {}),
            ...(input.tags !== undefined ? { tags: nextTags } : {}),
          })
        }
        ctx.db
          .prepare('UPDATE skills SET version_label = ?, author = ?, category = ?, icon = ? WHERE asset_id = ?')
          .run(
            input.versionLabel !== undefined
              ? textValue(input.versionLabel, row.version_label) || row.version_label
              : row.version_label,
            input.author !== undefined ? textValue(input.author, '') || null : row.author,
            input.category !== undefined ? textValue(input.category, '') || null : row.category,
            input.icon !== undefined ? textValue(input.icon, '') || null : row.icon,
            asset.id,
          )
        if (revisionFiles) {
          ctx.assets.addRevision(asset.id, revisionFiles, 'Updated', input.expectedRevisionId)
          revisionCreated = true
        }
      })
      tx()

      if (revisionCreated) {
        recordLocalChange(ctx, asset.id)
        markDeploymentsStale(ctx, asset.id)
        ctx.events.domainChanged('dispatch', 'reconciled', [asset.id])
      }
      ctx.events.domainChanged('skills', 'updated', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async delete(input: DeleteInput): Promise<DeleteResult> {
      if (input.confirm !== true) throw validationError('Deletion requires confirmation.')
      const asset = requireSkillAsset(ctx, input.id)
      const withdrawnChangeIds = withdrawPendingChanges(ctx, asset.id)
      const deletedAt = ctx.assets.softDelete(asset.id)
      ctx.events.domainChanged('skills', 'deleted', [asset.id])
      return { id: asset.id, deletedAt, withdrawnChangeIds }
    },

    async restore(input: { id: string }): Promise<SkillDetail> {
      const existing = ctx.assets.getAsset(input.id, true)
      if (existing.kind !== 'skill') throw new AppError('NOT_FOUND', 'This skill no longer exists.')
      const asset = ctx.assets.restoreAsset(existing.id)
      ctx.events.domainChanged('skills', 'restored', [asset.id])
      return detailFrom(ctx, asset)
    },

    async restoreVersion(input: RestoreVersionInput): Promise<SkillDetail> {
      const asset = requireSkillAsset(ctx, input.id)
      const current = ctx.assets.currentRevision(asset.id)
      if (current.id !== input.expectedRevisionId) {
        throw new AppError('REVISION_CONFLICT', 'This skill changed after the editor was opened.', {
          kind: 'revision-conflict',
          currentRevisionId: current.id,
          currentVersion: current.version,
          updatedAt: asset.updatedAt,
        })
      }
      const revision = ctx.assets.getRevision(input.revisionId)
      if (revision.assetId !== asset.id) {
        throw new AppError('NOT_FOUND', 'This version does not belong to this skill.')
      }
      await ctx.assets.restoreRevision(
        asset.id,
        input.revisionId,
        input.expectedRevisionId,
        input.note ?? `Restored from version ${revision.version}`,
      )
      recordLocalChange(ctx, asset.id)
      markDeploymentsStale(ctx, asset.id)
      ctx.events.domainChanged('dispatch', 'reconciled', [asset.id])
      ctx.events.domainChanged('skills', 'restored', [asset.id])
      return detailFrom(ctx, ctx.assets.getAsset(asset.id))
    },

    async import(input: SkillImportInput): Promise<SkillImportResult> {
      const scanned = await scanImportSources(ctx, input)
      if (input.confirm !== true || !input.previewToken) {
        return {
          phase: 'preview',
          sources: scanned.sources.map(previewSource),
          conflicts: scanned.conflicts,
          previewToken: scanned.previewToken,
        }
      }
      if (input.previewToken !== scanned.previewToken) {
        throw validationError('The import preview is stale; review the sources again.')
      }
      const hasScripts = scanned.sources.some((source) => source.risk.includes('scripts'))
      if (hasScripts && input.acknowledgeScripts !== true) {
        throw validationError('The import contains script files. Acknowledge scripts before importing.')
      }

      const imported: SkillDetail[] = []
      const skipped: SkillImportApplied['skipped'] = []
      for (const conflict of scanned.conflicts) {
        skipped.push({ sourcePath: conflict.sourcePath, reason: conflict.reason })
      }
      for (const source of scanned.sources) {
        const duplicate = ctx.db
          .prepare("SELECT id FROM assets WHERE kind = 'skill' AND folder = '' AND lower(title) = lower(?) AND deleted_at IS NULL")
          .get(source.name) as { id: string } | undefined
        if (duplicate) {
          skipped.push({ sourcePath: source.sourcePath, reason: 'A skill with this name already exists in the library.' })
          continue
        }
        try {
          const { asset } = ctx.assets.createAsset({
            kind: 'skill',
            title: source.name,
            slug: source.name,
            folder: '',
            description: '',
            tags: [],
            source: 'import',
            files: scannedFilesToNewFiles(source.files),
            note: `Imported from ${source.sourcePath}`,
          })
          try {
            insertSkillRow(ctx, asset.id, {
              versionLabel: '1.0.0',
              author: '',
              category: '',
              icon: '',
            })
          } catch (error) {
            ctx.assets.softDelete(asset.id)
            throw error
          }
          recordLocalChange(ctx, asset.id)
          imported.push(detailFrom(ctx, ctx.assets.getAsset(asset.id)))
        } catch (error) {
          skipped.push({
            sourcePath: source.sourcePath,
            reason: error instanceof Error ? error.message : 'The skill could not be imported.',
          })
        }
      }
      if (imported.length) {
        ctx.events.domainChanged('skills', 'created', imported.map((skill) => skill.id))
      }
      return { phase: 'applied', imported, skipped }
    },

    async storeList(query: StoreQuery): Promise<Page<SkillStoreItem>> {
      const search = (query.search ?? '').trim().toLowerCase()
      const category = (query.category ?? '').trim().toLowerCase()
      const filtered = SKILL_STORE.filter((item) => {
        if (category && item.category.toLowerCase() !== category) return false
        if (!search) return true
        const haystack = [item.name, item.description, item.author, item.category]
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
