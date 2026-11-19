import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { arch, platform as osPlatform, release as osRelease } from 'node:os'
import { join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import type {
  AssetKind,
  DataLocationId,
  DiagnosticExportResult,
  OperationRef,
  ResetInput,
  ResetPreview,
  ResetResult,
  RestoreInput,
  RestorePreview,
  RestoreResult,
  SettingsBackupInput,
  SettingsSnapshot,
  SettingsUpdateInput,
} from '../../shared/contracts'
import { AppError, validationError } from '../../shared/domain/errors'
import { newId, nowIso } from '../../shared/domain/ids'
import { currentSchemaVersion, migrate, type Db } from '../db/database'
import {
  copyFileEnsured,
  directorySize,
  ensureDir,
  pathExists,
  removeIfExists,
  writeText,
} from '../adapters/fs'
import { sha256File, sha256Hex } from '../adapters/hash'
import { redact } from '../logging/logger'
import { expandUserPath, isAbsoluteUserPath } from '../paths'
import { setting, setSetting, type AppContext } from '../context'
import {
  applyNativeTheme,
  collectDataLocations,
  effectiveThemeFor,
  ensureLocalDirectories,
  isDensity,
  isThemeMode,
  readDensityPreference,
  readThemePreference,
} from './app'
import { listAiProviders } from './ai'
import { repoPolicies, repoRow } from './assetHelpers'
import { readUpdatePreferences } from './updates'
import type { OperationContext } from '../operations'
import type { SettingsService } from './types'

const PREVIEW_TOKEN_TTL_MS = 10 * 60_000
const RESET_CONFIRMATION_LIBRARY = 'RESET LOCAL LIBRARY'
const RESET_CONFIRMATION_ALL = 'RESET ALL DATA'
const DATABASE_SNAPSHOT_NAME = 'prompt-keeper.sqlite'
const MANIFEST_NAME = 'manifest.json'

interface BlobFile {
  path: string
  name: string
  size: number
}

interface BackupManifestFile {
  appVersion: string
  schemaVersion: number
  createdAt: string
  counts: Record<AssetKind, number>
  blobCount: number
  totalBytes: number
  databaseHash: string
  blobManifestHash: string
  includesLogs: boolean
}

interface BackupInspection {
  path: string
  dbPath: string
  manifest: BackupManifestFile
  warnings: string[]
  blobFiles: BlobFile[]
}

interface SnapshotResult {
  path: string
  bytes: number
  manifest: BackupManifestFile
}

interface PendingPreview {
  kind: 'restore' | 'reset'
  backupPath?: string
  scope?: 'library' | 'all'
  expiresAt: number
}

const RESTORE_TABLES = [
  'schema_migrations',
  'settings',
  'assets',
  'asset_revisions',
  'asset_files',
  'prompts',
  'contracts',
  'skills',
  'mcp_servers',
  'secrets',
  'tags',
  'projects',
  'repos',
  'repo_assets',
  'sync_changes',
  'operations',
  'agents',
  'deployments',
  'projections',
  'global_targets',
  'audit_events',
  'idempotency',
  'ai_providers',
  'ai_runs',
]

const RESET_LIBRARY_TABLES = [
  'sync_changes',
  'repo_assets',
  'deployments',
  'projections',
  'asset_files',
  'asset_revisions',
  'tags',
  'prompts',
  'contracts',
  'skills',
  'mcp_servers',
  'assets',
]

const RESET_ALL_EXTRA_TABLES = ['repos', 'global_targets', 'settings', 'ai_runs', 'ai_providers']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function normalizeCounts(raw: unknown): Record<AssetKind, number> {
  const record = isRecord(raw) ? raw : {}
  return {
    prompt: numberOr(record.prompt, 0),
    contract: numberOr(record.contract, 0),
    skill: numberOr(record.skill, 0),
    mcp: numberOr(record.mcp, 0),
  }
}

function resolveBackupPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw validationError('A backup path is required.', [
      { path: 'backupPath', message: 'Choose a backup folder.' },
    ])
  }
  if (!isAbsoluteUserPath(trimmed)) {
    throw validationError('The backup path must be absolute.', [
      { path: 'backupPath', message: 'Use an absolute folder path.' },
    ])
  }
  return resolve(expandUserPath(trimmed))
}

