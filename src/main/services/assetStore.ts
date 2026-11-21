import { readFile } from 'node:fs/promises'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetKind, SyncPolicy } from '../../shared/contracts'
import { AppError } from '../../shared/domain/errors'
import {
  buildFolderTree,
  normalizeFolder,
  repoFilePath,
  slugify,
  validateFolder,
} from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import {
  canonicalManifestJson,
  type ManifestFile,
} from '../../shared/domain/manifest'
import type { AppPaths } from '../paths'
import { sha256Hex } from '../adapters/hash'
import { ensureDir, pathExists, readBufferIfExists, removeIfExists, writeAtomicSync } from '../adapters/fs'
import type { BlobStore } from '../adapters/blobStore'
import type { Db } from '../db/database'

export interface AssetRecord {
  id: string
  kind: AssetKind
  title: string
  slug: string
  folder: string
  description: string
  syncPolicy: SyncPolicy
  source: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface RevisionRecord {
  id: string
  assetId: string
  version: number
  note: string | null
  manifestHash: string
  createdAt: string
}

export interface RevisionWithFiles extends RevisionRecord {
  files: ManifestFile[]
}

export interface NewAssetFile {
  path: string
  content: Buffer | string
  mediaKind?: 'text' | 'binary'
  isExecutable?: boolean
}

export interface CreateAssetInput {
  /** Pre-generated stable ID, so canonical files can carry it in frontmatter. */
  id?: string
  kind: AssetKind
  title: string
  slug?: string
  folder?: string
  description?: string
  tags?: string[]
  syncPolicy?: SyncPolicy
  source?: string
  files: NewAssetFile[]
  note?: string | null
}

const KIND_ROOT: Record<AssetKind, string> = {
  prompt: 'prompts',
  contract: 'instructions',
  skill: 'skills',
  mcp: 'mcp',
}

function rowToAsset(row: Record<string, unknown>): AssetRecord {
  return {
    id: row.id as string,
    kind: row.kind as AssetKind,
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

function rowToRevision(row: Record<string, unknown>): RevisionRecord {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    version: row.version as number,
    note: (row.note as string | null) ?? null,
    manifestHash: row.manifest_hash as string,
    createdAt: row.created_at as string,
  }
}

export class AssetStore {
  constructor(
    private readonly db: Db,
    private readonly blobs: BlobStore,
    private readonly paths: AppPaths,
  ) {}

  getAsset(assetId: string, includeDeleted = false): AssetRecord {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as
      | Record<string, unknown>
      | undefined
    if (!row || (!includeDeleted && row.deleted_at)) {
      throw new AppError('NOT_FOUND', 'This asset no longer exists.')
    }
    return rowToAsset(row)
  }

  findAsset(kind: AssetKind, folder: string, slug: string): AssetRecord | null {
    const row = this.db
      .prepare('SELECT * FROM assets WHERE kind = ? AND folder = ? AND slug = ?')
      .get(kind, folder, slug) as Record<string, unknown> | undefined
    return row ? rowToAsset(row) : null
  }

  allocateSlug(kind: AssetKind, folder: string, desired: string, excludeId?: string): string {
    const base = slugify(desired, 'asset')
    let candidate = base
    let suffix = 2
    while (true) {
      const row = this.db
        .prepare('SELECT id FROM assets WHERE kind = ? AND folder = ? AND slug = ?')
        .get(kind, folder, candidate) as { id: string } | undefined
      if (!row || row.id === excludeId) return candidate
      candidate = `${base}-${suffix++}`
    }
  }

  createAsset(input: CreateAssetInput): { asset: AssetRecord; revision: RevisionRecord } {
    const folder = normalizeFolder(input.folder)
    const folderError = validateFolder(folder)
    if (folderError) throw new AppError('VALIDATION', folderError)
    const assetId = input.id ?? newId('ast')
    const slug = this.allocateSlug(input.kind, folder, input.slug ?? input.title)
    const at = nowIso()

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO assets (id, kind, title, slug, folder, description, sync_policy, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          assetId,
          input.kind,
          input.title.trim(),
          slug,
          folder,
          input.description ?? '',
          input.syncPolicy ?? 'inherit',
          input.source ?? 'local',
          at,
          at,
        )
      this.replaceTags(assetId, input.tags ?? [])
    })
    tx()

    const revision = this.addRevision(assetId, input.files, input.note ?? null)
    return { asset: this.getAsset(assetId), revision }
  }

