/**
 * Projection engine.
 *
 * Contracts are compiled from database state and written into Agent instruction
 * targets. The renderer never supplies target paths or content.
 *
 * Single-file targets receive one managed block per contract; all other content
 * in the file is preserved. Per-contract targets receive one generated file.
 */

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import type {
  GlobalProjectionProjectInput,
  GlobalProjectionQuery,
  GlobalTargetDetail,
  GlobalTargetUpdateInput,
  GlobalTargetUpdateResult,
  IpcErrorCode,
  OperationRef,
  Page,
  ProjectionDetail,
  ProjectionOperationResult,
  ProjectionOverwriteDriftInput,
  ProjectionProjectInput,
  ProjectionQuery,
  ProjectionRemoveResult,
  ProjectionStatus,
} from '../../shared/contracts'
import type { ContractFileModel, ContractTarget, SyncPolicy } from '../../shared/contracts'
import {
  compileContract,
  parseManagedFile,
  upsertManagedBlocks,
  type CompileTarget,
  type ManagedParseResult,
} from '../../shared/domain/compiler'
import {
  contractRepoPath,
  contractSlug,
  normalizeActivation,
  parseContractFile,
} from '../../shared/domain/contractFile'
import { AppError, isAppError } from '../../shared/domain/errors'
import { isPathInside, safePathSegment } from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import {
  GLOBAL_TARGET_BY_ID,
  GLOBAL_TARGET_DEFS,
  defaultGlobalTargetPath,
  projectTarget,
  resolveGlobalProjectionPath,
  resolveProjectTargetPath,
  targetCompatibility,
  type GlobalTargetDef,
} from '../../shared/domain/targets'
import { pathExists, readTextIfExists, writeAtomic } from '../adapters/fs'
import { sha256Hex } from '../adapters/hash'
import type { AppContext } from '../context'
import { expandUserPath } from '../paths'
import type { RevisionRecord } from './assetStore'
import type { OperationContext } from '../operations'
import type { ProjectionService } from './types'

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 500
const INVALID_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/
const TOKEN_PATH = /^(%APPDATA%|%USERPROFILE%)[\\/]/i

/* ------------------------------------------------------------------ */
/* Row models                                                          */
/* ------------------------------------------------------------------ */

interface ProjectRow {
  id: string
  name: string
  rootPath: string
  createdAt: string
}

interface GlobalTargetRow {
  id: string
  agentId: string
  label: string
  pathMode: 'file' | 'dir'
  path: string
  defaultPath: string
  format: string
  mergeMode: 'single-file' | 'per-contract'
  fileExt: string | null
  supportsJson: string
  maxBytes: number | null
  updatedAt: string
}

interface ProjectionRecord {
  id: string
  contractId: string | null
  contractTitle: string | null
  contractSlug: string | null
  targetId: string
  scope: 'project' | 'global'
  projectId: string
  targetPath: string
  status: ProjectionStatus
  deployedRevisionId: string | null
  previousRevisionId: string | null
  fileHash: string | null
  outsideHash: string | null
  blockHash: string | null
  deployedAt: string | null
  note: string | null
  orphaned: boolean
}

interface ProjectionView extends ProjectionRecord {
  liveTitle: string | null
  liveSlug: string | null
  contractDeleted: boolean
  deployedVersion: number | null
  previousVersion: number | null
}

interface ContractSnapshot {
  model: ContractFileModel
  revision: RevisionRecord
  sourcePath: string
}

interface Classification {
  status: ProjectionStatus
  note: string | null
  /** Current on-disk hashes, recorded when the managed content is intact. */
  fileHash?: string
  outsideHash?: string
}

interface TargetDescriptor {
  id: string
  label: string
  compileTarget: CompileTarget
  resolvePath(model: ContractFileModel): string
  singleFile: boolean
  supports: ContractTarget['supports']
}

interface WriteHashes {
  fileHash: string
  outsideHash: string | null
  blockHash: string | null
}

class ManagedBlockStructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManagedBlockStructureError'
  }
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function uniq(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function isBlockSegment(
  segment: ManagedParseResult['segments'][number],
): segment is { type: 'block'; id: string; text: string } {
  return segment.type === 'block'
}

/**
 * Content outside managed blocks, with separator whitespace inserted between
 * blocks normalized away. This keeps sibling projections in one file from
 * being reported as drifted when another contract is written.
 */
function outsideSignature(segments: ManagedParseResult['segments']): string {
  return segments
    .filter((segment): segment is { type: 'text'; text: string } => segment.type === 'text')
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

function assertConfirm(confirm: boolean): void {
  if (confirm !== true) {
    throw new AppError('VALIDATION', 'This action requires explicit confirmation.')
  }
}

function errorPayloadMessage(error: unknown): { code: IpcErrorCode; message: string } {
  if (isAppError(error)) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'INTERNAL', message: error.message }
  return { code: 'INTERNAL', message: 'Unexpected internal error.' }
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/**
 * A global target path must be absolute or start with `~`. Credential-shaped
 * environment tokens are accepted only because `expandUserPath` documents them.
 */
function validateGlobalPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new AppError('VALIDATION', 'The global target path is required.')
  if (/[\n\r\0]/.test(trimmed)) {
    throw new AppError('VALIDATION', 'The global target path must not contain a newline or NUL character.')
  }
  if (INVALID_SEGMENT.test(trimmed)) {
    throw new AppError('VALIDATION', 'The global target path must not contain ".." segments.')
  }
  const absolute = /^([A-Za-z]:[\\/]|\/)/.test(trimmed)
  if (!absolute && !trimmed.startsWith('~') && !TOKEN_PATH.test(trimmed)) {
    throw new AppError('VALIDATION', 'The global target path must be absolute or start with "~".')
  }
  return trimmed
}

function expandGlobalPath(path: string): string {
  return expandUserPath(validateGlobalPath(path))
}

function resolveProjectFilePath(
  rootPath: string,
  target: ContractTarget,
  model: ContractFileModel,
): string {
  const resolved = resolvePath(resolveProjectTargetPath(target, rootPath, contractSlug(model)))
  const root = resolvePath(rootPath)
  if (!isPathInside(root, resolved)) {
    throw new AppError('VALIDATION', `The path for ${target.label} resolves outside the project root.`)
  }
  return resolved
}

function resolveGlobalFilePath(
  target: GlobalTargetRow,
  model: ContractFileModel,
): string {
  const base = expandGlobalPath(target.path)
  if (target.pathMode === 'file' || target.mergeMode === 'single-file') return base
  const resolved = resolvePath(
    resolveGlobalProjectionPath(
      {
        path: base,
        pathMode: target.pathMode,
        merge: target.mergeMode,
        ...(target.fileExt ? { fileExt: target.fileExt } : {}),
      },
      contractSlug(model),
    ),
  )
  if (!isPathInside(base, resolved)) {
    throw new AppError('VALIDATION', `The resolved file for ${target.label} is outside its global directory.`)
  }
  return resolved
}

/* ------------------------------------------------------------------ */
/* Contract loading                                                    */
/* ------------------------------------------------------------------ */

function loadContractModel(ctx: AppContext, assetId: string): ContractFileModel | null {
  const row = ctx.db
    .prepare(
      `SELECT a.id, a.title, a.slug, a.folder, a.description, a.sync_policy, a.deleted_at,
              c.body, c.scope, c.path_prefix, c.activation_json, c.priority, c.imports_json, c.target_ids_json
       FROM assets a
       LEFT JOIN contracts c ON c.asset_id = a.id
       WHERE a.id = ?`,
    )
    .get(assetId) as Record<string, unknown> | undefined
  if (!row || row.deleted_at || !row.scope) return null
  return {
    id: assetId,
    title: asString(row.title),
    description: asString(row.description),
    folder: asString(row.folder),
    scope: row.scope as ContractFileModel['scope'],
    pathPrefix: typeof row.path_prefix === 'string' && row.path_prefix ? row.path_prefix : null,
    activation: normalizeActivation(parseJson(row.activation_json as string | null, { mode: 'always', globs: [] })),
    priority: typeof row.priority === 'number' ? row.priority : 50,
    imports: asStringArray(parseJson(row.imports_json as string | null, [])),
    targetIds: asStringArray(parseJson(row.target_ids_json as string | null, [])),
    tags: ctx.assets.tags(assetId),
    syncPolicy: (row.sync_policy as SyncPolicy) ?? 'inherit',
    body: asString(row.body),
  }
}

async function loadContractModelAtRevision(
  ctx: AppContext,
  assetId: string,
  revisionId: string,
): Promise<ContractFileModel | null> {
  const revision = ctx.assets.getRevision(revisionId)
  const file =
    revision.files.find((entry) => entry.mediaKind === 'text' && entry.path.endsWith('.contract.md')) ??
    revision.files.find((entry) => entry.mediaKind === 'text')
  if (!file) return null
  const text = (await ctx.blobs.read(file.blobHash)).toString('utf8')
  const parsed = parseContractFile(text, file.path)
  if (!parsed.model) return null
  // The asset ID is the projection identity, regardless of frontmatter drift.
  return { ...parsed.model, id: assetId }
}

function loadContractSnapshot(ctx: AppContext, assetId: string): ContractSnapshot | null {
  const model = loadContractModel(ctx, assetId)
  if (!model) return null
  const revision = ctx.assets.currentRevisionOrNull(assetId)
  if (!revision) return null
  return { model, revision, sourcePath: contractRepoPath(model) }
}

function currentRevisionFor(ctx: AppContext, contractId: string | null): RevisionRecord | null {
  if (!contractId) return null
  const row = ctx.db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(contractId) as
    | { deleted_at: string | null }
    | undefined
  if (!row || row.deleted_at) return null
  return ctx.assets.currentRevisionOrNull(contractId)
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function loadProject(ctx: AppContext, projectId: string): ProjectRow | null {
  const row = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return {
    id: row.id as string,
    name: row.name as string,
    rootPath: row.root_path as string,
    createdAt: row.created_at as string,
  }
}

function requireProject(ctx: AppContext, projectId: string): ProjectRow {
  const projects = ctx.db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }
  if (!projectId || typeof projectId !== 'string') {
    throw new AppError(
      projects.count === 0 ? 'CONFLICT' : 'VALIDATION',
      'Project-level projections require a registered project root. Register a project root first.',
    )
  }
  const project = loadProject(ctx, projectId)
  if (!project) {
    throw new AppError('CONFLICT', 'This project root is not registered. Register a project root before projecting.')
  }
  return project
}

/* ------------------------------------------------------------------ */
/* Global targets                                                      */
/* ------------------------------------------------------------------ */

function seedGlobalTargets(ctx: AppContext): void {
  const at = nowIso()
  const statement = ctx.db.prepare(
    `INSERT INTO global_targets
       (id, agent_id, label, path_mode, path, default_path, format, merge_mode, file_ext, supports_json, max_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_id = excluded.agent_id,
       label = excluded.label,
       path_mode = excluded.path_mode,
       default_path = excluded.default_path,
       format = excluded.format,
       merge_mode = excluded.merge_mode,
       file_ext = excluded.file_ext,
       supports_json = excluded.supports_json,
       max_bytes = excluded.max_bytes`,
  )
  for (const def of GLOBAL_TARGET_DEFS) {
    const defaultPath = defaultGlobalTargetPath(def, ctx.platform)
    statement.run(
      def.id,
      def.agentId,
      def.label,
      def.pathMode,
      defaultPath,
      defaultPath,
      def.format,
      def.merge,
      def.fileExt ?? null,
      JSON.stringify(def.supports),
      def.maxBytes ?? null,
      at,
    )
  }
}

function loadGlobalTargetRow(ctx: AppContext, targetId: string): GlobalTargetRow | null {
  const row = ctx.db.prepare('SELECT * FROM global_targets WHERE id = ?').get(targetId) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    label: row.label as string,
    pathMode: row.path_mode as 'file' | 'dir',
    path: row.path as string,
    defaultPath: row.default_path as string,
    format: row.format as string,
    mergeMode: row.merge_mode as 'single-file' | 'per-contract',
    fileExt: (row.file_ext as string | null) ?? null,
    supportsJson: (row.supports_json as string) ?? '{}',
    maxBytes: (row.max_bytes as number | null) ?? null,
    updatedAt: row.updated_at as string,
  }
}

function globalTargetDef(targetId: string): GlobalTargetDef | null {
  return GLOBAL_TARGET_BY_ID[targetId] ?? null
}

function compileTargetForGlobal(row: GlobalTargetRow, def: GlobalTargetDef): CompileTarget {
  return {
    id: def.id,
    label: def.label,
    format: def.format,
    merge: def.merge,
    supports: def.supports,
    ...(def.maxBytes ? { maxBytes: def.maxBytes } : {}),
  }
}

