/**
 * Dispatch engine.
 *
 * Skills are installed into Agent directories by symlink (default) or copy.
 * MCP servers are applied by the MCP service; this engine computes their status
 * and owns the Skill install, remove, rollback, and stale-sync lifecycles.
 *
 * Skill scripts are never executed. Symlink failures are reported, never
 * silently downgraded to copy.
 */

import { readdir, lstat, readFile, readlink, realpath, rename, rmdir, symlink, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import type {
  DispatchAgent,
  DispatchBatchResult,
  DispatchCell,
  DispatchDetail,
  DispatchInstallInput,
  DispatchInstallResult,
  DispatchMatrix,
  DispatchMatrixQuery,
  DispatchOperationResult,
  DispatchOperationSummary,
  DispatchPreview,
  DispatchResultItem,
  DispatchRollbackInput,
  DispatchRemoveInput,
  DispatchStatus,
  DispatchSyncStaleInput,
  IpcErrorPayload,
  OperationRef,
  SyncRisk,
} from '../../shared/contracts'
import type { InstallMode, SkillFileEntry } from '../../shared/contracts'
import { AppError, isAppError } from '../../shared/domain/errors'
import { folderInScope, isPathInside, safePathSegment } from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import {
  canonicalManifestJson,
  isScriptFile,
  isTextFile,
  toSkillFiles,
  type ManifestFile,
} from '../../shared/domain/manifest'
import { scanFiles } from '../../shared/domain/scanner'
import { AGENT_DEFS, type AgentDef } from '../../shared/domain/targets'
import {
  ensureDir,
  isSymlink,
  listFilesRecursive,
  pathExists,
  readTextIfExists,
  removeIfExists,
  writeAtomic,
} from '../adapters/fs'
import { sha256Hex } from '../adapters/hash'
import type { AppContext } from '../context'
import { expandUserPath } from '../paths'
import type { AssetRecord, RevisionRecord } from './assetStore'
import type { OperationContext } from '../operations'
import type { DispatchService } from './types'

/* ------------------------------------------------------------------ */
/* Row models                                                          */
/* ------------------------------------------------------------------ */

interface AgentRow {
  id: string
  name: string
  detected: boolean
  skillDir: string | null
  mcpFile: string | null
  supportsSkills: boolean
  supportsMcp: boolean
}

interface DeploymentRow {
  id: string
  assetId: string
  assetKind: 'skill' | 'mcp'
  agentId: string
  mode: InstallMode
  status: DispatchStatus
  targetPath: string
  deployedRevisionId: string | null
  previousRevisionId: string | null
  manifestHash: string
  managedKeysJson: string
  deployedAt: string
  note: string | null
}

interface MatrixAsset {
  asset: AssetRecord
  revision: RevisionRecord
  kind: 'skill' | 'mcp'
}

interface HashCache {
  library: Map<string, Promise<string | null>>
}

interface InstallPlanTarget {
  agent: AgentRow
  targetPath: string
  action: 'create' | 'replace' | 'noop'
  conflict: 'none' | 'external' | 'drifted'
  warnings: string[]
}

interface PreviewCore {
  assetId: string
  agentIds: string[]
  mode: InstallMode
  revisionId: string
  manifestHash: string
  targets: Array<{
    agentId: string
    targetPath: string
    action: 'create' | 'replace' | 'noop'
    conflict: 'none' | 'external' | 'drifted'
  }>
}

interface InstallPreview {
  preview: DispatchPreview
  core: PreviewCore
  token: string
  asset: AssetRecord
  revision: RevisionRecord
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function uniq(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function emptySummary(): DispatchOperationSummary {
  return {
    installed: 0,
    replaced: 0,
    removed: 0,
    rolledBack: 0,
    skippedDrifted: 0,
    failed: 0,
  }
}

function toIpcError(error: unknown): IpcErrorPayload {
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

function errorCode(error: unknown): IpcErrorPayload['code'] {
  return toIpcError(error).code
}

function errorMessage(error: unknown): string {
  return toIpcError(error).message
}

function assertConfirm(confirm: boolean): void {
  if (confirm !== true) {
    throw new AppError('VALIDATION', 'This action requires explicit confirmation.')
  }
}

function symlinkType(platform: AppContext['platform']): 'junction' | 'dir' {
  return platform === 'win32' ? 'junction' : 'dir'
}

function installName(asset: AssetRecord): string {
  return safePathSegment(asset.slug || asset.title, asset.id)
}

function toDispatchAgent(row: AgentRow): DispatchAgent {
  return {
    id: row.id,
    name: row.name,
    detected: row.detected,
    supportsSkills: row.supportsSkills,
    supportsMcp: row.supportsMcp,
    ...(row.skillDir ? { skillDir: row.skillDir } : {}),
    ...(row.mcpFile ? { mcpFile: row.mcpFile } : {}),
  }
}

function managedKeys(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const keys: string[] = []
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry) {
        keys.push(entry)
        continue
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>
        const candidate = record.key ?? record.serverName ?? record.name ?? record.targetKey
        if (typeof candidate === 'string' && candidate) keys.push(candidate)
      }
    }
    return keys
  } catch {
    return []
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Best-effort presence check across JSON, JSONC, and TOML containers. */
function configContainsKey(text: string, key: string): boolean {
  const escaped = escapeRegExp(key)
  const pattern = new RegExp(`(?:["']?${escaped}["']?\\s*[:=]|\\.${escaped}\\s*\\])`)
  return pattern.test(text)
}

async function realpathSafe(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

function stripLongPathPrefix(path: string): string {
  return path.replace(/^\\\\\?\\/, '')
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** Absolute destination of a symlink or junction, without following it. */
async function symlinkDestination(path: string): Promise<string | null> {
  try {
    const raw = await readlink(path)
    return resolvePath(stripLongPathPrefix(raw))
  } catch {
    return null
  }
}

async function isInsideLibrary(ctx: AppContext, resolved: string): Promise<boolean> {
  const candidate = resolvePath(stripLongPathPrefix(resolved))
  if (isPathInside(ctx.paths.library, candidate)) return true
  const root = await realpathSafe(ctx.paths.library)
  return !!root && isPathInside(root, candidate)
}

/* ------------------------------------------------------------------ */
/* Agent registry and detection                                        */
/* ------------------------------------------------------------------ */

async function detectAgentPaths(
  ctx: AppContext,
  def: AgentDef,
): Promise<{ detected: boolean; skillDir: string | null; mcpFile: string | null }> {
  const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
  const skillDir = paths.skillDir ? resolvePath(expandUserPath(paths.skillDir)) : null
  const mcpFile = paths.mcpFile ? resolvePath(expandUserPath(paths.mcpFile)) : null

  const skillDetected = skillDir ? await pathExists(skillDir) : false
  const fileDetected = mcpFile ? await pathExists(mcpFile) : false
  let parentDetected = false
  if (mcpFile) {
    const parent = dirname(mcpFile)
    // `~/.claude.json` lives directly in the home directory; home existence
    // says nothing about whether the Agent is installed.
    parentDetected = parent !== resolvePath(homedir()) && (await pathExists(parent))
  }

  return {
    detected: skillDetected || fileDetected || parentDetected,
    skillDir,
    mcpFile,
  }
}

async function ensureAgents(ctx: AppContext): Promise<AgentRow[]> {
  const statement = ctx.db.prepare(
    `INSERT INTO agents
       (id, name, detected, detected_at, skill_dir, mcp_file, supports_skills, supports_mcp, config_format)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       detected = excluded.detected,
       detected_at = excluded.detected_at,
       skill_dir = excluded.skill_dir,
       mcp_file = excluded.mcp_file,
       supports_skills = excluded.supports_skills,
       supports_mcp = excluded.supports_mcp,
       config_format = excluded.config_format`,
  )

  for (const def of AGENT_DEFS) {
    const detected = await detectAgentPaths(ctx, def)
    const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
    statement.run(
      def.id,
      def.name,
      detected.detected ? 1 : 0,
      detected.detected ? nowIso() : null,
      detected.skillDir,
      detected.mcpFile,
      def.supportsSkills ? 1 : 0,
      def.supportsMcp ? 1 : 0,
      paths.mcpFormat ?? 'json',
    )
  }

  return loadAgentRows(ctx)
}

function loadAgentRows(ctx: AppContext): AgentRow[] {
  const rows = ctx.db.prepare('SELECT * FROM agents ORDER BY name').all() as Array<
    Record<string, unknown>
  >
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    detected: !!row.detected,
    skillDir: (row.skill_dir as string | null) ?? null,
    mcpFile: (row.mcp_file as string | null) ?? null,
    supportsSkills: !!row.supports_skills,
    supportsMcp: !!row.supports_mcp,
  }))
}

/* ------------------------------------------------------------------ */
/* Deployment records                                                  */
/* ------------------------------------------------------------------ */

function mapDeployment(row: Record<string, unknown>): DeploymentRow {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    assetKind: row.asset_kind as 'skill' | 'mcp',
    agentId: row.agent_id as string,
    mode: row.mode as InstallMode,
    status: row.status as DispatchStatus,
    targetPath: row.target_path as string,
    deployedRevisionId: (row.deployed_revision_id as string | null) ?? null,
    previousRevisionId: (row.previous_revision_id as string | null) ?? null,
    manifestHash: row.manifest_hash as string,
    managedKeysJson: (row.managed_keys_json as string) ?? '[]',
    deployedAt: row.deployed_at as string,
    note: (row.note as string | null) ?? null,
  }
}

function loadDeployments(ctx: AppContext, assetId: string): Map<string, DeploymentRow> {
  const rows = ctx.db.prepare('SELECT * FROM deployments WHERE asset_id = ?').all(assetId) as Array<
    Record<string, unknown>
  >
  return new Map(rows.map((row) => [row.agent_id as string, mapDeployment(row)]))
}

function revisionVersion(ctx: AppContext, revisionId: string | null): number | undefined {
  if (!revisionId) return undefined
  const row = ctx.db.prepare('SELECT version FROM asset_revisions WHERE id = ?').get(revisionId) as
    | { version: number }
    | undefined
  return row?.version
}

function recordDeployment(
  ctx: AppContext,
  asset: AssetRecord,
  agentId: string,
  mode: InstallMode,
  targetPath: string,
  revision: RevisionRecord,
  note: string,
  existing: DeploymentRow | null,
): void {
  const at = nowIso()
  const previousRevisionId =
    existing && existing.deployedRevisionId !== revision.id
      ? existing.deployedRevisionId
      : (existing?.previousRevisionId ?? null)

  if (existing) {
    ctx.db
      .prepare(
        `UPDATE deployments SET
           mode = ?, status = 'synced', target_path = ?, deployed_revision_id = ?,
           previous_revision_id = ?, manifest_hash = ?, managed_keys_json = '[]',
           deployed_at = ?, note = ?
         WHERE id = ?`,
      )
      .run(
        mode,
        targetPath,
        revision.id,
        previousRevisionId,
        revision.manifestHash,
        at,
        note,
        existing.id,
      )
    return
  }

  ctx.db
    .prepare(
      `INSERT INTO deployments
         (id, asset_id, asset_kind, agent_id, mode, status, target_path, deployed_revision_id,
          previous_revision_id, manifest_hash, managed_keys_json, deployed_at, note)
       VALUES (?, ?, 'skill', ?, ?, 'synced', ?, ?, NULL, ?, '[]', ?, ?)`,
    )
    .run(
      newId('dep'),
      asset.id,
      agentId,
      mode,
      targetPath,
      revision.id,
      revision.manifestHash,
      at,
      note,
    )
}

/* ------------------------------------------------------------------ */
/* Content hashing                                                     */
/* ------------------------------------------------------------------ */

async function hashDirectoryTree(path: string): Promise<string | null> {
  const entries = await listFilesRecursive(path, { rejectSymlinks: true }).catch(() => null)
  if (!entries) return null
  const files: ManifestFile[] = []
  for (const entry of entries) {
    const content = await readFile(join(path, ...entry.path.split('/'))).catch(() => null)
    if (!content) return null
    files.push({
      path: entry.path,
      blobHash: sha256Hex(content),
      size: content.length,
      mediaKind: isTextFile(entry.path) ? 'text' : 'binary',
      isExecutable: entry.isExecutable,
    })
  }
  return sha256Hex(canonicalManifestJson(files))
}

function libraryHashFor(
  ctx: AppContext,
  assetId: string,
  cache: HashCache,
): Promise<string | null> {
  const existing = cache.library.get(assetId)
  if (existing) return existing
  const pending = hashDirectoryTree(ctx.assets.libraryDir(assetId))
  cache.library.set(assetId, pending)
  return pending
}

/* ------------------------------------------------------------------ */
/* Cell computation                                                    */
/* ------------------------------------------------------------------ */

async function skillCell(
  ctx: AppContext,
  asset: AssetRecord,
  revision: RevisionRecord,
  agent: AgentRow,
  deployment: DeploymentRow | null,
  cache: HashCache,
): Promise<DispatchCell> {
  const expectedPath = agent.skillDir ? join(agent.skillDir, installName(asset)) : undefined
  if (!agent.supportsSkills) {
    return {
      assetId: asset.id,
      agentId: agent.id,
      status: 'unsupported',
      note: `${agent.name} does not support Skills.`,
    }
  }
  if (!deployment) {
    return {
      assetId: asset.id,
      agentId: agent.id,
      status: 'missing',
      ...(expectedPath ? { targetPath: expectedPath } : {}),
      note: 'Not installed for this Agent.',
    }
  }

  const base: DispatchCell = {
    assetId: asset.id,
    agentId: agent.id,
    status: 'synced',
    deploymentId: deployment.id,
    targetPath: deployment.targetPath,
    mode: deployment.mode,
    ...(revisionVersion(ctx, deployment.deployedRevisionId) !== undefined
      ? { deployedVersion: revisionVersion(ctx, deployment.deployedRevisionId) }
      : {}),
    deployedAt: deployment.deployedAt,
  }

  if (deployment.mode === 'symlink') {
    if (!(await pathExists(deployment.targetPath))) {
      return { ...base, status: 'missing', note: 'The install directory is missing.' }
    }
    if (!(await isSymlink(deployment.targetPath))) {
      return {
        ...base,
        status: 'drifted',
        note: 'The install path is no longer a symlink managed by Prompt Keeper.',
      }
    }
    const linkedReal = await realpathSafe(deployment.targetPath)
    if (!linkedReal || !(await isInsideLibrary(ctx, linkedReal))) {
      return {
        ...base,
        status: 'drifted',
        note: 'The symlink does not point into the Prompt Keeper library.',
      }
    }
    const linkedHash = await hashDirectoryTree(deployment.targetPath)
    if (!linkedHash) {
      return { ...base, status: 'drifted', note: 'The linked Skill directory cannot be read.' }
    }
    if (linkedHash === revision.manifestHash) {
      return deployment.deployedRevisionId === revision.id
        ? { ...base, status: 'synced', note: undefined }
        : { ...base, status: 'stale', note: 'A newer Skill version exists.' }
    }
    if (linkedHash === deployment.manifestHash) {
      return {
        ...base,
        status: 'stale',
        note: 'The linked content is an older version than the current Skill.',
      }
    }
    return {
      ...base,
      status: 'drifted',
      note: 'The linked Skill content was changed outside Prompt Keeper.',
    }
  }

  if (!(await pathExists(deployment.targetPath))) {
    return { ...base, status: 'missing', note: 'The install directory is missing.' }
  }
  if (await isSymlink(deployment.targetPath)) {
    return {
      ...base,
      status: 'drifted',
      note: 'The install path is a symlink, not the copy Prompt Keeper recorded.',
    }
  }
  const copiedHash = await hashDirectoryTree(deployment.targetPath)
  if (!copiedHash) {
    return {
      ...base,
      status: 'drifted',
      note: 'The install directory contains a symlink or cannot be read.',
    }
  }
  if (copiedHash !== deployment.manifestHash) {
    return {
      ...base,
      status: 'drifted',
      note: 'The installed files were changed outside Prompt Keeper.',
    }
  }
  return deployment.deployedRevisionId === revision.id
    ? { ...base, status: 'synced' }
    : { ...base, status: 'stale', note: 'A newer Skill version exists.' }
}

async function mcpCell(
  ctx: AppContext,
  asset: AssetRecord,
  revision: RevisionRecord,
  agent: AgentRow,
  deployment: DeploymentRow | null,
): Promise<DispatchCell> {
  const disabled = !mcpEnabled(ctx, asset.id)
  const disabledNote = disabled
    ? 'This server is disabled; it cannot be dispatched or re-synced.'
    : undefined

  const finish = (cell: DispatchCell): DispatchCell => {
    if (!disabled) return cell
    return { ...cell, note: cell.note ? `${cell.note} ${disabledNote}` : disabledNote }
  }

  if (!agent.supportsMcp) {
    return finish({
      assetId: asset.id,
      agentId: agent.id,
      status: 'unsupported',
      note: `${agent.name} does not support MCP servers.`,
    })
  }
  if (!deployment) {
    return finish({
      assetId: asset.id,
      agentId: agent.id,
      status: 'missing',
      ...(agent.mcpFile ? { targetPath: agent.mcpFile } : {}),
      note: 'Not applied to this Agent.',
    })
  }

  const base: DispatchCell = {
    assetId: asset.id,
    agentId: agent.id,
    status: 'synced',
    deploymentId: deployment.id,
    targetPath: deployment.targetPath,
    deployedVersion: revisionVersion(ctx, deployment.deployedRevisionId),
    deployedAt: deployment.deployedAt,
  }

  if (!(await pathExists(deployment.targetPath))) {
    return finish({ ...base, status: 'missing', note: 'The Agent configuration file is missing.' })
  }

  const keys = managedKeys(deployment.managedKeysJson)
  if (keys.length) {
    const text = await readTextIfExists(deployment.targetPath)
    if (text !== null) {
      const missingKey = keys.find((key) => !configContainsKey(text, key))
      if (missingKey) {
        return finish({
          ...base,
          status: 'drifted',
          note: `The managed entry "${missingKey}" is no longer present in the Agent configuration.`,
        })
      }
    }
  }

  return finish(
    deployment.deployedRevisionId === revision.id
      ? { ...base, status: 'synced' }
      : { ...base, status: 'stale', note: 'A newer MCP server revision exists.' },
  )
}

function mcpEnabled(ctx: AppContext, assetId: string): boolean {
  const row = ctx.db.prepare('SELECT enabled FROM mcp_servers WHERE asset_id = ?').get(assetId) as
    | { enabled: number }
    | undefined
  return row ? !!row.enabled : true
}

async function computeCell(
  ctx: AppContext,
  entry: MatrixAsset,
  agent: AgentRow,
  deployment: DeploymentRow | null,
  cache: HashCache,
): Promise<DispatchCell> {
  const cell =
    entry.kind === 'skill'
      ? await skillCell(ctx, entry.asset, entry.revision, agent, deployment, cache)
      : await mcpCell(ctx, entry.asset, entry.revision, agent, deployment)
  // Reconciliation updates the record without touching files, so other views
  // that read deployments.status see the same status as the dispatch matrix.
  if (
    entry.kind === 'skill' &&
    deployment &&
    cell.status !== 'unsupported' &&
    deployment.status !== cell.status
  ) {
    ctx.db.prepare('UPDATE deployments SET status = ? WHERE id = ?').run(cell.status, deployment.id)
    deployment.status = cell.status
  }
  return cell
}

/* ------------------------------------------------------------------ */
/* Asset loading                                                       */
/* ------------------------------------------------------------------ */

function loadDispatchAssets(ctx: AppContext, kinds: Array<'skill' | 'mcp'>, folder: string | undefined): MatrixAsset[] {
  const placeholders = kinds.map(() => '?').join(', ')
  const rows = ctx.db
    .prepare(
      `SELECT id, kind FROM assets WHERE deleted_at IS NULL AND kind IN (${placeholders}) ORDER BY title`,
    )
    .all(...kinds) as Array<{ id: string; kind: 'skill' | 'mcp' }>
  const out: MatrixAsset[] = []
  for (const row of rows) {
    const asset = ctx.assets.getAsset(row.id)
    if (folder && !folderInScope(asset.folder, folder, true)) continue
    const revision = ctx.assets.currentRevisionOrNull(asset.id)
    if (!revision) continue
    out.push({ asset, revision, kind: row.kind })
  }
  return out
}

function loadDeploymentMap(ctx: AppContext, assets: MatrixAsset[]): Map<string, DeploymentRow> {
  const map = new Map<string, DeploymentRow>()
  if (!assets.length) return map
  const placeholders = assets.map(() => '?').join(', ')
  const rows = ctx.db
    .prepare(`SELECT * FROM deployments WHERE asset_id IN (${placeholders})`)
    .all(...assets.map((entry) => entry.asset.id)) as Array<Record<string, unknown>>
  for (const row of rows) {
    const deployment = mapDeployment(row)
    map.set(`${deployment.assetId}|${deployment.agentId}`, deployment)
  }
  return map
}

/* ------------------------------------------------------------------ */
/* Install planning                                                    */
/* ------------------------------------------------------------------ */

async function skillRiskContribution(ctx: AppContext, revision: RevisionRecord): Promise<SyncRisk[]> {
  const contents: Array<{ path: string; content: string }> = []
  const files = ctx.assets.revisionFiles(revision.id)
  for (const file of files) {
    if (file.mediaKind !== 'text') continue
    try {
      contents.push({ path: file.path, content: (await ctx.blobs.read(file.blobHash)).toString('utf8') })
    } catch {
      // A blob failure is reported when the install reads it.
    }
  }
  const risk: SyncRisk[] = []
  if (files.some((file) => isScriptFile(file.path)) || contents.some((entry) => isScriptFile(entry.path, entry.content))) {
    risk.push('scripts')
  }
  if (scanFiles(contents, '{{variable}}').some((finding) => finding.confidence === 'high')) {
    risk.push('secrets')
  }
  return risk
}

function previewTokenFor(core: PreviewCore): string {
  return `dsp_${sha256Hex(JSON.stringify(core)).slice(0, 40)}`
}

async function planInstallTarget(
  ctx: AppContext,
  asset: AssetRecord,
  revision: RevisionRecord,
  agent: AgentRow,
  mode: InstallMode,
  deployment: DeploymentRow | null,
  cache: HashCache,
): Promise<InstallPlanTarget> {
  const warnings: string[] = []
  if (!agent.supportsSkills) {
    return {
      agent,
      targetPath: '',
      action: 'noop',
      conflict: 'none',
      warnings: [`${agent.name} does not support Skills.`],
    }
  }
  if (!agent.skillDir) {
    return {
      agent,
      targetPath: '',
      action: 'noop',
      conflict: 'none',
      warnings: [`${agent.name} has no Skill directory on this platform.`],
    }
  }

  if (!agent.detected) {
    warnings.push(`${agent.name} was not detected on this machine; installing creates its Skill directory.`)
  }
  const targetPath = deployment ? deployment.targetPath : join(agent.skillDir, installName(asset))
  const cellStatus = deployment
    ? (await computeCell(ctx, { asset, revision, kind: 'skill' }, agent, deployment, cache)).status
    : 'missing'

  const info = await lstat(targetPath).catch(() => null)
  if (!info) {
    return { agent, targetPath, action: 'create', conflict: 'none', warnings }
  }

  if (info.isSymbolicLink()) {
    const destination = await symlinkDestination(targetPath)
    const libraryDir = resolvePath(stripLongPathPrefix(ctx.assets.libraryDir(asset.id)))
    const pointsAtLibrary =
      !!destination && resolvePath(stripLongPathPrefix(destination)) === libraryDir
    const insideLibrary =
      !!destination &&
      isPathInside(resolvePath(ctx.paths.library), resolvePath(stripLongPathPrefix(destination)))
    if (mode === 'symlink') {
      if (pointsAtLibrary && (cellStatus === 'synced' || cellStatus === 'stale')) {
        return { agent, targetPath, action: 'noop', conflict: 'none', warnings }
      }
      if (insideLibrary) {
        warnings.push('The link points at a managed Skill copy and will be pointed at the current library version.')
        return { agent, targetPath, action: 'replace', conflict: 'none', warnings }
      }
      warnings.push('The existing symlink is not managed by Prompt Keeper.')
      return { agent, targetPath, action: 'replace', conflict: 'external', warnings }
    }
    if (insideLibrary) {
      warnings.push('Switching this install from symlink to copy mode.')
      return { agent, targetPath, action: 'replace', conflict: 'none', warnings }
    }
    warnings.push('The existing symlink is not managed by Prompt Keeper.')
    return { agent, targetPath, action: 'replace', conflict: 'external', warnings }
  }

  if (deployment && resolvePath(deployment.targetPath) === resolvePath(targetPath)) {
    if (cellStatus === 'drifted') {
      warnings.push('Files inside this install were changed outside Prompt Keeper.')
      return { agent, targetPath, action: 'replace', conflict: 'drifted', warnings }
    }
    if (mode === 'copy' && cellStatus === 'synced') {
      return { agent, targetPath, action: 'noop', conflict: 'none', warnings }
    }
    if (mode === 'symlink') warnings.push('Switching this install from copy to symlink mode.')
    else warnings.push('The installed files will be replaced with the current version.')
    return { agent, targetPath, action: 'replace', conflict: 'none', warnings }
  }

  warnings.push('An existing directory that Prompt Keeper does not manage will be replaced.')
  return { agent, targetPath, action: 'replace', conflict: 'external', warnings }
}

async function buildInstallPreview(
  ctx: AppContext,
  input: DispatchInstallInput,
): Promise<InstallPreview> {
  if (typeof input.assetId !== 'string' || !input.assetId) {
    throw new AppError('VALIDATION', 'A Skill asset ID is required.')
  }
  if (!Array.isArray(input.agentIds) || input.agentIds.length === 0) {
    throw new AppError('VALIDATION', 'Select at least one Agent.')
  }
  if (input.mode !== 'symlink' && input.mode !== 'copy') {
    throw new AppError('VALIDATION', 'The install mode must be "symlink" or "copy".')
  }
  const asset = ctx.assets.getAsset(input.assetId)
  if (asset.kind !== 'skill') {
    throw new AppError('UNSUPPORTED', 'MCP servers are applied through the MCP apply flow, not dispatch.', {
      kind: 'unsupported',
      feature: 'mcp-dispatch',
      reason: 'Use mcp:apply and mcp:remove for MCP servers.',
    })
  }

  const agentRows = await ensureAgents(ctx)
  const byId = new Map(agentRows.map((row) => [row.id, row]))
  const selected: AgentRow[] = []
  for (const agentId of uniq(input.agentIds)) {
    const row = byId.get(agentId)
    if (!row) throw new AppError('VALIDATION', `"${agentId}" is not a known Agent.`)
    selected.push(row)
  }

  const revision = ctx.assets.currentRevision(asset.id)
  const deployments = loadDeployments(ctx, asset.id)
  const cache: HashCache = { library: new Map() }
  const plans: InstallPlanTarget[] = []
  for (const agent of selected) {
    plans.push(
      await planInstallTarget(
        ctx,
        asset,
        revision,
        agent,
        input.mode,
        deployments.get(agent.id) ?? null,
        cache,
      ),
    )
  }

  const risk = await skillRiskContribution(ctx, revision)
  const files: SkillFileEntry[] = toSkillFiles(ctx.assets.revisionFiles(revision.id))
  const targets = plans.map((plan) => ({
    agentId: plan.agent.id,
    agentName: plan.agent.name,
    targetPath: plan.targetPath,
    action: plan.action,
    conflict: plan.conflict,
    files,
    warnings: plan.warnings,
  }))
  const core: PreviewCore = {
    assetId: asset.id,
    agentIds: selected.map((agent) => agent.id),
    mode: input.mode,
    revisionId: revision.id,
    manifestHash: revision.manifestHash,
    targets: plans.map((plan) => ({
      agentId: plan.agent.id,
      targetPath: plan.targetPath,
      action: plan.action,
      conflict: plan.conflict,
    })),
  }
  const preview: DispatchPreview = {
    phase: 'preview',
    assetId: asset.id,
    agentIds: selected.map((agent) => agent.id),
    mode: input.mode,
    risk,
    targets,
    previewToken: previewTokenFor(core),
  }
  return { preview, core, token: preview.previewToken, asset, revision }
}

/* ------------------------------------------------------------------ */
/* Install execution                                                   */
/* ------------------------------------------------------------------ */

async function copyRevisionToTarget(
  ctx: AppContext,
  revision: RevisionRecord,
  parentDir: string,
  targetPath: string,
  name: string,
): Promise<void> {
  await ensureDir(parentDir)
  const staging = join(
    parentDir,
    `.pk-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.staging`,
  )
  await removeIfExists(staging)
  await ensureDir(staging)
  const files = ctx.assets.revisionFiles(revision.id)
  try {
    for (const file of files) {
      const content = await ctx.blobs.read(file.blobHash)
      const destination = join(staging, ...file.path.split('/'))
      await writeAtomic(destination, content, { mode: file.isExecutable ? 0o755 : 0o644 })
      if ((await ctx.assets.fileHash(destination)) !== file.blobHash) {
        throw new AppError('INTERNAL', 'A copied Skill file failed its integrity check.')
      }
    }

    const targetExists = await entryExists(targetPath)
    const backup = `${targetPath}.pk-backup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    if (targetExists) await rename(targetPath, backup)
    try {
      await rename(staging, targetPath)
    } catch (error) {
      if (targetExists) await rename(backup, targetPath).catch(() => undefined)
      throw error
    }
    if (targetExists) await removeIfExists(backup)
  } catch (error) {
    await removeIfExists(staging).catch(() => undefined)
    throw error
  }
}

async function installSymlink(
  ctx: AppContext,
  agent: AgentRow,
  targetPath: string,
  libraryDir: string,
): Promise<void> {
  if (!agent.skillDir) {
    throw new AppError('UNSUPPORTED', `${agent.name} has no Skill directory on this platform.`, {
      kind: 'unsupported',
      targetId: agent.id,
      feature: 'skill-dir',
      reason: 'The Agent registry has no Skill directory for this platform.',
    })
  }
  await ensureDir(agent.skillDir)
  if (await entryExists(targetPath)) {
    await removeIfExists(targetPath)
  }
  try {
    await symlink(libraryDir, targetPath, symlinkType(ctx.platform))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown'
    throw new AppError(
      'UNSUPPORTED',
      `Creating a directory symlink for ${agent.name} failed (${code}). Copy mode is available; select it explicitly.`,
      {
        kind: 'unsupported',
        targetId: agent.id,
        feature: 'symlink',
        reason: `symlink failed with ${code}`,
      },
    )
  }
}

async function verifyManagedCopy(
  ctx: AppContext,
  agent: AgentRow,
  targetPath: string,
  deployment: DeploymentRow,
): Promise<boolean> {
  const hash = await hashDirectoryTree(targetPath)
  return hash !== null && hash === deployment.manifestHash && agent.supportsSkills
}

async function runInstall(
  ctx: AppContext,
  input: DispatchInstallInput,
  preview: InstallPreview,
  op: OperationContext,
): Promise<DispatchOperationResult> {
  const { asset, revision } = preview
  const liveRevision = ctx.assets.currentRevisionOrNull(asset.id)
  if (!liveRevision || liveRevision.id !== revision.id) {
    throw new AppError('CONFLICT', 'The Skill changed after the preview. Review the install again.')
  }
  const results: DispatchResultItem[] = []
  const summary = emptySummary()
  const agentRows = await ensureAgents(ctx)
  const byId = new Map(agentRows.map((row) => [row.id, row]))
  const deployments = loadDeployments(ctx, asset.id)
  const cache: HashCache = { library: new Map() }

  await ctx.assets.materialize(asset.id, revision.id)

  const total = preview.preview.targets.length
  let completed = 0

  for (const target of preview.preview.targets) {
    completed++
    const agent = byId.get(target.agentId)
    if (!agent) {
      results.push({
        agentId: target.agentId,
        ok: false,
        action: 'noop',
        targetPath: target.targetPath,
        error: toIpcError(new AppError('NOT_FOUND', 'This Agent is no longer registered.')),
      })
      summary.failed++
      op.progress('install', completed, total, 'Agent not found.')
      continue
    }
    if (!agent.supportsSkills || !agent.skillDir) {
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: target.targetPath,
        error: toIpcError(
          new AppError('UNSUPPORTED', `${agent.name} cannot install Skills on this platform.`, {
            kind: 'unsupported',
            targetId: agent.id,
            feature: 'skills',
            reason: 'The Agent does not support Skills or has no Skill directory.',
          }),
        ),
      })
      summary.failed++
      op.progress('install', completed, total, `${agent.name} is unsupported.`)
      continue
    }

    const deployment = deployments.get(agent.id) ?? null
    try {
      const plan = await planInstallTarget(
        ctx,
        asset,
        revision,
        agent,
        input.mode,
        deployment,
        cache,
      )
      if (
        plan.conflict === 'external' &&
        plan.action === 'replace' &&
        input.confirmOverwriteExternal !== true
      ) {
        throw new AppError(
          'CONFLICT',
          `Installing for ${agent.name} would replace a directory Prompt Keeper does not manage. Confirm the overwrite to continue.`,
          {
            kind: 'target-warnings',
            warnings: [plan.warnings.join(' ')],
            requiresAcknowledgement: true,
          },
        )
      }

      if (plan.action === 'noop') {
        if (input.mode === 'copy' && deployment) {
          if (!(await verifyManagedCopy(ctx, agent, plan.targetPath, deployment))) {
            throw new AppError('CONFLICT', 'The install state changed. Review the preview again.')
          }
        }
      } else if (input.mode === 'symlink') {
        await installSymlink(ctx, agent, plan.targetPath, ctx.assets.libraryDir(asset.id))
      } else {
        await copyRevisionToTarget(
          ctx,
          revision,
          agent.skillDir,
          plan.targetPath,
          installName(asset),
        )
      }

      recordDeployment(
        ctx,
        asset,
        agent.id,
        input.mode,
        plan.targetPath,
        revision,
        `Installed version ${revision.version} using ${input.mode} mode.`,
        deployment,
      )
      ctx.audit.log({
        type: 'deploy',
        result: 'success',
        title: `Installed "${asset.title}" for ${agent.name}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          mode: input.mode,
          targetPath: plan.targetPath,
          revisionId: revision.id,
          revisionVersion: revision.version,
          previousRevisionId: deployment?.deployedRevisionId ?? null,
        },
      })

      const action: DispatchResultItem['action'] =
        plan.action === 'create' ? 'installed' : plan.action === 'replace' ? 'replaced' : 'noop'
      if (action === 'installed') summary.installed++
      else if (action === 'replaced') summary.replaced++
      results.push({
        agentId: agent.id,
        ok: true,
        action,
        targetPath: plan.targetPath,
      })
    } catch (error) {
      summary.failed++
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: target.targetPath,
        error: toIpcError(error),
      })
      ctx.audit.log({
        type: 'deploy',
        result: 'error',
        title: `Failed to install "${asset.title}" for ${agent.name}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          mode: input.mode,
          targetPath: target.targetPath,
          message: errorMessage(error),
        },
      })
    }
    op.progress('install', completed, total, `Installing for ${agent.name}.`)
  }

  ctx.events.domainChanged('dispatch', 'dispatched', [asset.id], op.operationId)
  return { mode: 'install', results, summary }
}

/* ------------------------------------------------------------------ */
/* Removal                                                             */
/* ------------------------------------------------------------------ */

async function pruneEmptyDirs(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return false
  let remaining = false
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const empty = await pruneEmptyDirs(join(dir, entry.name))
      if (!empty) remaining = true
    } else {
      remaining = true
    }
  }
  if (remaining) return false
  await rmdir(dir).catch(() => undefined)
  return true
}

async function removeCopyInstall(
  ctx: AppContext,
  deployment: DeploymentRow,
): Promise<boolean> {
  if (!deployment.deployedRevisionId) {
    throw new AppError('CORRUPT', 'The deployment does not record which version was installed.')
  }
  const rootInfo = await lstat(deployment.targetPath).catch(() => null)
  if (!rootInfo) return false
  if (rootInfo.isSymbolicLink()) {
    throw new AppError(
      'CONFLICT',
      'The install path is a symlink, not the copy Prompt Keeper recorded, so it was not removed.',
    )
  }
  if (!rootInfo.isDirectory()) {
    throw new AppError(
      'CONFLICT',
      'The install path is not a directory, so it was not removed.',
    )
  }
  const revision = ctx.assets.getRevision(deployment.deployedRevisionId)
  let removedAny = false
  for (const file of revision.files) {
    const filePath = join(deployment.targetPath, ...file.path.split('/'))
    if (!isPathInside(deployment.targetPath, filePath)) continue
    const info = await lstat(filePath).catch(() => null)
    if (!info || info.isDirectory()) continue
    await unlink(filePath)
    removedAny = true
  }
  const directoryEmptied = await pruneEmptyDirs(deployment.targetPath)
  return removedAny || directoryEmptied
}

async function removeSymlinkInstall(
  ctx: AppContext,
  deployment: DeploymentRow,
): Promise<boolean> {
  if (!(await isSymlink(deployment.targetPath))) {
    throw new AppError(
      'CONFLICT',
      'The install is no longer a symlink managed by Prompt Keeper, so it was not removed.',
    )
  }
  const linkedReal = await realpathSafe(deployment.targetPath)
  if (!linkedReal || !(await isInsideLibrary(ctx, linkedReal))) {
    throw new AppError(
      'CONFLICT',
      'The symlink does not point into the Prompt Keeper library, so it was not removed.',
    )
  }
  await unlink(deployment.targetPath)
  return true
}

async function runRemove(
  ctx: AppContext,
  input: DispatchRemoveInput,
  asset: AssetRecord,
  agents: AgentRow[],
  op: OperationContext,
): Promise<DispatchOperationResult> {
  const results: DispatchResultItem[] = []
  const summary = emptySummary()
  const deployments = loadDeployments(ctx, asset.id)
  const total = agents.length
  let completed = 0

  for (const agent of agents) {
    completed++
    const deployment = deployments.get(agent.id) ?? null
    if (!deployment) {
      results.push({
        agentId: agent.id,
        ok: true,
        action: 'noop',
        targetPath: agent.skillDir ? join(agent.skillDir, installName(asset)) : '',
      })
      op.progress('remove', completed, total, `Nothing to remove for ${agent.name}.`)
      continue
    }

    try {
      const removed =
        deployment.mode === 'symlink'
          ? await removeSymlinkInstall(ctx, deployment)
          : await removeCopyInstall(ctx, deployment)
      ctx.db.prepare('DELETE FROM deployments WHERE id = ?').run(deployment.id)
      ctx.audit.log({
        type: 'rollback',
        result: 'success',
        title: `Removed the "${asset.title}" install for ${agent.name}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          mode: deployment.mode,
          targetPath: deployment.targetPath,
          removed,
        },
      })
      summary.removed++
      results.push({
        agentId: agent.id,
        ok: true,
        action: 'removed',
        targetPath: deployment.targetPath,
      })
    } catch (error) {
      summary.failed++
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: deployment.targetPath,
        error: toIpcError(error),
      })
      ctx.audit.log({
        type: 'rollback',
        result: 'error',
        title: `Failed to remove the "${asset.title}" install for ${agent.name}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          targetPath: deployment.targetPath,
          message: errorMessage(error),
        },
      })
    }
    op.progress('remove', completed, total, `Removing the install for ${agent.name}.`)
  }

  ctx.events.domainChanged('dispatch', 'deleted', [asset.id], op.operationId)
  return { mode: 'remove', results, summary }
}

/* ------------------------------------------------------------------ */
/* Rollback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Materialize a historical revision outside the current library directory so a
 * rollback symlink never changes what other symlinked Agents see.
 */
async function materializeRevisionCache(
  ctx: AppContext,
  assetId: string,
  revisionId: string,
): Promise<string> {
  const revision = ctx.assets.getRevision(revisionId)
  const dir = join(ctx.paths.library, 'rollback', assetId, revisionId)
  await removeIfExists(dir)
  await ensureDir(dir)
  for (const file of revision.files) {
    const content = await ctx.blobs.read(file.blobHash)
    await writeAtomic(join(dir, ...file.path.split('/')), content, {
      mode: file.isExecutable ? 0o755 : 0o644,
    })
  }
  return dir
}

async function runRollback(
  ctx: AppContext,
  asset: AssetRecord,
  agents: AgentRow[],
  op: OperationContext,
): Promise<DispatchOperationResult> {
  const results: DispatchResultItem[] = []
  const summary = emptySummary()
  const deployments = loadDeployments(ctx, asset.id)
  const total = agents.length
  let completed = 0

  for (const agent of agents) {
    completed++
    const deployment = deployments.get(agent.id) ?? null
    if (!deployment) {
      summary.failed++
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: agent.skillDir ? join(agent.skillDir, installName(asset)) : '',
        error: toIpcError(new AppError('CONFLICT', `${agent.name} has no deployment to roll back.`)),
      })
      op.progress('rollback', completed, total, `${agent.name} has no deployment.`)
      continue
    }
    if (!deployment.previousRevisionId) {
      summary.failed++
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: deployment.targetPath,
        error: toIpcError(new AppError('CONFLICT', 'There is no previous version to roll back to.')),
      })
      op.progress('rollback', completed, total, `${agent.name} has no previous version.`)
      continue
    }

    try {
      const previous = ctx.assets.getRevision(deployment.previousRevisionId)
      if (deployment.mode === 'symlink') {
        if (!agent.skillDir) {
          throw new AppError('UNSUPPORTED', `${agent.name} has no Skill directory on this platform.`, {
            kind: 'unsupported',
            targetId: agent.id,
            feature: 'skill-dir',
            reason: 'The Agent registry has no Skill directory for this platform.',
          })
        }
        const cacheDir = await materializeRevisionCache(ctx, asset.id, previous.id)
        if (await entryExists(deployment.targetPath)) {
          if (!(await isSymlink(deployment.targetPath))) {
            throw new AppError(
              'CONFLICT',
              'The install path is not a symlink managed by Prompt Keeper, so it was not replaced.',
            )
          }
          const linkedReal = await realpathSafe(deployment.targetPath)
          if (!linkedReal || !(await isInsideLibrary(ctx, linkedReal))) {
            throw new AppError(
              'CONFLICT',
              'The symlink does not point into the Prompt Keeper library, so it was not replaced.',
            )
          }
          await unlink(deployment.targetPath)
        }
        await installSymlink(ctx, agent, deployment.targetPath, cacheDir)
      } else {
        await copyRevisionToTarget(
          ctx,
          previous,
          agent.skillDir ?? dirname(deployment.targetPath),
          deployment.targetPath,
          installName(asset),
        )
      }

      recordDeployment(
        ctx,
        asset,
        agent.id,
        deployment.mode,
        deployment.targetPath,
        previous,
        `Rolled back to version ${previous.version}.`,
        deployment,
      )
      ctx.audit.log({
        type: 'rollback',
        result: 'success',
        title: `Rolled back "${asset.title}" for ${agent.name} to version ${previous.version}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          mode: deployment.mode,
          targetPath: deployment.targetPath,
          restoredRevisionId: previous.id,
          replacedRevisionId: deployment.deployedRevisionId,
        },
      })
      summary.rolledBack++
      results.push({
        agentId: agent.id,
        ok: true,
        action: 'rolled-back',
        targetPath: deployment.targetPath,
      })
    } catch (error) {
      summary.failed++
      results.push({
        agentId: agent.id,
        ok: false,
        action: 'noop',
        targetPath: deployment.targetPath,
        error: toIpcError(error),
      })
      ctx.audit.log({
        type: 'rollback',
        result: 'error',
        title: `Failed to roll back "${asset.title}" for ${agent.name}`,
        assetId: asset.id,
        targetId: agent.id,
        operationId: op.operationId,
        detail: {
          targetPath: deployment.targetPath,
          message: errorMessage(error),
        },
      })
    }
    op.progress('rollback', completed, total, `Rolling back for ${agent.name}.`)
  }

  ctx.events.domainChanged('dispatch', 'restored', [asset.id], op.operationId)
  return { mode: 'rollback', results, summary }
}