function normalizeManifest(raw: unknown): BackupManifestFile {
  if (!isRecord(raw)) {
    throw new AppError('CORRUPT', 'The backup manifest is not a JSON object.')
  }
  const appVersion = typeof raw.appVersion === 'string' ? raw.appVersion : ''
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : ''
  const schemaVersion = numberOr(raw.schemaVersion, -1)
  if (!createdAt || schemaVersion < 0) {
    throw new AppError('CORRUPT', 'The backup manifest is missing required fields.')
  }
  if (raw.databaseHash !== undefined && typeof raw.databaseHash !== 'string') {
    throw new AppError('CORRUPT', 'The backup manifest has an invalid database checksum.')
  }
  if (raw.blobManifestHash !== undefined && typeof raw.blobManifestHash !== 'string') {
    throw new AppError('CORRUPT', 'The backup manifest has an invalid content-list checksum.')
  }
  const databaseHash = typeof raw.databaseHash === 'string' ? raw.databaseHash : ''
  if (databaseHash && !isSha256(databaseHash)) {
    throw new AppError('CORRUPT', 'The backup manifest has an invalid database checksum.')
  }
  const blobManifestHash = typeof raw.blobManifestHash === 'string' ? raw.blobManifestHash : ''
  if (blobManifestHash && !isSha256(blobManifestHash)) {
    throw new AppError('CORRUPT', 'The backup manifest has an invalid content-list checksum.')
  }
  return {
    appVersion,
    schemaVersion,
    createdAt,
    counts: normalizeCounts(raw.counts),
    blobCount: numberOr(raw.blobCount, 0),
    totalBytes: numberOr(raw.totalBytes, 0),
    databaseHash,
    blobManifestHash,
    includesLogs: raw.includesLogs === true,
  }
}

async function listBlobFiles(root: string, depth = 0): Promise<BlobFile[]> {
  if (depth > 6) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const out: BlobFile[] = []
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listBlobFiles(full, depth + 1)))
    } else if (entry.isFile() && isSha256(entry.name)) {
      const info = await stat(full).catch(() => null)
      if (info) out.push({ path: full, name: entry.name, size: info.size })
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

async function inspectBackup(ctx: AppContext, rawPath: string): Promise<BackupInspection> {
  const root = resolveBackupPath(rawPath)
  const manifestPath = join(root, MANIFEST_NAME)
  if (!(await pathExists(manifestPath))) {
    throw new AppError('VALIDATION', 'The selected folder is not a Prompt Keeper backup.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('VALIDATION', 'The selected folder is not a Prompt Keeper backup.')
    }
    throw new AppError('CORRUPT', 'The backup manifest is not valid JSON.')
  }
  const manifest = normalizeManifest(parsed)
  const currentSchema = currentSchemaVersion(ctx.db)
  if (manifest.schemaVersion > currentSchema) {
    throw new AppError(
      'VALIDATION',
      `This backup uses schema version ${manifest.schemaVersion}, which is newer than this application supports (${currentSchema}).`,
    )
  }

  const dbPath = join(root, DATABASE_SNAPSHOT_NAME)
  if (!(await pathExists(dbPath))) {
    throw new AppError('CORRUPT', 'The backup database file is missing.')
  }
  if (manifest.databaseHash) {
    const actual = await sha256File(dbPath)
    if (actual !== manifest.databaseHash) {
      throw new AppError('CORRUPT', 'The backup database failed its checksum.')
    }
  }

  const blobFiles = await listBlobFiles(join(root, 'blobs'))
  if (manifest.blobCount !== blobFiles.length) {
    throw new AppError(
      'CORRUPT',
      `The backup manifest lists ${manifest.blobCount} content blobs but ${blobFiles.length} were found.`,
    )
  }
  const hashes: string[] = []
  for (const file of blobFiles) {
    const actual = await sha256File(file.path)
    if (actual !== file.name) {
      throw new AppError('CORRUPT', 'A backup content blob failed its checksum.')
    }
    hashes.push(file.name)
  }
  if (manifest.blobManifestHash) {
    const computed = sha256Hex(hashes.sort().join('\n'))
    if (computed !== manifest.blobManifestHash) {
      throw new AppError('CORRUPT', 'The backup content list failed its checksum.')
    }
  }

  let secretCount = 0
  let backupDb: Database.Database | null = null
  try {
    backupDb = new Database(dbPath, { readonly: true, fileMustExist: true })
    const quick = backupDb.pragma('quick_check', { simple: true })
    if (typeof quick === 'string' && quick.toLowerCase() !== 'ok') {
      throw new AppError('CORRUPT', 'The backup database failed its integrity check.')
    }
    const assetsTable = backupDb
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'assets'")
      .get() as { present: number } | undefined
    if (!assetsTable) {
      throw new AppError('CORRUPT', 'The backup database does not contain a Prompt Keeper library.')
    }
    const schemaRow = backupDb
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null } | undefined
    if ((schemaRow?.version ?? 0) > currentSchema) {
      throw new AppError('VALIDATION', 'This backup was created by a newer schema version.')
    }
    const secretRow = backupDb.prepare('SELECT COUNT(*) AS count FROM secrets').get() as
      | { count: number }
      | undefined
    secretCount = secretRow?.count ?? 0
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('CORRUPT', 'The backup database cannot be opened or validated.')
  } finally {
    backupDb?.close()
  }

  const warnings: string[] = []
  if (manifest.schemaVersion < currentSchema) {
    warnings.push(
      `This backup uses schema version ${manifest.schemaVersion}; it will be migrated to version ${currentSchema}.`,
    )
  }
  if (manifest.appVersion !== ctx.appVersion) {
    warnings.push(`This backup was created by Prompt Keeper ${manifest.appVersion}.`)
  }
  if (!manifest.databaseHash) {
    warnings.push('The backup manifest has no database checksum; validation is limited.')
  }
  if (!manifest.blobManifestHash) {
    warnings.push('The backup manifest has no content-list checksum; individual blobs were still verified.')
  }
  if (manifest.includesLogs) {
    warnings.push('This backup includes application logs.')
  }
  if (secretCount > 0) {
    warnings.push(
      'Encrypted credentials in this backup can only be used on the machine that created it.',
    )
  }

  return { path: root, dbPath, manifest, warnings, blobFiles }
}