function compileTargetForProject(target: ContractTarget): CompileTarget {
  return {
    id: target.id,
    label: target.label,
    format: target.format,
    merge: target.merge,
    supports: target.supports,
    ...(target.maxBytes ? { maxBytes: target.maxBytes } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* Projection records                                                  */
/* ------------------------------------------------------------------ */

function mapProjectionRecord(row: Record<string, unknown>): ProjectionRecord {
  return {
    id: row.id as string,
    contractId: (row.contract_id as string | null) ?? null,
    contractTitle: (row.contract_title as string | null) ?? null,
    contractSlug: (row.contract_slug as string | null) ?? null,
    targetId: row.target_id as string,
    scope: row.scope as 'project' | 'global',
    projectId: row.project_id as string,
    targetPath: row.target_path as string,
    status: row.status as ProjectionStatus,
    deployedRevisionId: (row.deployed_revision_id as string | null) ?? null,
    previousRevisionId: (row.previous_revision_id as string | null) ?? null,
    fileHash: (row.file_hash as string | null) ?? null,
    outsideHash: (row.outside_hash as string | null) ?? null,
    blockHash: (row.block_hash as string | null) ?? null,
    deployedAt: (row.deployed_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    orphaned: !!row.orphaned,
  }
}

function loadProjectionRecord(ctx: AppContext, projectionId: string): ProjectionRecord {
  if (!projectionId) throw new AppError('VALIDATION', 'A projection ID is required.')
  const row = ctx.db.prepare('SELECT * FROM projections WHERE id = ?').get(projectionId) as
    | Record<string, unknown>
    | undefined
  if (!row) throw new AppError('NOT_FOUND', 'This projection no longer exists.')
  return mapProjectionRecord(row)
}

function findProjectionByKey(
  ctx: AppContext,
  contractId: string,
  targetId: string,
  scope: 'project' | 'global',
  projectId: string,
): ProjectionRecord | null {
  const row = ctx.db
    .prepare(
      'SELECT * FROM projections WHERE contract_id = ? AND target_id = ? AND scope = ? AND project_id = ?',
    )
    .get(contractId, targetId, scope, projectId) as Record<string, unknown> | undefined
  return row ? mapProjectionRecord(row) : null
}

function mapProjectionView(row: Record<string, unknown>): ProjectionView {
  const record = mapProjectionRecord(row)
  const contractDeleted = !!row.contract_deleted_at
  return {
    ...record,
    liveTitle: (row.live_title as string | null) ?? null,
    liveSlug: (row.live_slug as string | null) ?? null,
    contractDeleted,
    deployedVersion: (row.deployed_version as number | null) ?? null,
    previousVersion: (row.previous_version as number | null) ?? null,
  }
}

const VIEW_SELECT = `
  SELECT p.*,
         dr.version AS deployed_version,
         pr.version AS previous_version,
         a.title AS live_title,
         a.slug AS live_slug,
         a.deleted_at AS contract_deleted_at
  FROM projections p
  LEFT JOIN asset_revisions dr ON dr.id = p.deployed_revision_id
  LEFT JOIN asset_revisions pr ON pr.id = p.previous_revision_id
  LEFT JOIN assets a ON a.id = p.contract_id`

function loadProjectionView(ctx: AppContext, projectionId: string): ProjectionView {
  const row = ctx.db.prepare(`${VIEW_SELECT} WHERE p.id = ?`).get(projectionId) as
    | Record<string, unknown>
    | undefined
  if (!row) throw new AppError('NOT_FOUND', 'This projection no longer exists.')
  return mapProjectionView(row)
}

function persistStatus(
  ctx: AppContext,
  record: ProjectionRecord,
  classification: Classification,
  orphaned: boolean,
): void {
  const nextNote = classification.note
  const nextFileHash = classification.fileHash ?? record.fileHash
  const nextOutsideHash = classification.outsideHash ?? record.outsideHash
  if (
    record.status === classification.status &&
    record.note === nextNote &&
    record.orphaned === orphaned &&
    record.fileHash === nextFileHash &&
    record.outsideHash === nextOutsideHash
  ) {
    return
  }
  ctx.db
    .prepare(
      'UPDATE projections SET status = ?, note = ?, orphaned = ?, file_hash = ?, outside_hash = ? WHERE id = ?',
    )
    .run(classification.status, nextNote, orphaned ? 1 : 0, nextFileHash, nextOutsideHash, record.id)
  record.status = classification.status
  record.note = nextNote
  record.orphaned = orphaned
  record.fileHash = nextFileHash
  record.outsideHash = nextOutsideHash
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

function isSingleFileTarget(ctx: AppContext, record: ProjectionRecord): boolean {
  if (record.scope === 'project') {
    return projectTarget(record.targetId)?.merge === 'single-file'
  }
  const row = loadGlobalTargetRow(ctx, record.targetId)
  return !!row && (row.pathMode === 'file' || row.mergeMode === 'single-file')
}

function expectedProjectionPath(
  ctx: AppContext,
  record: ProjectionRecord,
  slug: string,
): string | null {
  const modelStub = { id: record.contractId ?? record.id, title: slug }
  if (record.scope === 'project') {
    const target = projectTarget(record.targetId)
    const project = loadProject(ctx, record.projectId)
    if (!target || !project) return null
    return resolvePath(resolveProjectTargetPath(target, project.rootPath, slug))
  }
  const target = loadGlobalTargetRow(ctx, record.targetId)
  if (!target) return null
  try {
    return resolvePath(
      resolveGlobalProjectionPath(
        {
          path: expandGlobalPath(target.path),
          pathMode: target.pathMode,
          merge: target.mergeMode,
          ...(target.fileExt ? { fileExt: target.fileExt } : {}),
        },
        safePathSegment(slug, modelStub.id),
      ),
    )
  } catch {
    return null
  }
}

/**
 * Drift is classified from content hashes, never from timestamps.
 *
 * Single-file projections are compared per managed block, so projecting one
 * contract does not mark sibling contracts in the same file as drifted.
 */
async function classifyProjection(
  ctx: AppContext,
  record: ProjectionRecord,
  slug: string,
): Promise<Classification> {
  const expected = expectedProjectionPath(ctx, record, slug)
  if (expected && expected !== resolvePath(record.targetPath)) {
    return { status: 'stale', note: 'The target path changed; re-projection is pending.' }
  }

  const currentHash = await ctx.assets.fileHash(record.targetPath)
  if (!currentHash) {
    return { status: 'missing', note: 'The target file is missing.' }
  }

  const revision = currentRevisionFor(ctx, record.contractId)
  const revisionChanged = !!revision && !!record.deployedRevisionId && revision.id !== record.deployedRevisionId

  if (isSingleFileTarget(ctx, record) && record.blockHash && record.contractId) {
    const text = await readTextIfExists(record.targetPath)
    if (text === null) return { status: 'missing', note: 'The target file is missing.' }
    const parsed = parseManagedFile(text)
    if (!parsed.ok) {
      return {
        status: 'drifted',
        note: parsed.error ?? 'The managed block structure is invalid.',
      }
    }
    const block = parsed.segments.find(
      (segment): segment is { type: 'block'; id: string; text: string } =>
        isBlockSegment(segment) && segment.id === record.contractId,
    )
    if (!block) {
      return { status: 'drifted', note: 'The managed block was removed from the target file.' }
    }
    if (sha256Hex(block.text) !== record.blockHash) {
      return { status: 'drifted', note: 'The managed block was edited outside Prompt Keeper.' }
    }
    const outsideHash = sha256Hex(outsideSignature(parsed.segments))
    if (record.outsideHash && outsideHash !== record.outsideHash) {
      return { status: 'drifted', note: 'Content outside the managed block changed.' }
    }
    if (revisionChanged) {
      return {
        status: 'stale',
        note: 'The contract has changed since this projection.',
        fileHash: currentHash,
        outsideHash,
      }
    }
    return { status: 'synced', note: null, fileHash: currentHash, outsideHash }
  }

  if (currentHash !== record.fileHash) {
    return { status: 'drifted', note: 'The target file was edited outside Prompt Keeper.' }
  }
  if (revisionChanged) {
    return { status: 'stale', note: 'The contract has changed since this projection.' }
  }
  return { status: 'synced', note: null }
}

async function refreshClassification(ctx: AppContext, view: ProjectionView): Promise<ProjectionView> {
  const slug = view.liveSlug ?? view.contractSlug ?? ''
  const classification = await classifyProjection(
    ctx,
    {
      id: view.id,
      contractId: view.contractId,
      contractTitle: view.contractTitle,
      contractSlug: view.contractSlug,
      targetId: view.targetId,
      scope: view.scope,
      projectId: view.projectId,
      targetPath: view.targetPath,
      status: view.status,
      deployedRevisionId: view.deployedRevisionId,
      previousRevisionId: view.previousRevisionId,
      fileHash: view.fileHash,
      outsideHash: view.outsideHash,
      blockHash: view.blockHash,
      deployedAt: view.deployedAt,
      note: view.note,
      orphaned: view.orphaned,
    },
    slug,
  )
  const record: ProjectionRecord = { ...view }
  const projectMissing = view.scope === 'project' && !loadProject(ctx, view.projectId)
  const orphaned = !view.contractId || view.contractDeleted || projectMissing
  persistStatus(ctx, record, classification, orphaned)
  return {
    ...view,
    status: classification.status,
    note: classification.note,
    orphaned,
    fileHash: classification.fileHash ?? view.fileHash,
    outsideHash: classification.outsideHash ?? view.outsideHash,
  }
}

/* ------------------------------------------------------------------ */
/* DTO mapping                                                         */
/* ------------------------------------------------------------------ */

function toDetail(view: ProjectionView): ProjectionDetail {
  return {
    id: view.id,
    contractId: view.contractId,
    contractTitle: view.liveTitle ?? view.contractTitle ?? 'Deleted contract',
    contractSlug: view.liveSlug ?? view.contractSlug ?? '',
    targetId: view.targetId,
    scope: view.scope,
    projectId: view.projectId,
    targetPath: view.targetPath,
    status: view.status,
    deployedRevisionId: view.deployedRevisionId,
    deployedVersion: view.deployedVersion,
    ...(view.previousVersion !== null ? { previousVersion: view.previousVersion } : {}),
    ...(view.deployedAt ? { deployedAt: view.deployedAt } : {}),
    ...(view.fileHash ? { fileHash: view.fileHash } : {}),
    ...(view.outsideHash ? { outsideHash: view.outsideHash } : {}),
    ...(view.blockHash ? { blockHash: view.blockHash } : {}),
    ...(view.note ? { note: view.note } : {}),
    orphaned: view.orphaned,
  }
}

/* ------------------------------------------------------------------ */
/* Write path                                                          */
/* ------------------------------------------------------------------ */

function analyzeMergedContent(
  content: string,
  contractId: string,
): { outsideHash: string; blockHash: string | null } {
  const parsed = parseManagedFile(content)
  if (!parsed.ok) return { outsideHash: '', blockHash: null }
  const block = parsed.segments.find(
    (segment): segment is { type: 'block'; id: string; text: string } =>
      isBlockSegment(segment) && segment.id === contractId,
  )
  return {
    outsideHash: sha256Hex(outsideSignature(parsed.segments)),
    blockHash: block ? sha256Hex(block.text) : null,
  }
}

async function writeProjectionFile(
  target: TargetDescriptor,
  model: ContractFileModel,
  sourcePath: string,
  path: string,
): Promise<WriteHashes> {
  if (target.singleFile) {
    const existing = (await readTextIfExists(path)) ?? ''
    if (existing) {
      const parsed = parseManagedFile(existing)
      if (!parsed.ok) {
        throw new ManagedBlockStructureError(
          parsed.error ?? 'The target file has an invalid managed block structure.',
        )
      }
    }
    const block = compileContract(model, target.compileTarget, sourcePath)
    const merged = upsertManagedBlocks(existing, [{ id: model.id, text: block }], [], [model.id])
    if (merged.error !== undefined) throw new ManagedBlockStructureError(merged.error)
    await writeAtomic(path, merged.text)
    const analyzed = analyzeMergedContent(merged.text, model.id)
    return {
      fileHash: sha256Hex(merged.text),
      outsideHash: analyzed.outsideHash,
      blockHash: analyzed.blockHash,
    }
  }

  const content = compileContract(model, target.compileTarget, sourcePath)
  await writeAtomic(path, content)
  return { fileHash: sha256Hex(content), outsideHash: null, blockHash: null }
}

interface SaveProjectionInput {
  contractId: string
  model: ContractFileModel
  revision: RevisionRecord
  scope: 'project' | 'global'
  projectId: string
  targetId: string
  targetPath: string
  hashes: WriteHashes
  existing: ProjectionRecord | null
}

function saveProjection(ctx: AppContext, input: SaveProjectionInput): string {
  const at = nowIso()
  const slug = contractSlug(input.model)
  const previousRevisionId =
    input.existing && input.existing.deployedRevisionId !== input.revision.id
      ? input.existing.deployedRevisionId
      : (input.existing?.previousRevisionId ?? null)

  if (input.existing) {
    ctx.db
      .prepare(
        `UPDATE projections SET
           contract_id = ?, contract_title = ?, contract_slug = ?, target_path = ?, status = 'synced',
           deployed_revision_id = ?, previous_revision_id = ?, file_hash = ?, outside_hash = ?,
           block_hash = ?, deployed_at = ?, note = NULL, orphaned = 0
         WHERE id = ?`,
      )
      .run(
        input.contractId,
        input.model.title,
        slug,
        input.targetPath,
        input.revision.id,
        previousRevisionId,
        input.hashes.fileHash,
        input.hashes.outsideHash,
        input.hashes.blockHash,
        at,
        input.existing.id,
      )
    return input.existing.id
  }

  const id = newId('prj')
  ctx.db
    .prepare(
      `INSERT INTO projections
         (id, contract_id, contract_title, contract_slug, target_id, scope, project_id, target_path,
          status, deployed_revision_id, previous_revision_id, file_hash, outside_hash, block_hash,
          deployed_at, note, orphaned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, NULL, ?, ?, ?, ?, NULL, 0)`,
    )
    .run(
      id,
      input.contractId,
      input.model.title,
      slug,
      input.targetId,
      input.scope,
      input.projectId,
      input.targetPath,
      input.revision.id,
      input.hashes.fileHash,
      input.hashes.outsideHash,
      input.hashes.blockHash,
      at,
    )
  return id
}

/* ------------------------------------------------------------------ */
/* Target descriptors                                                  */
/* ------------------------------------------------------------------ */

function projectTargetDescriptor(target: ContractTarget, project: ProjectRow): TargetDescriptor {
  return {
    id: target.id,
    label: target.label,
    compileTarget: compileTargetForProject(target),
    singleFile: target.merge === 'single-file',
    supports: target.supports,
    resolvePath: (model) => resolveProjectFilePath(project.rootPath, target, model),
  }
}

function globalTargetDescriptor(row: GlobalTargetRow, def: GlobalTargetDef): TargetDescriptor {
  return {
    id: def.id,
    label: def.label,
    compileTarget: compileTargetForGlobal(row, def),
    singleFile: def.pathMode === 'file' || def.merge === 'single-file',
    supports: def.supports,
    resolvePath: (model) => resolveGlobalFilePath(row, model),
  }
}

/* ------------------------------------------------------------------ */
/* Batch projection                                                    */
/* ------------------------------------------------------------------ */

interface BatchScopeDescriptor {
  scope: 'project' | 'global'
  project: ProjectRow | null
  targets: TargetDescriptor[]
}

function prepareBatch(ctx: AppContext, input: ProjectionProjectInput | GlobalProjectionProjectInput, scope: 'project' | 'global'): BatchScopeDescriptor {
  if (!Array.isArray(input.contractIds) || !Array.isArray(input.targetIds)) {
    throw new AppError('VALIDATION', 'The selection is invalid.')
  }
  if (input.contractIds.length === 0 || input.targetIds.length === 0) {
    throw new AppError('VALIDATION', 'Select at least one contract and one target.')
  }
  const contractIds = uniq(input.contractIds)
  const targetIds = uniq(input.targetIds)
  if (!contractIds.length) throw new AppError('VALIDATION', 'Select at least one contract.')
  if (!targetIds.length) throw new AppError('VALIDATION', 'Select at least one target.')

  if (scope === 'project') {
    const projectInput = input as ProjectionProjectInput
    const project = requireProject(ctx, asString(projectInput.projectId))
    if (!existsSync(project.rootPath)) {
      throw new AppError('CONFLICT', 'The registered project root no longer exists on disk.')
    }
    const targets = targetIds.map((targetId) => {
      const target = projectTarget(targetId)
      if (!target) {
        throw new AppError('VALIDATION', `"${targetId}" is not a project target.`)
      }
      return projectTargetDescriptor(target, project)
    })
    return { scope, project, targets }
  }

  seedGlobalTargets(ctx)
  const targets = targetIds.map((targetId) => {
    const row = loadGlobalTargetRow(ctx, targetId)
    const def = globalTargetDef(targetId)
    if (!row || !def) {
      throw new AppError('NOT_FOUND', `"${targetId}" is not a global target.`)
    }
    return globalTargetDescriptor(row, def)
  })
  return { scope, project: null, targets }
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export function createProjectionService(ctx: AppContext): ProjectionService {
  async function pageProjections(
    query: ProjectionQuery,
    forcedScope?: 'project' | 'global',
  ): Promise<Page<ProjectionDetail>> {
    seedGlobalTargets(ctx)
    const limit = Math.min(
      Math.max(typeof query.limit === 'number' ? query.limit : DEFAULT_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT,
    )
    const offset = Math.max(typeof query.offset === 'number' ? query.offset : 0, 0)
    const where: string[] = []
    const params: unknown[] = []
    const scope = forcedScope ?? query.scope
    if (scope) {
      where.push('p.scope = ?')
      params.push(scope)
    }
    if (query.contractId) {
      where.push('p.contract_id = ?')
      params.push(query.contractId)
    }
    if (query.targetId) {
      where.push('p.target_id = ?')
      params.push(query.targetId)
    }
    if (query.projectId && scope !== 'global') {
      where.push('p.project_id = ?')
      params.push(query.projectId)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const rows = ctx.db
      .prepare(`${VIEW_SELECT} ${clause} ORDER BY p.deployed_at DESC, p.id DESC`)
      .all(...params) as Array<Record<string, unknown>>

    const refreshed: ProjectionView[] = []
    for (const row of rows) {
      const view = mapProjectionView(row)
      refreshed.push(await refreshClassification(ctx, view))
    }

    const filtered = refreshed.filter((view) => {
      if (query.status && view.status !== query.status) return false
      if (typeof query.orphaned === 'boolean' && view.orphaned !== query.orphaned) return false
      return true
    })
    const items = filtered.slice(offset, offset + limit).map(toDetail)
    return {
      items,
      total: filtered.length,
      limit,
      offset,
    }
  }

  async function runProjection(
    input: ProjectionProjectInput | GlobalProjectionProjectInput,
    scope: 'project' | 'global',
    op: OperationContext,
  ): Promise<ProjectionOperationResult> {
    const descriptor = prepareBatch(ctx, input, scope)
    if (scope === 'global') seedGlobalTargets(ctx)
    const contractIds = uniq(input.contractIds)
    const result: ProjectionOperationResult = {
      scope,
      projected: 0,
      skipped: 0,
      driftedNotOverwritten: 0,
      skippedItems: [],
      failed: [],
    }
    const touched: string[] = []
    const total = contractIds.length * descriptor.targets.length
    let completed = 0

    for (const contractId of contractIds) {
      const snapshot = loadContractSnapshot(ctx, contractId)
      if (!snapshot) {
        for (const target of descriptor.targets) {
          result.failed.push({
            contractId,
            targetId: target.id,
            code: 'NOT_FOUND',
            message: 'This contract no longer exists.',
          })
        }
        completed += descriptor.targets.length
        op.progress('project', completed, total, 'Skipped a deleted contract.')
        continue
      }

      for (const target of descriptor.targets) {
        completed++
        const label = `Projecting "${snapshot.model.title}" to ${target.label}.`

        if (scope === 'global' && snapshot.model.scope !== 'user') {
          result.skipped++
          result.skippedItems.push({
            contractId,
            targetId: target.id,
            reason: 'Only user-scoped contracts are written to global targets.',
          })
          op.progress('project', completed, total, label)
          continue
        }
        if (scope === 'project' && snapshot.model.scope === 'user') {
          result.skipped++
          result.skippedItems.push({
            contractId,
            targetId: target.id,
            reason: 'This contract is user-scoped and belongs to global targets.',
          })
          op.progress('project', completed, total, label)
          continue
        }
        // Global targets are not part of ContractCreateInput.targetIds (those are
        // project-level targets), so a user-scoped contract is eligible for every
        // selected global target that supports its activation mode.
        if (scope === 'project' && !snapshot.model.targetIds.includes(target.id)) {
          result.skipped++
          result.skippedItems.push({
            contractId,
            targetId: target.id,
            reason: `Target "${target.label}" is not selected for this contract.`,
          })
          op.progress('project', completed, total, label)
          continue
        }
        const compatibility = targetCompatibility(snapshot.model, {
          id: target.id,
          label: target.label,
          supports: target.supports,
        })
        if (compatibility.blocking) {
          result.skipped++
          result.skippedItems.push({
            contractId,
            targetId: target.id,
            reason: compatibility.warnings[0] ?? `${target.label} cannot represent this contract.`,
          })
          op.progress('project', completed, total, label)
          continue
        }

        const existing = findProjectionByKey(
          ctx,
          contractId,
          target.id,
          scope,
          descriptor.project?.id ?? '',
        )

        try {
          if (existing) {
            const classification = await classifyProjection(ctx, existing, contractSlug(snapshot.model))
            persistStatus(ctx, existing, classification, !existing.contractId)
            if (classification.status === 'drifted') {
              result.driftedNotOverwritten++
              result.skippedItems.push({
                contractId,
                targetId: target.id,
                reason:
                  classification.note ??
                  'The target file was modified after the last projection, so it was not overwritten.',
              })
              op.progress('project', completed, total, label)
              continue
            }
          }

          const targetPath = target.resolvePath(snapshot.model)

          if (!target.singleFile) {
            const managedHere = !!existing && resolvePath(existing.targetPath) === targetPath
            if (!managedHere && (await pathExists(targetPath))) {
              result.skipped++
              result.skippedItems.push({
                contractId,
                targetId: target.id,
                reason:
                  'The target file already exists and is not managed by Prompt Keeper. Remove or rename it, then project again.',
              })
              op.progress('project', completed, total, label)
              continue
            }
          }

          const hashes = await writeProjectionFile(
            target,
            snapshot.model,
            snapshot.sourcePath,
            targetPath,
          )
          const projectionId = saveProjection(ctx, {
            contractId,
            model: snapshot.model,
            revision: snapshot.revision,
            scope,
            projectId: descriptor.project?.id ?? '',
            targetId: target.id,
            targetPath,
            hashes,
            existing,
          })
          touched.push(projectionId)
          result.projected++
          ctx.audit.log({
            type: 'projection',
            result: 'success',
            title: `Projected "${snapshot.model.title}" to ${target.label}`,
            assetId: contractId,
            targetId: target.id,
            operationId: op.operationId,
            detail: {
              scope,
              projectId: descriptor.project?.id ?? null,
              targetPath,
              revisionId: snapshot.revision.id,
              revisionVersion: snapshot.revision.version,
              previousRevisionId: existing?.deployedRevisionId ?? null,
            },
          })
        } catch (error) {
          if (error instanceof ManagedBlockStructureError) {
            if (existing) {
              persistStatus(
                ctx,
                existing,
                { status: 'drifted', note: error.message },
                !existing.contractId,
              )
            }
            result.skipped++
            result.skippedItems.push({
              contractId,
              targetId: target.id,
              reason: `The target file has an invalid managed block structure, so it was not rewritten: ${error.message}`,
            })
          } else {
            const mapped = errorPayloadMessage(error)
            result.failed.push({
              contractId,
              targetId: target.id,
              code: mapped.code,
              message: mapped.message,
            })
          }
        }
        op.progress('project', completed, total, label)
      }
    }

    ctx.events.domainChanged('projections', 'projected', touched, op.operationId)
    if (scope === 'global') {
      ctx.events.domainChanged('globalTargets', 'projected', descriptor.targets.map((target) => target.id), op.operationId)
    }
    if (touched.length || result.skippedItems.length || result.failed.length) {
      ctx.audit.log({
        type: 'projection',
        result: result.failed.length ? 'warning' : 'success',
        title: `${scope === 'global' ? 'Global' : 'Project'} projection batch finished`,
        operationId: op.operationId,
        detail: {
          scope,
          projectId: descriptor.project?.id ?? null,
          projected: result.projected,
          skipped: result.skipped,
          driftedNotOverwritten: result.driftedNotOverwritten,
          failed: result.failed.length,
        },
      })
    }
    return result
  }

  function startProjection(
    input: ProjectionProjectInput | GlobalProjectionProjectInput,
    scope: 'project' | 'global',
  ): OperationRef {
    assertConfirm(input.confirm)
    // Validation happens before the operation starts so the caller receives a
    // typed error instead of an asynchronously failed operation.
    prepareBatch(ctx, input, scope)
    return ctx.operations.start(
      'projection',
      (op) => {
        return runProjection(input, scope, op).then((result) => ({ type: 'projection' as const, result }))
      },
      { cancellable: false },
    )
  }

  return {
    list(query) {
      return pageProjections(query)
    },

    async project(input) {
      return startProjection(input, 'project')
    },

    async reproject({ projectionId }) {
      return reprojectInternal(ctx, projectionId, 'project')
    },

    async remove({ projectionId, confirm }) {
      assertConfirm(confirm)
      return removeProjectionInternal(ctx, projectionId, 'project')
    },

    async rollback({ projectionId }) {
      return rollbackInternal(ctx, projectionId, 'project')
    },

    async overwriteDrift(input) {
      return overwriteDriftInternal(ctx, input, 'project')
    },

    globalList(query: GlobalProjectionQuery) {
      return pageProjections(query, 'global')
    },

    async globalProject(input) {
      return startProjection(input, 'global')
    },

    async globalReproject({ projectionId }) {
      return reprojectInternal(ctx, projectionId, 'global')
    },

    async globalRemove({ projectionId, confirm }) {
      assertConfirm(confirm)
      return removeProjectionInternal(ctx, projectionId, 'global')
    },

    async globalRollback({ projectionId }) {
      return rollbackInternal(ctx, projectionId, 'global')
    },

    async globalOverwriteDrift(input) {
      return overwriteDriftInternal(ctx, input, 'global')
    },

    async globalTargets() {
      seedGlobalTargets(ctx)
      const details: GlobalTargetDetail[] = []
      for (const def of GLOBAL_TARGET_DEFS) {
        const row = loadGlobalTargetRow(ctx, def.id)
        if (!row) continue
        details.push(await globalTargetDetail(ctx, def, row))
      }
      return details
    },

    async updateGlobalPath(input) {
      return updateGlobalPathInternal(ctx, input, null)
    },

    async restoreGlobalDefault({ targetId }) {
      return updateGlobalPathInternal(ctx, { targetId, path: '' }, targetId)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Single-item operations                                              */
/* ------------------------------------------------------------------ */

function targetDescriptorForRecord(
  ctx: AppContext,
  record: ProjectionRecord,
  model: ContractFileModel,
): TargetDescriptor {
  if (record.scope === 'project') {
    const target = projectTarget(record.targetId)
    if (!target) {
      throw new AppError('CORRUPT', 'The target for this projection no longer exists.')
    }
    const project = loadProject(ctx, record.projectId)
    if (!project) {
      // A removed project leaves the projection orphaned. Keep operating on the
      // recorded path so remove and rollback remain possible.
      return {
        id: target.id,
        label: target.label,
        compileTarget: compileTargetForProject(target),
        singleFile: target.merge === 'single-file',
        supports: target.supports,
        resolvePath: () => resolvePath(record.targetPath),
      }
    }
    return projectTargetDescriptor(target, project)
  }
  seedGlobalTargets(ctx)
  const row = loadGlobalTargetRow(ctx, record.targetId)
  const def = globalTargetDef(record.targetId)
  if (!row || !def) {
    throw new AppError('CORRUPT', 'The global target for this projection no longer exists.')
  }
  return globalTargetDescriptor(row, def)
}

/** Uses the recorded path, for orphaned projections that cannot re-resolve a root. */
function storedPathDescriptor(ctx: AppContext, record: ProjectionRecord): TargetDescriptor {
  if (record.scope === 'project') {
    const target = projectTarget(record.targetId)
    if (!target) {
      throw new AppError('CORRUPT', 'The target for this projection no longer exists.')
    }
    return {
      id: target.id,
      label: target.label,
      compileTarget: compileTargetForProject(target),
      singleFile: target.merge === 'single-file',
      supports: target.supports,
      resolvePath: () => resolvePath(record.targetPath),
    }
  }
  seedGlobalTargets(ctx)
  const row = loadGlobalTargetRow(ctx, record.targetId)
  const def = globalTargetDef(record.targetId)
  if (!row || !def) {
    throw new AppError('CORRUPT', 'The global target for this projection no longer exists.')
  }
  return {
    ...globalTargetDescriptor(row, def),
    resolvePath: () => resolvePath(record.targetPath),
  }
}

function driftConflict(record: ProjectionRecord, fileHash: string | null): AppError {
  return new AppError(
    'CONFLICT',
    'The target file was modified outside Prompt Keeper. Overwrite the drift explicitly before re-projecting.',
    {
      kind: 'projection-drift',
      projectionId: record.id,
      targetPath: record.targetPath,
      ...(fileHash ? { fileHash } : {}),
    },
  )
}

async function reprojectInternal(
  ctx: AppContext,
  projectionId: string,
  scope: 'project' | 'global',
): Promise<ProjectionDetail> {
  seedGlobalTargets(ctx)
  const record = loadProjectionRecord(ctx, projectionId)
  if (record.scope !== scope) {
    throw new AppError(
      'VALIDATION',
      scope === 'global'
        ? 'This projection belongs to a project target, not a global target.'
        : 'This projection belongs to a global target. Use the global projection flow.',
    )
  }
  if (!record.contractId) {
    throw new AppError('CONFLICT', 'The contract was deleted. This projection can only be removed or rolled back.')
  }
  const snapshot = loadContractSnapshot(ctx, record.contractId)
  if (!snapshot) {
    throw new AppError('CONFLICT', 'The contract was deleted. This projection can only be removed or rolled back.')
  }

  const classification = await classifyProjection(ctx, record, contractSlug(snapshot.model))
  persistStatus(ctx, record, classification, record.orphaned)
  if (classification.status === 'drifted') {
    throw driftConflict(record, await ctx.assets.fileHash(record.targetPath))
  }

  if (record.scope === 'project') {
    const project = loadProject(ctx, record.projectId)
    if (!project) {
      throw new AppError(
        'CONFLICT',
        'The project root for this projection was removed. Register it again before re-projecting, or remove the projection.',
      )
    }
    if (!existsSync(project.rootPath)) {
      throw new AppError(
        'CONFLICT',
        'The registered project root no longer exists on disk. Restore it or remove the projection.',
      )
    }
  }

  const descriptor = targetDescriptorForRecord(ctx, record, snapshot.model)
  const targetPath = descriptor.resolvePath(snapshot.model)

  if (!descriptor.singleFile) {
    const managedHere = resolvePath(record.targetPath) === targetPath
    if (!managedHere && (await pathExists(targetPath))) {
      throw new AppError(
        'CONFLICT',
        'A file that Prompt Keeper does not manage already exists at the new target path.',
      )
    }
  }

  let hashes: WriteHashes
  try {
    hashes = await writeProjectionFile(descriptor, snapshot.model, snapshot.sourcePath, targetPath)
  } catch (error) {
    if (error instanceof ManagedBlockStructureError) {
      persistStatus(ctx, record, { status: 'drifted', note: error.message }, record.orphaned)
      throw new AppError('CONFLICT', error.message, {
        kind: 'projection-drift',
        projectionId: record.id,
        targetPath,
      })
    }
    throw error
  }

  saveProjection(ctx, {
    contractId: record.contractId,
    model: snapshot.model,
    revision: snapshot.revision,
    scope,
    projectId: record.projectId,
    targetId: record.targetId,
    targetPath,
    hashes,
    existing: record,
  })
  ctx.audit.log({
    type: 'projection',
    result: 'success',
    title: `Re-projected "${snapshot.model.title}" to ${descriptor.label}`,
    assetId: record.contractId,
    targetId: record.targetId,
    detail: {
      scope,
      projectionId: record.id,
      targetPath,
      revisionId: snapshot.revision.id,
    },
  })
  ctx.events.domainChanged('projections', 'projected', [record.id])
  if (scope === 'global') ctx.events.domainChanged('globalTargets', 'projected', [record.targetId])

  return toDetail(loadProjectionView(ctx, record.id))
}

async function removeProjectionInternal(
  ctx: AppContext,
  projectionId: string,
  scope: 'project' | 'global',
): Promise<ProjectionRemoveResult> {
  seedGlobalTargets(ctx)
  const record = loadProjectionRecord(ctx, projectionId)
  if (record.scope !== scope) {
    throw new AppError(
      'VALIDATION',
      scope === 'global'
        ? 'This projection belongs to a project target, not a global target.'
        : 'This projection belongs to a global target. Use the global projection flow.',
    )
  }

  const singleFile = isSingleFileTarget(ctx, record)
  let removed = false
  let note: string | undefined

  if (singleFile) {
    const text = await readTextIfExists(record.targetPath)
    if (text === null) {
      note = 'The target file was already missing; only the projection record was removed.'
    } else {
      const parsed = parseManagedFile(text)
      if (!parsed.ok) {
        throw driftConflict(record, await ctx.assets.fileHash(record.targetPath))
      }
      const hasBlock = parsed.segments.some(
        (segment) => isBlockSegment(segment) && record.contractId !== null && segment.id === record.contractId,
      )
      if (!hasBlock) {
        note = 'The target file no longer contains a managed block for this contract.'
      } else {
        const merged = upsertManagedBlocks(text, [], record.contractId ? [record.contractId] : [], [])
        if (merged.error !== undefined) {
          throw driftConflict(record, await ctx.assets.fileHash(record.targetPath))
        }
        await writeAtomic(record.targetPath, merged.text)
        removed = true
      }
    }
  } else {
    if (await pathExists(record.targetPath)) {
      // A generated file is deleted only when it is still byte-identical to what
      // Prompt Keeper wrote; hand edits are never deleted implicitly.
      const currentHash = await ctx.assets.fileHash(record.targetPath)
      if (currentHash && record.fileHash && currentHash !== record.fileHash) {
        throw driftConflict(record, currentHash)
      }
      await removePath(record.targetPath)
      removed = true
    } else {
      note = 'The generated file was already missing; only the projection record was removed.'
    }
  }

  ctx.db.prepare('DELETE FROM projections WHERE id = ?').run(record.id)
  ctx.audit.log({
    type: 'projection',
    result: 'success',
    title: singleFile ? 'Removed a managed projection block' : 'Removed a generated projection file',
    ...(record.contractId ? { assetId: record.contractId } : {}),
    targetId: record.targetId,
    detail: {
      projectionId: record.id,
      scope,
      targetPath: record.targetPath,
      removed,
      note: note ?? null,
    },
  })
  ctx.events.domainChanged('projections', 'deleted', [record.id])
  if (scope === 'global') ctx.events.domainChanged('globalTargets', 'updated', [record.targetId])

  return {
    projectionId: record.id,
    removed,
    targetPath: record.targetPath,
    ...(note ? { note } : {}),
  }
}

async function rollbackInternal(
  ctx: AppContext,
  projectionId: string,
  scope: 'project' | 'global',
): Promise<ProjectionDetail> {
  seedGlobalTargets(ctx)
  const record = loadProjectionRecord(ctx, projectionId)
  if (record.scope !== scope) {
    throw new AppError(
      'VALIDATION',
      scope === 'global'
        ? 'This projection belongs to a project target, not a global target.'
        : 'This projection belongs to a global target. Use the global projection flow.',
    )
  }
  if (!record.contractId) {
    throw new AppError('CONFLICT', 'The contract content was deleted, so there is nothing to roll back.')
  }
  if (!record.previousRevisionId) {
    throw new AppError('CONFLICT', 'There is no previous version to roll back to.')
  }

  const previousModel = await loadContractModelAtRevision(
    ctx,
    record.contractId,
    record.previousRevisionId,
  )
  if (!previousModel) {
    throw new AppError('CORRUPT', 'The previous version content cannot be read.')
  }
  const snapshot = loadContractSnapshot(ctx, record.contractId)
  const project = record.scope === 'project' ? loadProject(ctx, record.projectId) : null
  if (record.scope === 'project' && project && !existsSync(project.rootPath)) {
    throw new AppError(
      'CONFLICT',
      'The registered project root no longer exists on disk. Restore it or remove the projection.',
    )
  }
  const orphanedPath = !snapshot || (record.scope === 'project' && !project)
  const pathModel = snapshot?.model ?? previousModel
  const slugForClassification = snapshot
    ? contractSlug(snapshot.model)
    : (record.contractSlug ?? contractSlug(previousModel))

  const classification = await classifyProjection(ctx, record, slugForClassification)
  persistStatus(ctx, record, classification, record.orphaned)
  if (classification.status === 'drifted') {
    throw driftConflict(record, await ctx.assets.fileHash(record.targetPath))
  }

  const descriptor = orphanedPath
    ? storedPathDescriptor(ctx, record)
    : targetDescriptorForRecord(ctx, record, pathModel)
  const targetPath = orphanedPath ? resolvePath(record.targetPath) : descriptor.resolvePath(pathModel)
  let hashes: WriteHashes
  try {
    hashes = await writeProjectionFile(descriptor, previousModel, contractRepoPath(previousModel), targetPath)
  } catch (error) {
    if (error instanceof ManagedBlockStructureError) {
      persistStatus(ctx, record, { status: 'drifted', note: error.message }, record.orphaned)
      throw new AppError('CONFLICT', error.message, {
        kind: 'projection-drift',
        projectionId: record.id,
        targetPath,
      })
    }
    throw error
  }

  const previousRevision = ctx.assets.getRevision(record.previousRevisionId)
  const previousVersion = previousRevision.version
  const at = nowIso()
  ctx.db
    .prepare(
      `UPDATE projections SET
         contract_title = ?, contract_slug = ?, target_path = ?, status = 'synced',
         deployed_revision_id = ?, previous_revision_id = ?, file_hash = ?, outside_hash = ?,
         block_hash = ?, deployed_at = ?, note = ?, orphaned = ?
       WHERE id = ?`,
    )
    .run(
      pathModel.title,
      contractSlug(pathModel),
      targetPath,
      record.previousRevisionId,
      record.deployedRevisionId,
      hashes.fileHash,
      hashes.outsideHash,
      hashes.blockHash,
      at,
      `Rolled back to version ${previousVersion}.`,
      orphanedPath ? 1 : 0,
      record.id,
    )

  ctx.audit.log({
    type: 'rollback',
    result: 'success',
    title: `Rolled back "${pathModel.title}" to version ${previousVersion}`,
    ...(record.contractId ? { assetId: record.contractId } : {}),
    targetId: record.targetId,
    detail: {
      projectionId: record.id,
      scope,
      targetPath,
      restoredRevisionId: record.previousRevisionId,
      replacedRevisionId: record.deployedRevisionId,
      orphaned: orphanedPath,
    },
  })
  ctx.events.domainChanged('projections', 'restored', [record.id])
  if (scope === 'global') ctx.events.domainChanged('globalTargets', 'updated', [record.targetId])

  return toDetail(loadProjectionView(ctx, record.id))
}

async function overwriteDriftInternal(
  ctx: AppContext,
  input: ProjectionOverwriteDriftInput,
  scope: 'project' | 'global',
): Promise<ProjectionDetail> {
  assertConfirm(input.confirm)
  seedGlobalTargets(ctx)
  const record = loadProjectionRecord(ctx, input.projectionId)
  if (record.scope !== scope) {
    throw new AppError(
      'VALIDATION',
      scope === 'global'
        ? 'This projection belongs to a project target, not a global target.'
        : 'This projection belongs to a global target. Use the global projection flow.',
    )
  }
  if (!record.contractId) {
    throw new AppError('CONFLICT', 'The contract was deleted. This projection cannot be regenerated.')
  }
  const snapshot = loadContractSnapshot(ctx, record.contractId)
  if (!snapshot) {
    throw new AppError('CONFLICT', 'The contract was deleted. This projection cannot be regenerated.')
  }
  if (record.scope === 'project') {
    const project = loadProject(ctx, record.projectId)
    if (!project) {
      throw new AppError(
        'CONFLICT',
        'The project root for this projection was removed. This projection can only be removed or rolled back.',
      )
    }
    if (!existsSync(project.rootPath)) {
      throw new AppError(
        'CONFLICT',
        'The registered project root no longer exists on disk. Restore it or remove the projection.',
      )
    }
  }
  const expectedPath = expectedProjectionPath(ctx, record, contractSlug(snapshot.model))
  if (expectedPath && expectedPath !== resolvePath(record.targetPath)) {
    throw new AppError(
      'CONFLICT',
      'The target path changed. Re-project this item instead of overwriting drift.',
    )
  }

  const currentHash = await ctx.assets.fileHash(record.targetPath)
  if (currentHash && currentHash !== input.expectedFileHash) {
    throw new AppError(
      'CONFLICT',
      'The target file changed after the confirmation dialog opened. Review the current file and try again.',
      {
        kind: 'projection-drift',
        projectionId: record.id,
        targetPath: record.targetPath,
        fileHash: currentHash,
      },
    )
  }

  const descriptor = targetDescriptorForRecord(ctx, record, snapshot.model)
  let hashes: WriteHashes
  try {
    hashes = await writeProjectionFile(descriptor, snapshot.model, snapshot.sourcePath, record.targetPath)
  } catch (error) {
    if (error instanceof ManagedBlockStructureError) {
      throw new AppError('CONFLICT', error.message, {
        kind: 'projection-drift',
        projectionId: record.id,
        targetPath: record.targetPath,
      })
    }
    throw error
  }

  const at = nowIso()
  const previousRevisionId =
    record.deployedRevisionId && record.deployedRevisionId !== snapshot.revision.id
      ? record.deployedRevisionId
      : record.previousRevisionId
  ctx.db
    .prepare(
      `UPDATE projections SET
         contract_title = ?, contract_slug = ?, target_path = ?, status = 'synced',
         deployed_revision_id = ?, previous_revision_id = ?, file_hash = ?, outside_hash = ?,
         block_hash = ?, deployed_at = ?, note = NULL, orphaned = 0
       WHERE id = ?`,
    )
    .run(
      snapshot.model.title,
      contractSlug(snapshot.model),
      record.targetPath,
      snapshot.revision.id,
      previousRevisionId,
      hashes.fileHash,
      hashes.outsideHash,
      hashes.blockHash,
      at,
      record.id,
    )

  ctx.audit.log({
    type: 'projection',
    result: 'warning',
    title: `Overwrote drift for "${snapshot.model.title}" on ${descriptor.label}`,
    assetId: record.contractId,
    targetId: record.targetId,
    detail: {
      projectionId: record.id,
      scope,
      targetPath: record.targetPath,
      revisionId: snapshot.revision.id,
      previousFileHash: currentHash,
    },
  })
  ctx.events.domainChanged('projections', 'reconciled', [record.id])
  if (scope === 'global') ctx.events.domainChanged('globalTargets', 'updated', [record.targetId])

  return toDetail(loadProjectionView(ctx, record.id))
}

/* ------------------------------------------------------------------ */
/* Global target configuration                                         */
/* ------------------------------------------------------------------ */

async function globalTargetDetail(
  ctx: AppContext,
  def: GlobalTargetDef,
  row: GlobalTargetRow,
): Promise<GlobalTargetDetail> {
  let exists = false
  let detected = false
  try {
    const expanded = expandGlobalPath(row.path)
    exists = await pathExists(expanded)
    const parentExists = await pathExists(dirname(expanded))
    detected = exists || parentExists
  } catch {
    exists = false
    detected = false
  }

  const counts = ctx.db
    .prepare(
      "SELECT status, COUNT(*) AS count FROM projections WHERE target_id = ? AND scope = 'global' GROUP BY status",
    )
    .all(def.id) as Array<{ status: string; count: number }>
  let projectionCount = 0
  let staleCount = 0
  let driftedCount = 0
  for (const entry of counts) {
    projectionCount += entry.count
    if (entry.status === 'stale') staleCount = entry.count
    if (entry.status === 'drifted') driftedCount = entry.count
  }

  return {
    id: def.id,
    agentId: def.agentId,
    agentName: def.agentName,
    label: def.label,
    description: def.description,
    pathMode: def.pathMode,
    defaultPath: row.defaultPath,
    path: row.path,
    format: def.format,
    merge: def.merge,
    ...(row.fileExt ? { fileExt: row.fileExt } : def.fileExt ? { fileExt: def.fileExt } : {}),
    supports: def.supports,
    ...(row.maxBytes !== null ? { maxBytes: row.maxBytes } : {}),
    note: def.note,
    exists,
    detected,
    projectionCount,
    staleCount,
    driftedCount,
    updatedAt: row.updatedAt,
  }
}

async function updateGlobalPathInternal(
  ctx: AppContext,
  input: GlobalTargetUpdateInput,
  restoreTargetId: string | null,
): Promise<GlobalTargetUpdateResult> {
  seedGlobalTargets(ctx)
  const targetId = restoreTargetId ?? (typeof input.targetId === 'string' ? input.targetId : '')
  if (!targetId) throw new AppError('VALIDATION', 'A global target ID is required.')
  const row = loadGlobalTargetRow(ctx, targetId)
  if (!row) throw new AppError('NOT_FOUND', 'This global target no longer exists.')
  if (
    typeof input.expectedUpdatedAt === 'string' &&
    input.expectedUpdatedAt &&
    input.expectedUpdatedAt !== row.updatedAt
  ) {
    throw new AppError('CONFLICT', 'This global target changed after the dialog opened. Reload and try again.')
  }

  const nextPath =
    restoreTargetId !== null
      ? validateGlobalPath(row.defaultPath)
      : validateGlobalPath(typeof input.path === 'string' ? input.path : '')
  const at = nowIso()
  ctx.db
    .prepare('UPDATE global_targets SET path = ?, updated_at = ? WHERE id = ?')
    .run(nextPath, at, targetId)

  const projections = ctx.db
    .prepare("SELECT id, status FROM projections WHERE target_id = ? AND scope = 'global'")
    .all(targetId) as Array<{ id: string; status: ProjectionStatus }>
  let markedStale = 0
  let driftedNotChanged = 0
  const changedIds: string[] = []
  const note = 'The global target path changed; re-projection is pending.'
  const update = ctx.db.prepare(
    "UPDATE projections SET status = 'stale', note = ? WHERE id = ?",
  )
  for (const projection of projections) {
    if (projection.status === 'drifted') {
      driftedNotChanged++
      continue
    }
    update.run(note, projection.id)
    markedStale++
    changedIds.push(projection.id)
  }

  const def = globalTargetDef(targetId)
  if (!def) throw new AppError('CORRUPT', 'The global target definition is missing.')
  const updatedRow = loadGlobalTargetRow(ctx, targetId)
  if (!updatedRow) throw new AppError('CORRUPT', 'The global target row is missing.')

  ctx.audit.log({
    type: 'projection',
    result: 'success',
    title: restoreTargetId ? `Restored the default path for ${def.label}` : `Updated the path for ${def.label}`,
    targetId,
    detail: {
      path: nextPath,
      previousPath: row.path,
      markedStale,
      driftedNotChanged,
    },
  })
  ctx.events.domainChanged('globalTargets', 'updated', [targetId])
  if (changedIds.length) ctx.events.domainChanged('projections', 'updated', changedIds)

  return {
    target: await globalTargetDetail(ctx, def, updatedRow),
    markedStale,
    driftedNotChanged,
  }
}

/* ------------------------------------------------------------------ */
/* Filesystem helpers                                                  */
/* ------------------------------------------------------------------ */

async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