  addRevision(
    assetId: string,
    files: NewAssetFile[],
    note: string | null = null,
    expectedRevisionId?: string,
  ): RevisionRecord {
    const asset = this.getAsset(assetId)
    const current = this.currentRevisionOrNull(assetId)
    if (expectedRevisionId && current?.id !== expectedRevisionId) {
      throw new AppError('REVISION_CONFLICT', 'This asset changed after the editor was opened.', {
        kind: 'revision-conflict',
        currentRevisionId: current?.id ?? '',
        currentVersion: current?.version ?? 0,
        updatedAt: asset.updatedAt,
      })
    }
    if (!files.length) throw new AppError('VALIDATION', 'An asset revision needs at least one file.')

    const normalizedFiles = files.map((file) => ({
      path: file.path.replace(/\\/g, '/').replace(/^\/+/, ''),
      content: typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content,
      mediaKind: file.mediaKind ?? 'text',
      isExecutable: !!file.isExecutable,
    }))
    if (normalizedFiles.some((file) => !file.path || file.path.includes('..'))) {
      throw new AppError('VALIDATION', 'A revision file path is invalid.')
    }

    const manifestFiles: ManifestFile[] = normalizedFiles.map((file) => ({
      path: file.path,
      blobHash: sha256Hex(file.content),
      size: file.content.length,
      mediaKind: file.mediaKind,
      isExecutable: file.isExecutable,
    }))

    for (const file of normalizedFiles) {
      this.blobs.writeSync(file.content)
    }

    return this.insertRevision(assetId, manifestFiles, note)
  }

  /**
   * Inserts a revision from a manifest whose blobs are already staged. Sync
   * uses this to import large repositories without holding file content in
   * memory; every blob is verified to exist before the transaction starts.
   */
  addRevisionFromManifest(
    assetId: string,
    manifest: ManifestFile[],
    note: string | null = null,
  ): RevisionRecord {
    this.getAsset(assetId)
    if (!manifest.length) throw new AppError('VALIDATION', 'An asset revision needs at least one file.')
    const manifestFiles: ManifestFile[] = manifest.map((file) => {
      const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
      if (!path || path.includes('..')) {
        throw new AppError('VALIDATION', 'A revision file path is invalid.')
      }
      if (!/^[a-f0-9]{64}$/.test(file.blobHash)) {
        throw new AppError('CORRUPT', `The manifest entry ${path} has an invalid blob hash.`)
      }
      if (!Number.isInteger(file.size) || file.size < 0) {
        throw new AppError('CORRUPT', `The manifest entry ${path} has an invalid size.`)
      }
      if (!this.blobs.existsSync(file.blobHash)) {
        throw new AppError('CORRUPT', `The staged content for ${path} is missing.`)
      }
      return {
        path,
        blobHash: file.blobHash,
        size: file.size,
        mediaKind: file.mediaKind,
        isExecutable: !!file.isExecutable,
      }
    })

    return this.insertRevision(assetId, manifestFiles, note)
  }

  private insertRevision(
    assetId: string,
    manifestFiles: ManifestFile[],
    note: string | null,
  ): RevisionRecord {
    const current = this.currentRevisionOrNull(assetId)
    const manifestHash = sha256Hex(canonicalManifestJson(manifestFiles))
    const revisionId = newId('rev')
    const version = (current?.version ?? 0) + 1
    const at = nowIso()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO asset_revisions (id, asset_id, version, note, manifest_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(revisionId, assetId, version, note, manifestHash, at)
      const insertFile = this.db.prepare(
        'INSERT INTO asset_files (revision_id, path, blob_hash, size, media_kind, is_executable) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const file of manifestFiles) {
        insertFile.run(
          revisionId,
          file.path,
          file.blobHash,
          file.size,
          file.mediaKind,
          file.isExecutable ? 1 : 0,
        )
      }
      this.db.prepare('UPDATE assets SET updated_at = ? WHERE id = ?').run(at, assetId)
    })
    tx()