/* ------------------------------------------------------------------ */
/* Stale sync                                                          */
/* ------------------------------------------------------------------ */

interface StaleWorkItem {
  asset: MatrixAsset
  agent: AgentRow
  deployment: DeploymentRow
}

async function ensureCurrentSymlink(
  ctx: AppContext,
  asset: AssetRecord,
  agent: AgentRow,
  deployment: DeploymentRow,
): Promise<void> {
  const libraryDir = ctx.assets.libraryDir(asset.id)
  const targetReal = await realpathSafe(deployment.targetPath)
  const libraryReal = await realpathSafe(libraryDir)
  if (targetReal && libraryReal && targetReal === libraryReal) {
    return
  }
  if (!agent.skillDir) {
    throw new AppError('UNSUPPORTED', `${agent.name} has no Skill directory on this platform.`, {
      kind: 'unsupported',
      targetId: agent.id,
      feature: 'skill-dir',
      reason: 'The Agent registry has no Skill directory for this platform.',
    })
  }
  if (await entryExists(deployment.targetPath)) {
    if (!(await isSymlink(deployment.targetPath))) {
      throw new AppError(
        'CONFLICT',
        'The install path is not a symlink managed by Prompt Keeper.',
      )
    }
    const linkedReal = await realpathSafe(deployment.targetPath)
    if (!linkedReal || !(await isInsideLibrary(ctx, linkedReal))) {
      throw new AppError('CONFLICT', 'The symlink does not point into the Prompt Keeper library.')
    }
    await unlink(deployment.targetPath)
  }
  await installSymlink(ctx, agent, deployment.targetPath, libraryDir)
}