async function copyBlobFiles(
  sourceRoot: string,
  targetRoot: string,
): Promise<{ files: number; bytes: number; names: string[] }> {
  const names: string[] = []
  let bytes = 0
  if (!(await pathExists(sourceRoot))) return { files: 0, bytes: 0, names }
  await ensureDir(targetRoot)

  const walk = async (dir: string, relative: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, relativePath)
        continue
      }
      if (!entry.isFile() || !isSha256(entry.name)) continue
      const info = await stat(full).catch(() => null)
      if (!info) continue
      await copyFileEnsured(full, join(targetRoot, relativePath))
      names.push(entry.name)
      bytes += info.size
    }
  }
  await walk(sourceRoot, '')
  return { files: names.length, bytes, names }
}

async function copyDirectory(
  sourceRoot: string,
  targetRoot: string,
): Promise<{ files: number; bytes: number }> {
  if (!(await pathExists(sourceRoot))) return { files: 0, bytes: 0 }
  await ensureDir(targetRoot)
  let files = 0
  let bytes = 0

  const walk = async (dir: string, relative: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(full).catch(() => null)
      if (!info) continue
      await copyFileEnsured(full, join(targetRoot, relativePath))
      files += 1
      bytes += info.size
    }
  }
  await walk(sourceRoot, '')
  return { files, bytes }
}