    this.materialize(assetId, revisionId)
    this.reindex(assetId)
    return {
      id: revisionId,
      assetId,
      version,
      note: note ?? null,
      manifestHash,
      createdAt: at,
    }
  }

  currentRevision(assetId: string): RevisionRecord {
    const revision = this.currentRevisionOrNull(assetId)
    if (!revision) throw new AppError('CORRUPT', 'This asset has no revision.')
    return revision
  }

  currentRevisionOrNull(assetId: string): RevisionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM asset_revisions WHERE asset_id = ? ORDER BY version DESC LIMIT 1')
      .get(assetId) as Record<string, unknown> | undefined
    return row ? rowToRevision(row) : null
  }

  getRevision(revisionId: string): RevisionWithFiles {
    const row = this.db.prepare('SELECT * FROM asset_revisions WHERE id = ?').get(revisionId) as
      | Record<string, unknown>
      | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This version no longer exists.')
    return { ...rowToRevision(row), files: this.revisionFiles(revisionId) }
  }

  revisionFiles(revisionId: string): ManifestFile[] {
    return (
      this.db
        .prepare(
          'SELECT path, blob_hash AS blobHash, size, media_kind AS mediaKind, is_executable AS isExecutable FROM asset_files WHERE revision_id = ? ORDER BY path',
        )
        .all(revisionId) as Array<{
        path: string
        blobHash: string
        size: number
        mediaKind: 'text' | 'binary'
        isExecutable: number
      }>
    ).map((row) => ({
      path: row.path,
      blobHash: row.blobHash,
      size: row.size,
      mediaKind: row.mediaKind,
      isExecutable: !!row.isExecutable,
    }))
  }

  versions(assetId: string): RevisionRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM asset_revisions WHERE asset_id = ? ORDER BY version DESC')
        .all(assetId) as Record<string, unknown>[]
    ).map(rowToRevision)
  }

  async restoreRevision(
    assetId: string,
    revisionId: string,
    expectedRevisionId: string,
    note?: string,
  ): Promise<RevisionRecord> {
    const revision = this.getRevision(revisionId)
    const files: NewAssetFile[] = []
    for (const file of revision.files) {
      files.push({
        path: file.path,
        content: await this.blobs.read(file.blobHash),
        mediaKind: file.mediaKind,
        isExecutable: file.isExecutable,
      })
    }
    return this.addRevision(
      assetId,
      files,
      note ?? `Restored from version ${revision.version}`,
      expectedRevisionId,
    )
  }

  setMetadata(
    assetId: string,
    patch: Partial<Pick<AssetRecord, 'title' | 'slug' | 'folder' | 'description' | 'syncPolicy' | 'source'>> & {
      tags?: string[]
    },
  ): AssetRecord {
    const asset = this.getAsset(assetId)
    const folder = patch.folder !== undefined ? normalizeFolder(patch.folder) : asset.folder
    const folderError = validateFolder(folder)
    if (folderError) throw new AppError('VALIDATION', folderError)
    const desiredSlug =
      patch.slug ??
      (patch.title !== undefined && patch.folder !== undefined
        ? slugify(patch.title, assetId)
        : patch.title !== undefined
          ? slugify(patch.title, assetId)
          : asset.slug)
    const slug =
      patch.title !== undefined || patch.slug !== undefined
        ? this.allocateSlug(asset.kind, folder, desiredSlug, assetId)
        : asset.slug

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE assets SET title = ?, slug = ?, folder = ?, description = ?, sync_policy = ?, source = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          patch.title?.trim() || asset.title,
          slug,
          folder,
          patch.description ?? asset.description,
          patch.syncPolicy ?? asset.syncPolicy,
          patch.source ?? asset.source,
          nowIso(),
          assetId,
        )
      if (patch.tags) this.replaceTags(assetId, patch.tags)
    })
    tx()
    const updated = this.getAsset(assetId)
    this.materialize(assetId)
    this.reindex(assetId)
    return updated
  }

  replaceTags(assetId: string, tags: string[]): void {
    const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
    this.db.prepare('DELETE FROM tags WHERE asset_id = ?').run(assetId)
    const insert = this.db.prepare('INSERT OR IGNORE INTO tags (asset_id, tag) VALUES (?, ?)')
    for (const tag of unique) insert.run(assetId, tag)
  }

  tags(assetId: string): string[] {
    return this.db
      .prepare('SELECT tag FROM tags WHERE asset_id = ? ORDER BY tag')
      .all(assetId)
      .map((row) => (row as { tag: string }).tag)
  }

  softDelete(assetId: string): string {
    const at = nowIso()
    this.db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?').run(at, at, assetId)
    this.removeFromIndex(assetId)
    this.db
      .prepare("UPDATE sync_changes SET status = 'resolved', updated_at = ? WHERE asset_id = ? AND status IN ('open', 'reviewed')")
      .run(at, assetId)
    return at
  }

  restoreAsset(assetId: string): AssetRecord {
    const asset = this.getAsset(assetId, true)
    if (!asset.deletedAt) return asset
    this.db.prepare('UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), assetId)
    this.reindex(assetId)
    return this.getAsset(assetId)
  }

  countByKind(includeDeleted = false): Record<AssetKind, number> {
    const counts: Record<AssetKind, number> = { prompt: 0, contract: 0, skill: 0, mcp: 0 }
    const rows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS count FROM assets ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} GROUP BY kind`,
      )
      .all() as Array<{ kind: AssetKind; count: number }>
    for (const row of rows) counts[row.kind] = row.count
    return counts
  }

  /** Logical repository path for a revision file, using default roots. */
  repoPathFor(asset: AssetRecord, filePath?: string): string {
    const root = KIND_ROOT[asset.kind]
    if (asset.kind === 'skill') {
      const base = repoFilePath(root, asset.folder, asset.slug)
      return filePath ? `${base}/${filePath}` : base
    }
    return repoFilePath(root, asset.folder, filePath ?? this.defaultFileName(asset))
  }

  repoPathForLayout(asset: AssetRecord, layoutRoot: string, filePath?: string): string {
    if (asset.kind === 'skill') {
      const base = repoFilePath(layoutRoot, asset.folder, asset.slug)
      return filePath ? `${base}/${filePath}` : base
    }
    return repoFilePath(layoutRoot, asset.folder, filePath ?? this.defaultFileName(asset))
  }

  defaultFileName(asset: AssetRecord): string {
    switch (asset.kind) {
      case 'prompt':
        return `${asset.slug}.prompt.md`
      case 'contract':
        return `${asset.slug}.contract.md`
      case 'mcp':
        return `${asset.slug}.json`
      default:
        return 'SKILL.md'
    }
  }

  libraryDir(assetId: string): string {
    const asset = this.getAsset(assetId)
    return join(this.paths.library, asset.kind, assetId)
  }

  materialize(assetId: string, revisionId?: string): void {
    const asset = this.getAsset(assetId)
    const revision = revisionId ? this.getRevision(revisionId) : this.currentRevision(assetId)
    const dir = join(this.paths.library, asset.kind, assetId)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    for (const file of this.revisionFiles(revision.id)) {
      const content = this.blobs.readSync(file.blobHash)
      writeAtomicSync(join(dir, file.path), content, { mode: file.isExecutable ? 0o755 : 0o644 })
    }
  }

  assetFileForRevision(revisionId: string, fileName?: string): ManifestFile | undefined {
    const files = this.revisionFiles(revisionId)
    if (!fileName) return files[0]
    return files.find((file) => file.path === fileName)
  }

  /** FTS row is rebuilt from the current revision text content. */
  reindex(assetId: string, bodyOverride?: string): void {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as
      | Record<string, unknown>
      | undefined
    if (!asset || asset.deleted_at) {
      this.removeFromIndex(assetId)
      return
    }
    const record = rowToAsset(asset)
    const tags = this.tags(assetId).join(' ')
    let body = bodyOverride ?? ''
    if (!body) {
      try {
        const revision = this.currentRevision(assetId)
        const files = this.revisionFiles(revision.id)
        const parts: string[] = []
        let budget = 1_000_000
        for (const file of files) {
          if (file.mediaKind !== 'text') continue
          let content: string
          try {
            content = this.blobs.readSync(file.blobHash).toString('utf8')
          } catch {
            continue
          }
          const text = content.slice(0, Math.max(0, budget))
          parts.push(text)
          budget -= text.length
          if (budget <= 0) break
        }
        body = parts.join('\n')
      } catch {
        body = ''
      }
    }
    const path = this.repoPathFor(record)
    this.db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').run(assetId)
    this.db
      .prepare(
        'INSERT INTO assets_fts (asset_id, kind, title, description, body, tags, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(assetId, record.kind, record.title, record.description, body, tags, path)
  }

  removeFromIndex(assetId: string): void {
    this.db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').run(assetId)
  }

  rebuildIndex(): number {
    this.db.prepare('DELETE FROM assets_fts').run()
    const rows = this.db.prepare('SELECT id FROM assets WHERE deleted_at IS NULL').all() as Array<{
      id: string
    }>
    for (const row of rows) this.reindex(row.id)
    return rows.length
  }

  folderTree(kind: AssetKind, where: string, params: unknown[]): ReturnType<typeof buildFolderTree> {
    const rows = this.db
      .prepare(`SELECT folder, COUNT(*) AS count FROM assets WHERE kind = ? AND deleted_at IS NULL ${where} GROUP BY folder`)
      .all(kind, ...params) as Array<{ folder: string; count: number }>
    return buildFolderTree(
      rows.filter((row) => row.folder).map((row) => ({ path: row.folder, direct: row.count, total: row.count })),
    )
  }

  async readFileContent(revisionId: string, fileName?: string): Promise<string | null> {
    const file = this.assetFileForRevision(revisionId, fileName)
    if (!file || file.mediaKind !== 'text') return null
    return (await this.blobs.read(file.blobHash)).toString('utf8')
  }

  async readManifestContents(revisionId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const file of this.revisionFiles(revisionId)) {
      if (file.mediaKind !== 'text') continue
      out[file.path] = (await this.blobs.read(file.blobHash)).toString('utf8')
    }
    return out
  }

  bumpUsage(assetId: string): number {
    this.db.prepare('UPDATE prompts SET usage_count = usage_count + 1 WHERE asset_id = ?').run(assetId)
    const row = this.db.prepare('SELECT usage_count AS count FROM prompts WHERE asset_id = ?').get(assetId) as
      | { count: number }
      | undefined
    return row?.count ?? 0
  }

  pendingChangeCount(assetId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE asset_id = ? AND status IN ('open','reviewed')")
      .get(assetId) as { count: number }
    return row.count
  }

  hasBase(assetId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM repo_assets WHERE asset_id = ? LIMIT 1').get(assetId)
    return !!row
  }

  folderPaths(kind: AssetKind): string[] {
    return (
      this.db
        .prepare('SELECT DISTINCT folder FROM assets WHERE kind = ? AND deleted_at IS NULL AND folder <> \'\'')
        .all(kind) as Array<{ folder: string }>
    ).map((row) => row.folder)
  }

  async libraryFileExists(assetId: string, filePath: string): Promise<boolean> {
    return pathExists(join(this.libraryDirIfPresent(assetId), filePath))
  }

  private libraryDirIfPresent(assetId: string): string {
    const row = this.db.prepare('SELECT kind FROM assets WHERE id = ?').get(assetId) as
      | { kind: AssetKind }
      | undefined
    return join(this.paths.library, row?.kind ?? 'prompt', assetId)
  }

  async libraryFileText(assetId: string, filePath: string): Promise<string | null> {
    const buffer = await readBufferIfExists(join(this.libraryDirIfPresent(assetId), filePath))
    return buffer ? buffer.toString('utf8') : null
  }

  async fileHash(path: string): Promise<string | null> {
    const buffer = await readFile(path).catch(() => null)
    return buffer ? sha256Hex(buffer) : null
  }
}