async function collectStaleWork(
  ctx: AppContext,
  input: DispatchSyncStaleInput,
): Promise<{ work: StaleWorkItem[]; skippedDrifted: number }> {
  const agentRows = await ensureAgents(ctx)
  const assetIds = uniq(input.assetIds)
  const agentIds = uniq(input.agentIds)
  const assetFilter = assetIds.length ? new Set(assetIds) : null
  const agentFilter = agentIds.length ? new Set(agentIds) : null
  const assets = loadDispatchAssets(ctx, ['skill'], undefined).filter(
    (entry) => !assetFilter || assetFilter.has(entry.asset.id),
  )
  const deployments = loadDeploymentMap(ctx, assets)
  const cache: HashCache = { library: new Map() }
  const work: StaleWorkItem[] = []
  let skippedDrifted = 0

  for (const entry of assets) {
    for (const agent of agentRows) {
      if (agentFilter && !agentFilter.has(agent.id)) continue
      if (!agent.supportsSkills) continue
      const deployment = deployments.get(`${entry.asset.id}|${agent.id}`) ?? null
      if (!deployment) continue
      const cell = await computeCell(ctx, entry, agent, deployment, cache)
      if (cell.status === 'drifted') {
        skippedDrifted++
        continue
      }
      if (cell.status === 'stale') {
        work.push({ asset: entry, agent, deployment })
      }
    }
  }
  return { work, skippedDrifted }
}