async function createSnapshot(
  ctx: AppContext,
  options: { includeLogs: boolean; prefix: string },
): Promise<SnapshotResult> {
  const stamp = nowIso().replace(/[:.]/g, '-')
  const root = join(ctx.paths.backups, `${options.prefix}-${stamp}`)
  await ensureDir(root)

  const dbPath = join(root, DATABASE_SNAPSHOT_NAME)
  // VACUUM INTO produces a transactionally consistent single-file snapshot while
  // the application keeps using the live database.
  ctx.db.prepare('VACUUM INTO ?').run(dbPath)

  const blobs = await copyBlobFiles(ctx.paths.blobs, join(root, 'blobs'))
  const logs = options.includeLogs
    ? await copyDirectory(ctx.paths.logs, join(root, 'logs'))
    : { files: 0, bytes: 0 }

  const dbInfo = await stat(dbPath)
  const hashes = blobs.names.slice().sort()
  const manifest: BackupManifestFile = {
    appVersion: ctx.appVersion,
    schemaVersion: currentSchemaVersion(ctx.db),
    createdAt: nowIso(),
    counts: ctx.assets.countByKind(),
    blobCount: hashes.length,
    totalBytes: dbInfo.size + blobs.bytes + logs.bytes,
    databaseHash: await sha256File(dbPath),
    blobManifestHash: sha256Hex(hashes.join('\n')),
    includesLogs: options.includeLogs,
  }
  await writeFile(join(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { path: root, bytes: await directorySize(root), manifest }
}

function tableColumns(db: Db, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function copyTable(target: Db, source: Db, table: string): void {
  const sourceColumns = tableColumns(source, table)
  if (!sourceColumns.length) return
  const sourceSet = new Set(sourceColumns)
  const columns = tableColumns(target, table).filter((column) => sourceSet.has(column))
  if (!columns.length) return

  target.prepare(`DELETE FROM ${quoteIdent(table)}`).run()
  const rows = source
    .prepare(`SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}`)
    .all() as Array<Record<string, unknown>>
  const insert = target.prepare(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')})`,
  )
  for (const row of rows) insert.run(...columns.map((column) => row[column]))
}

function insertRow(target: Db, table: string, row: Record<string, unknown>): void {
  const columns = tableColumns(target, table).filter((column) =>
    Object.prototype.hasOwnProperty.call(row, column),
  )
  if (!columns.length) return
  target
    .prepare(
      `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns
        .map(() => '?')
        .join(', ')})`,
    )
    .run(...columns.map((column) => row[column]))
}

/**
 * The live connection cannot be closed and reopened in-process, so restore
 * copies table contents from the snapshot inside one transaction. Foreign keys
 * are disabled for the swap and restored immediately afterwards.
 */
async function restoreDatabase(ctx: AppContext, backupDbPath: string): Promise<void> {
  await ensureDir(ctx.paths.temp)
  const tempPath = join(ctx.paths.temp, `restore-${newId('tmp')}.sqlite`)
  await copyFileEnsured(backupDbPath, tempPath)
  try {
    let temp: Database.Database | null = null
    try {
      temp = new Database(tempPath)
      temp.pragma('journal_mode = DELETE')
      migrate(temp)
    } finally {
      temp?.close()
    }

    const source = new Database(tempPath, { readonly: true, fileMustExist: true })
    try {
      const activeOperations = ctx.db
        .prepare("SELECT * FROM operations WHERE state IN ('started','writing')")
        .all() as Array<Record<string, unknown>>
      const foreignKeys = ctx.db.pragma('foreign_keys', { simple: true }) as number
      ctx.db.pragma('foreign_keys = OFF')
      try {
        const tx = ctx.db.transaction(() => {
          for (const table of RESTORE_TABLES) copyTable(ctx.db, source, table)
          // Keep the running restore operation visible to the operation log.
          for (const row of activeOperations) insertRow(ctx.db, 'operations', row)
        })
        tx()
      } finally {
        ctx.db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
      }
    } finally {
      source.close()
    }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      await removeIfExists(`${tempPath}${suffix}`).catch(() => undefined)
    }
  }
}

function repositorySummary(ctx: AppContext): SettingsSnapshot['repository'] {
  const row = repoRow(ctx)
  if (!row) {
    return {
      autoFetch: false,
      fetchIntervalMin: 15,
      policies: { prompts: false, contracts: false, skills: false, mcp: false },
      pushMode: 'direct',
    }
  }
  const interval = Number(row.fetch_interval_min)
  return {
    autoFetch: !!row.auto_fetch,
    fetchIntervalMin: Number.isFinite(interval) && interval > 0 ? interval : 15,
    policies: repoPolicies(ctx),
    pushMode: row.push_mode === 'branch' ? 'branch' : 'direct',
  }
}

function sanitizeRepositoryUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  try {
    const url = new URL(raw)
    if (url.username) url.username = ''
    if (url.password) url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '[repository-url-not-parseable]'
  }
}

function resetConfirmationText(scope: 'library' | 'all'): string {
  return scope === 'all' ? RESET_CONFIRMATION_ALL : RESET_CONFIRMATION_LIBRARY
}

export function createSettingsService(ctx: AppContext): SettingsService {
  const pendingPreviews = new Map<string, PendingPreview>()

  function prunePreviews(): void {
    const now = Date.now()
    for (const [token, preview] of pendingPreviews) {
      if (preview.expiresAt < now) pendingPreviews.delete(token)
    }
  }

  async function buildRestorePreview(input: RestoreInput): Promise<RestorePreview> {
    let backupPath: string
    if (typeof input?.backupPath === 'string' && input.backupPath.trim()) {
      backupPath = resolveBackupPath(input.backupPath)
    } else if (input?.pickFromDialog === true) {
      const picked = await dialog.showOpenDialog({
        title: 'Select a Prompt Keeper backup folder',
        buttonLabel: 'Select backup',
        properties: ['openDirectory'],
      })
      if (picked.canceled || !picked.filePaths[0]) {
        throw new AppError('VALIDATION', 'No backup folder was selected.')
      }
      backupPath = resolve(picked.filePaths[0])
    } else {
      throw validationError('A backup folder is required.', [
        { path: 'backupPath', message: 'Choose a backup folder or open the folder picker.' },
      ])
    }

    const inspection = await inspectBackup(ctx, backupPath)
    prunePreviews()
    const previewToken = newId('rtok')
    pendingPreviews.set(previewToken, {
      kind: 'restore',
      backupPath: inspection.path,
      expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
    })
    return {
      phase: 'preview',
      backupPath: inspection.path,
      manifest: {
        appVersion: inspection.manifest.appVersion,
        schemaVersion: inspection.manifest.schemaVersion,
        createdAt: inspection.manifest.createdAt,
        counts: inspection.manifest.counts,
        blobCount: inspection.manifest.blobCount,
        totalBytes: inspection.manifest.totalBytes,
      },
      warnings: inspection.warnings,
      previewToken,
    }
  }

  async function buildResetPreview(scope: 'library' | 'all'): Promise<ResetPreview> {
    const count = (sql: string): number => {
      const row = ctx.db.prepare(sql).get() as { count: number } | undefined
      return row?.count ?? 0
    }
    const blobs = (await listBlobFiles(ctx.paths.blobs)).length
    prunePreviews()
    const previewToken = newId('rstok')
    pendingPreviews.set(previewToken, {
      kind: 'reset',
      scope,
      expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
    })
    return {
      phase: 'preview',
      scope,
      willDelete: {
        assets: count('SELECT COUNT(*) AS count FROM assets'),
        revisions: count('SELECT COUNT(*) AS count FROM asset_revisions'),
        blobs,
        deployments: count('SELECT COUNT(*) AS count FROM deployments'),
        projections: count('SELECT COUNT(*) AS count FROM projections'),
        settingsReset: scope === 'all',
        repositoryDisconnected: scope === 'all',
      },
      willKeep: {
        repositoryFiles: true,
        userProvidedClone: true,
        backups: true,
      },
      requiredConfirmationText: resetConfirmationText(scope),
      previewToken,
    }
  }

  async function applyReset(
    scope: 'library' | 'all',
    operationContext: OperationContext,
  ): Promise<void> {
    const tables = scope === 'all' ? [...RESET_LIBRARY_TABLES, ...RESET_ALL_EXTRA_TABLES] : RESET_LIBRARY_TABLES
    operationContext.progress('reset', 0, tables.length, 'Deleting local library records')
    const foreignKeys = ctx.db.pragma('foreign_keys', { simple: true }) as number
    ctx.db.pragma('foreign_keys = OFF')
    try {
      const tx = ctx.db.transaction(() => {
        for (const table of tables) {
          ctx.db.prepare(`DELETE FROM ${quoteIdent(table)}`).run()
        }
        if (scope === 'all') {
          ctx.db.prepare('DELETE FROM secrets').run()
        } else {
          ctx.db
            .prepare("DELETE FROM secrets WHERE owner_type IN ('mcp_env','mcp_header')")
            .run()
        }
      })
      tx()
    } finally {
      ctx.db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
    }
    operationContext.progress('reset', tables.length, tables.length, 'Removing local library files')

    let warning: string | undefined
    try {
      await removeIfExists(ctx.paths.blobs)
      await removeIfExists(ctx.paths.library)
      await ensureLocalDirectories(ctx)
    } catch (error) {
      warning = error instanceof Error ? error.message : 'Local library files could not be removed.'
      ctx.logger.warn('settings', 'Reset could not remove every local file', { message: warning })
    }

    try {
      ctx.assets.rebuildIndex()
    } catch (error) {
      ctx.logger.warn('settings', 'Search index could not be cleared after reset', {
        message: error instanceof Error ? error.message : 'unknown',
      })
    }

    const domains = ['prompts', 'contracts', 'skills', 'mcp', 'dispatch', 'projections', 'search'] as const
    for (const domain of domains) {
      ctx.events.domainChanged(domain, 'deleted', [], operationContext.operationId)
    }
    if (scope === 'all') {
      ctx.events.domainChanged('sync', 'deleted', [], operationContext.operationId)
      ctx.events.domainChanged('ai', 'deleted', [], operationContext.operationId)
      ctx.events.domainChanged('settings', 'deleted', [], operationContext.operationId)
      applyNativeTheme('system')
    }
    try {
      ctx.audit.log({
        type: 'reset',
        result: warning ? 'warning' : 'success',
        title: scope === 'all' ? 'All local data was reset' : 'Local library was reset',
        ...(warning ? { detail: { warning } } : {}),
        operationId: operationContext.operationId,
      })
    } catch {
      // Audit history is best effort after a destructive reset.
    }
  }

  async function getSnapshot(): Promise<SettingsSnapshot> {
    const theme = readThemePreference(ctx)
    const density = readDensityPreference(ctx)
    const locations = await collectDataLocations(ctx)
    const sizeOf = (id: DataLocationId): number =>
      locations.find((location) => location.id === id)?.sizeBytes ?? 0
    const providers = listAiProviders(ctx)
    const telemetry = setting<unknown>(ctx, 'privacy.telemetry', false)
    const disclosure = setting<unknown>(ctx, 'ai.disclosureAcceptedAt', undefined)

    return {
      theme,
      effectiveTheme: effectiveThemeFor(theme),
      density,
      repository: repositorySummary(ctx),
      privacy: {
        telemetry: telemetry === true,
        ...(typeof disclosure === 'string' && disclosure
          ? { dataDisclosureAcceptedAt: disclosure }
          : {}),
      },
      updates: readUpdatePreferences(ctx),
      data: {
        locations,
        storageBytes: {
          database: sizeOf('database'),
          blobs: sizeOf('blobs'),
          library: sizeOf('library'),
          backups: sizeOf('backups'),
        },
      },
      ai: {
        configured: providers.length > 0,
        providers,
      },
      app: {
        version: ctx.appVersion,
        buildId: ctx.buildId,
        schemaVersion: currentSchemaVersion(ctx.db),
        contractVersion: 1,
      },
    }
  }

  return {
    async get(): Promise<SettingsSnapshot> {
      return getSnapshot()
    },

    async update(input: SettingsUpdateInput): Promise<SettingsSnapshot> {
      const writes: Array<[string, unknown]> = []
      if (input?.theme !== undefined) {
        if (!isThemeMode(input.theme)) {
          throw validationError('Choose light, dark, or system.', [
            { path: 'theme', message: 'Expected "light", "dark", or "system".' },
          ])
        }
        writes.push(['ui.theme', input.theme])
      }
      if (input?.density !== undefined) {
        if (!isDensity(input.density)) {
          throw validationError('Choose a density preference.', [
            { path: 'density', message: 'Expected "comfortable" or "compact".' },
          ])
        }
        writes.push(['ui.density', input.density])
      }
      if (input?.privacy !== undefined) {
        if (!isRecord(input.privacy)) {
          throw validationError('Privacy settings are invalid.', [
            { path: 'privacy', message: 'Expected an object.' },
          ])
        }
        if (input.privacy.telemetry !== undefined) {
          if (typeof input.privacy.telemetry !== 'boolean') {
            throw validationError('Telemetry must be on or off.', [
              { path: 'privacy.telemetry', message: 'Expected a boolean.' },
            ])
          }
          writes.push(['privacy.telemetry', input.privacy.telemetry])
        }
      }
      if (input?.updates !== undefined) {
        if (!isRecord(input.updates)) {
          throw validationError('Update settings are invalid.', [
            { path: 'updates', message: 'Expected an object.' },
          ])
        }
        if (input.updates.channel !== undefined) {
          if (input.updates.channel !== 'stable' && input.updates.channel !== 'beta') {
            throw validationError('Choose a stable or beta update channel.', [
              { path: 'updates.channel', message: 'Expected "stable" or "beta".' },
            ])
          }
          writes.push(['updates.channel', input.updates.channel])
        }
        if (input.updates.autoCheck !== undefined) {
          if (typeof input.updates.autoCheck !== 'boolean') {
            throw validationError('Automatic update checks must be on or off.', [
              { path: 'updates.autoCheck', message: 'Expected a boolean.' },
            ])
          }
          writes.push(['updates.autoCheck', input.updates.autoCheck])
        }
      }

      if (writes.length) {
        const tx = ctx.db.transaction(() => {
          for (const [key, value] of writes) setSetting(ctx, key, value)
        })
        tx()
        if (input?.theme !== undefined && isThemeMode(input.theme)) {
          applyNativeTheme(input.theme)
        }
        ctx.events.domainChanged('settings', 'updated', [])
      }
      return getSnapshot()
    },

    async backup(input: SettingsBackupInput): Promise<OperationRef> {
      return ctx.operations.start('backup', async (operationContext) => {
        operationContext.progress('snapshot', 0, 2, 'Creating a consistent database snapshot')
        const snapshot = await createSnapshot(ctx, {
          includeLogs: input?.includeLogs === true,
          prefix: 'backup',
        })
        operationContext.progress('snapshot', 2, 2, 'Backup complete')
        try {
          ctx.audit.log({
            type: 'backup',
            title: 'Local backup created',
            detail: { path: snapshot.path, bytes: snapshot.bytes },
            operationId: operationContext.operationId,
          })
        } catch {
          // The backup already succeeded; audit persistence is best effort.
        }
        ctx.events.domainChanged('settings', 'updated', [], operationContext.operationId)
        return { type: 'backup', path: snapshot.path, bytes: snapshot.bytes }
      })
    },

    async restore(input: RestoreInput): Promise<RestoreResult> {
      if (input?.confirm !== true) {
        return buildRestorePreview(input)
      }
      const token = typeof input.previewToken === 'string' ? input.previewToken : ''
      if (!token) {
        throw validationError('Preview the backup before restoring it.', [
          { path: 'previewToken', message: 'A preview token is required to restore.' },
        ])
      }
      const preview = pendingPreviews.get(token)
      if (!preview || preview.kind !== 'restore' || preview.expiresAt < Date.now()) {
        pendingPreviews.delete(token)
        throw validationError('The restore preview expired. Preview the backup again.', [
          { path: 'previewToken', message: 'Preview the backup again.' },
        ])
      }
      const backupPath = preview.backupPath
      if (!backupPath) {
        pendingPreviews.delete(token)
        throw validationError('The restore preview is incomplete. Preview the backup again.', [
          { path: 'previewToken', message: 'Preview the backup again.' },
        ])
      }
      if (typeof input.backupPath === 'string' && input.backupPath.trim()) {
        const requested = resolveBackupPath(input.backupPath)
        if (requested !== backupPath) {
          pendingPreviews.delete(token)
          throw validationError('The backup path changed after the preview.', [
            { path: 'backupPath', message: 'Preview the backup again.' },
          ])
        }
      }
      pendingPreviews.delete(token)

      return ctx.operations.start('restore', async (operationContext) => {
        operationContext.progress('validate', 0, 1, 'Validating the backup')
        const inspection = await inspectBackup(ctx, backupPath)
        operationContext.progress('safety', 0, 1, 'Creating a safety backup of the current data')
        const safety = await createSnapshot(ctx, { includeLogs: false, prefix: 'safety-backup' })

        const total = inspection.blobFiles.length
        operationContext.progress('blobs', 0, total, 'Restoring content blobs')
        let completed = 0
        // Blobs are content-addressed and restored additively. Extra blobs from
        // the current library stay behind harmlessly, while a failure here
        // cannot orphan blobs the live database still references.
        for (const file of inspection.blobFiles) {
          const content = await readFile(file.path)
          if (sha256Hex(content) !== file.name) {
            throw new AppError('CORRUPT', 'A backup content blob failed its checksum.')
          }
          ctx.blobs.writeSync(content)
          completed += 1
          if (completed % 100 === 0 || completed === total) {
            operationContext.progress('blobs', completed, total, 'Restoring content blobs')
          }
        }

        operationContext.progress('database', 0, 1, 'Restoring the local database')
        await restoreDatabase(ctx, inspection.dbPath)
        applyNativeTheme(readThemePreference(ctx))
        operationContext.progress('index', 0, 1, 'Rebuilding the search index')
        try {
          ctx.assets.rebuildIndex()
        } catch (error) {
          ctx.logger.warn('settings', 'Search index rebuild failed after restore', {
            message: error instanceof Error ? error.message : 'unknown',
          })
        }
        operationContext.progress('index', 1, 1, 'Search index rebuilt')

        const domains = [
          'prompts',
          'contracts',
          'skills',
          'mcp',
          'sync',
          'dispatch',
          'projections',
          'settings',
          'search',
          'ai',
        ] as const
        for (const domain of domains) {
          ctx.events.domainChanged(domain, 'restored', [], operationContext.operationId)
        }

        try {
          ctx.audit.log({
            type: 'restore',
            title: 'Backup restored',
            detail: { backupPath, safetyBackupPath: safety.path },
            operationId: operationContext.operationId,
          })
        } catch {
          // The restored data is already in place; audit persistence is best effort.
        }
        return { type: 'restore', restored: true, safetyBackupPath: safety.path }
      })
    },

    async reset(input: ResetInput): Promise<ResetResult> {
      const scope = input?.scope
      if (scope !== 'library' && scope !== 'all') {
        throw validationError('Choose what to reset.', [
          { path: 'scope', message: 'Expected "library" or "all".' },
        ])
      }
      if (input?.confirm !== true) return buildResetPreview(scope)

      const token = typeof input.previewToken === 'string' ? input.previewToken : ''
      if (!token) {
        throw validationError('Preview the reset before confirming it.', [
          { path: 'previewToken', message: 'A preview token is required to reset.' },
        ])
      }
      const preview = pendingPreviews.get(token)
      if (!preview || preview.kind !== 'reset' || preview.expiresAt < Date.now()) {
        pendingPreviews.delete(token)
        throw validationError('The reset preview expired. Preview the reset again.', [
          { path: 'previewToken', message: 'Preview the reset again.' },
        ])
      }
      if (preview.scope !== scope) {
        pendingPreviews.delete(token)
        throw validationError('The reset scope changed after the preview.', [
          { path: 'scope', message: 'Preview the reset again.' },
        ])
      }
      const required = resetConfirmationText(scope)
      if (input.confirmationText !== required) {
        throw validationError(`Type "${required}" to confirm the reset.`, [
          { path: 'confirmationText', message: `Enter ${required} exactly.` },
        ])
      }
      pendingPreviews.delete(token)

      return ctx.operations.start('reset', async (operationContext) => {
        await applyReset(scope, operationContext)
        return { type: 'reset', scope }
      })
    },

    async diagnostics(): Promise<DiagnosticExportResult> {
      const locations = await collectDataLocations(ctx)
      const repo = repoRow(ctx)
      let locale = 'en-US'
      try {
        locale = app.getLocale() || locale
      } catch {
        // Locale is informational only.
      }
      const operations = ctx.db
        .prepare(
          'SELECT id, type, state, started_at, finished_at FROM operations ORDER BY started_at DESC LIMIT 50',
        )
        .all() as Array<{
        id: string
        type: string
        state: string
        started_at: string
        finished_at: string | null
      }>

      const payload = {
        app: {
          version: ctx.appVersion,
          buildId: ctx.buildId,
          schemaVersion: currentSchemaVersion(ctx.db),
          contractVersion: 1,
        },
        environment: {
          platform: osPlatform(),
          release: osRelease(),
          arch: arch(),
          electron: process.versions.electron ?? null,
          node: process.versions.node,
          locale,
        },
        repository: repo
          ? {
              provider: repo.provider,
              branch: repo.branch,
              cloneMode: repo.clone_mode,
              url: sanitizeRepositoryUrl(repo.url),
              policies: repoPolicies(ctx),
              autoFetch: !!repo.auto_fetch,
              fetchIntervalMin: repo.fetch_interval_min,
              pushMode: repo.push_mode,
            }
          : null,
        data: {
          locations: locations.map((location) => ({
            id: location.id,
            path: location.path,
            exists: location.exists,
          })),
        },
        counts: {
          assets: ctx.assets.countByKind(),
          audit: ctx.audit.countsByType(),
        },
        operations,
        logs: redact(ctx.logger.recent(160_000)),
      }

      const sections = Object.keys(payload)
      const body = redact(JSON.stringify(payload, null, 2))
      await ensureDir(ctx.paths.backups)
      const path = join(
        ctx.paths.backups,
        `diagnostics-${nowIso().replace(/[:.]/g, '-')}.json`,
      )
      await writeText(path, `${body}\n`)
      return { path, sections, redacted: true }
    },
  }
}