async function runSyncStale(
  ctx: AppContext,
  input: DispatchSyncStaleInput,
  op: OperationContext,
): Promise<DispatchOperationResult> {
  const collected = await collectStaleWork(ctx, input)
  const batch: DispatchBatchResult = {
    synced: 0,
    skippedDrifted: collected.skippedDrifted,
    failed: [],
  }
  const total = collected.work.length
  let completed = 0
  const touched: string[] = []
  const materialized = new Set<string>()

  for (const item of collected.work) {
    completed++
    try {
      if (item.deployment.mode === 'symlink') {
        if (!materialized.has(item.asset.asset.id)) {
          await ctx.assets.materialize(item.asset.asset.id, item.asset.revision.id)
          materialized.add(item.asset.asset.id)
        }
        await ensureCurrentSymlink(ctx, item.asset.asset, item.agent, item.deployment)
      } else {
        await copyRevisionToTarget(
          ctx,
          item.asset.revision,
          item.agent.skillDir ?? dirname(item.deployment.targetPath),
          item.deployment.targetPath,
          installName(item.asset.asset),
        )
      }
      recordDeployment(
        ctx,
        item.asset.asset,
        item.agent.id,
        item.deployment.mode,
        item.deployment.targetPath,
        item.asset.revision,
        `Synced to version ${item.asset.revision.version}.`,
        item.deployment,
      )
      batch.synced++
      touched.push(item.asset.asset.id)
      ctx.audit.log({
        type: 'deploy',
        result: 'success',
        title: `Synced "${item.asset.asset.title}" for ${item.agent.name}`,
        assetId: item.asset.asset.id,
        targetId: item.agent.id,
        operationId: op.operationId,
        detail: {
          mode: item.deployment.mode,
          targetPath: item.deployment.targetPath,
          revisionId: item.asset.revision.id,
          revisionVersion: item.asset.revision.version,
        },
      })
    } catch (error) {
      batch.failed.push({
        assetId: item.asset.asset.id,
        agentId: item.agent.id,
        code: errorCode(error),
        message: errorMessage(error),
      })
    }
    op.progress('sync-stale', completed, total, `Syncing "${item.asset.asset.title}" for ${item.agent.name}.`)
  }

  ctx.events.domainChanged('dispatch', 'synced', uniq(touched), op.operationId)
  return { mode: 'sync-stale', result: batch }
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

function requireSkillAsset(ctx: AppContext, assetId: string): AssetRecord {
  if (typeof assetId !== 'string' || !assetId) {
    throw new AppError('VALIDATION', 'A Skill asset ID is required.')
  }
  const asset = ctx.assets.getAsset(assetId)
  if (asset.kind !== 'skill') {
    throw new AppError('UNSUPPORTED', 'Only Skills can be installed through dispatch. Use the MCP apply flow for MCP servers.', {
      kind: 'unsupported',
      feature: 'mcp-dispatch',
      reason: 'MCP servers are managed by mcp:apply and mcp:remove.',
    })
  }
  return asset
}

function selectedAgents(rows: AgentRow[], agentIds: string[]): AgentRow[] {
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    throw new AppError('VALIDATION', 'Select at least one Agent.')
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const out: AgentRow[] = []
  for (const agentId of uniq(agentIds)) {
    const row = byId.get(agentId)
    if (!row) throw new AppError('VALIDATION', `"${agentId}" is not a known Agent.`)
    out.push(row)
  }
  return out
}

export function createDispatchService(ctx: AppContext): DispatchService {
  return {
    async matrix(query: DispatchMatrixQuery): Promise<DispatchMatrix> {
      const filteredKinds = Array.isArray(query.kinds)
        ? query.kinds.filter((kind): kind is 'skill' | 'mcp' => kind === 'skill' || kind === 'mcp')
        : []
      const kinds: Array<'skill' | 'mcp'> = filteredKinds.length ? filteredKinds : ['skill', 'mcp']
      const agentRows = await ensureAgents(ctx)
      const visibleAgents = query.includeUndetected ? agentRows : agentRows.filter((row) => row.detected)
      const folder = typeof query.folder === 'string' && query.folder ? query.folder : undefined
      const assets = loadDispatchAssets(ctx, kinds, folder)
      const deployments = loadDeploymentMap(ctx, assets)
      const cache: HashCache = { library: new Map() }
      const rows: DispatchMatrix['rows'] = []
      const counts = {
        synced: 0,
        stale: 0,
        drifted: 0,
        missing: 0,
        unsupported: 0,
      }

      for (const entry of assets) {
        const cells: DispatchCell[] = []
        for (const agent of visibleAgents) {
          const deployment = deployments.get(`${entry.asset.id}|${agent.id}`) ?? null
          const cell = await computeCell(ctx, entry, agent, deployment, cache)
          cells.push(cell)
          if (cell.status === 'synced') counts.synced++
          else if (cell.status === 'stale') counts.stale++
          else if (cell.status === 'drifted') counts.drifted++
          else if (cell.status === 'missing') counts.missing++
          else counts.unsupported++
        }
        const visibleCells = query.onlyAnomalies
          ? cells.filter((cell) => cell.status !== 'synced')
          : cells
        if (query.onlyAnomalies && visibleCells.length === 0) continue
        rows.push({
          assetId: entry.asset.id,
          kind: entry.kind,
          title: entry.asset.title,
          folder: entry.asset.folder,
          currentVersion: entry.revision.version,
          cells: visibleCells,
        })
      }

      return {
        agents: visibleAgents.map(toDispatchAgent),
        rows,
        summary: counts,
      }
    },

    async detail({ assetId }): Promise<DispatchDetail> {
      const asset = ctx.assets.getAsset(assetId)
      if (asset.kind !== 'skill' && asset.kind !== 'mcp') {
        throw new AppError('NOT_FOUND', 'Dispatch details exist only for Skills and MCP servers.')
      }
      const revision = ctx.assets.currentRevision(asset.id)
      const agentRows = await ensureAgents(ctx)
      const deployments = loadDeployments(ctx, asset.id)
      const cache: HashCache = { library: new Map() }
      const entry: MatrixAsset = { asset, revision, kind: asset.kind }
      const cells: DispatchCell[] = []
      for (const agent of agentRows) {
        const deployment = deployments.get(agent.id) ?? null
        cells.push(await computeCell(ctx, entry, agent, deployment, cache))
      }

      const history = [...deployments.values()]
        .map((deployment) => {
          const cell = cells.find((entryCell) => entryCell.agentId === deployment.agentId)
          const status: Exclude<DispatchStatus, 'unsupported'> =
            cell && cell.status !== 'unsupported'
              ? cell.status
              : deployment.status === 'unsupported'
                ? 'missing'
                : deployment.status
          return {
            id: deployment.id,
            agentId: deployment.agentId,
            mode: deployment.mode,
            status,
            deployedVersion: revisionVersion(ctx, deployment.deployedRevisionId) ?? 0,
            deployedAt: deployment.deployedAt,
            targetPath: deployment.targetPath,
          }
        })
        .sort((a, b) => a.agentId.localeCompare(b.agentId))

      return {
        assetId: asset.id,
        kind: asset.kind,
        title: asset.title,
        currentVersion: revision.version,
        cells,
        history,
      }
    },

    async install(input: DispatchInstallInput): Promise<DispatchInstallResult> {
      if (input.confirm !== true) {
        const preview = await buildInstallPreview(ctx, input)
        return preview.preview
      }
      const preview = await buildInstallPreview(ctx, input)
      if (!input.previewToken) {
        throw new AppError('VALIDATION', 'A preview token is required. Review the install preview first.')
      }
      if (input.previewToken !== preview.token) {
        throw new AppError('CONFLICT', 'The install preview is out of date. Review the preview again.')
      }
      if (preview.preview.risk.includes('scripts') && input.acknowledgeScripts !== true) {
        throw new AppError(
          'VALIDATION',
          'This Skill contains script-like files. Acknowledge the script risk to continue.',
          {
            kind: 'target-warnings',
            warnings: preview.preview.targets
              .flatMap((target) => target.warnings)
              .concat('This Skill contains script-like files. Prompt Keeper never executes them.'),
            requiresAcknowledgement: true,
          },
        )
      }
      const external = preview.preview.targets.filter(
        (target) => target.action === 'replace' && target.conflict === 'external',
      )
      if (external.length && input.confirmOverwriteExternal !== true) {
        throw new AppError(
          'CONFLICT',
          'One or more targets contain directories Prompt Keeper does not manage. Confirm the overwrite to continue.',
          {
            kind: 'target-warnings',
            warnings: external.map(
              (target) => `${target.agentName}: ${target.targetPath} is not managed by Prompt Keeper.`,
            ),
            requiresAcknowledgement: true,
          },
        )
      }

      const asset = preview.asset
      return ctx.operations.start(
        'dispatch',
        async (op) => ({
          type: 'dispatch' as const,
          result: await runInstall(ctx, input, preview, op),
        }),
        { assetId: asset.id },
      )
    },

    async remove(input: DispatchRemoveInput): Promise<OperationRef> {
      assertConfirm(input.confirm)
      const asset = requireSkillAsset(ctx, input.assetId)
      const rows = await ensureAgents(ctx)
      const agents = selectedAgents(rows, input.agentIds)
      return ctx.operations.start(
        'dispatch',
        async (op) => ({
          type: 'dispatch' as const,
          result: await runRemove(ctx, input, asset, agents, op),
        }),
        { assetId: asset.id },
      )
    },

    async rollback(input: DispatchRollbackInput): Promise<OperationRef> {
      const asset = requireSkillAsset(ctx, input.assetId)
      const rows = await ensureAgents(ctx)
      const agents = selectedAgents(rows, input.agentIds)
      return ctx.operations.start(
        'dispatch',
        async (op) => ({
          type: 'dispatch' as const,
          result: await runRollback(ctx, asset, agents, op),
        }),
        { assetId: asset.id },
      )
    },

    async syncStale(input: DispatchSyncStaleInput): Promise<OperationRef> {
      return ctx.operations.start(
        'dispatch',
        async (op) => ({
          type: 'dispatch' as const,
          result: await runSyncStale(ctx, input, op),
        }),
        {},
      )
    },
  }
}
