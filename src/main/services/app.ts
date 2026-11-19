import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { app, nativeTheme, shell } from 'electron'
import type {
  BootstrapSnapshot,
  DataLocation,
  DataLocationId,
  Density,
  ProjectRemoveResult,
  ProjectRegisterInput,
  ProjectSummary,
  RevealTarget,
  ThemeMode,
  ThemeUpdateResult,
} from '../../shared/contracts'
import { AppError, validationError } from '../../shared/domain/errors'
import { isPathInside } from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import { AGENT_DEFS, GLOBAL_TARGET_DEFS, platformPath } from '../../shared/domain/targets'
import { expandUserPath, isAbsoluteUserPath } from '../paths'
import { currentSchemaVersion } from '../db/database'
import { ensureDir, pathExists } from '../adapters/fs'
import { setting, setSetting, type AppContext } from '../context'
import type { AppService } from './types'
import { UPDATES_SUPPORTED } from './updates'
import { repoStatusRow } from './assetSyncState'

export const THEME_SETTING_KEY = 'ui.theme'
export const DENSITY_SETTING_KEY = 'ui.density'

const DATA_LOCATION_IDS: DataLocationId[] = [
  'database',
  'blobs',
  'library',
  'clones',
  'backups',
  'logs',
  'operations',
]

const DATA_LOCATION_LABELS: Record<DataLocationId, string> = {
  database: 'Database',
  blobs: 'Content blobs',
  library: 'Library files',
  clones: 'Repository clones',
  backups: 'Backups',
  logs: 'Logs',
  operations: 'Operation records',
}

/** Directory sizes are best effort: a large clone or blob store stops counting past this budget. */
const MEASURE_ENTRY_LIMIT = 4000

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function isDensity(value: unknown): value is Density {
  return value === 'comfortable' || value === 'compact'
}

export function readThemePreference(ctx: AppContext): ThemeMode {
  const stored = setting<unknown>(ctx, THEME_SETTING_KEY, 'system')
  return isThemeMode(stored) ? stored : 'system'
}

export function readDensityPreference(ctx: AppContext): Density {
  const stored = setting<unknown>(ctx, DENSITY_SETTING_KEY, 'comfortable')
  return isDensity(stored) ? stored : 'comfortable'
}

export function effectiveThemeFor(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** The native theme source keeps Electron window chrome aligned with the stored preference. */
export function applyNativeTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
}

export function dataLocationPath(ctx: AppContext, id: DataLocationId): string {
  switch (id) {
    case 'database':
      return ctx.paths.dbFile
    case 'blobs':
      return ctx.paths.blobs
    case 'library':
      return ctx.paths.library
    case 'clones':
      return ctx.paths.repos
    case 'backups':
      return ctx.paths.backups
    case 'logs':
      return ctx.paths.logs
    case 'operations':
      return ctx.paths.operations
  }
}

async function measurePath(target: string): Promise<number | undefined> {
  const info = await stat(target).catch(() => null)
  if (!info) return undefined
  if (!info.isDirectory()) return info.size

  let entries = 0
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const list = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of list) {
      entries += 1
      if (entries > MEASURE_ENTRY_LIMIT) throw new Error('measurement-budget-exceeded')
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const fileInfo = await stat(full).catch(() => null)
        if (fileInfo) total += fileInfo.size
      }
    }
  }
  try {
    await walk(target)
    return total
  } catch {
    return undefined
  }
}

async function measureDatabase(ctx: AppContext): Promise<number | undefined> {
  let total = 0
  let found = false
  for (const suffix of ['', '-wal', '-shm']) {
    const info = await stat(`${ctx.paths.dbFile}${suffix}`).catch(() => null)
    if (!info) continue
    found = true
    total += info.size
  }
  return found ? total : undefined
}

/** Local paths only; never secret material. Sizes are bounded and may be absent. */
export async function collectDataLocations(ctx: AppContext): Promise<DataLocation[]> {
  return Promise.all(
    DATA_LOCATION_IDS.map(async (id) => {
      const path = dataLocationPath(ctx, id)
      const exists = await pathExists(path)
      const sizeBytes = exists
        ? id === 'database'
          ? await measureDatabase(ctx)
          : await measurePath(path)
        : undefined
      return {
        id,
        label: DATA_LOCATION_LABELS[id],
        path,
        exists,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      }
    }),
  )
}

function pendingCounts(ctx: AppContext): BootstrapSnapshot['pending'] {
  const syncRows = ctx.db
    .prepare(
      "SELECT direction, COUNT(*) AS count FROM sync_changes WHERE status IN ('open','reviewed') GROUP BY direction",
    )
    .all() as Array<{ direction: string; count: number }>
  const dispatchRows = ctx.db
    .prepare("SELECT status, COUNT(*) AS count FROM deployments WHERE status IN ('stale','drifted') GROUP BY status")
    .all() as Array<{ status: string; count: number }>
  const projectionRows = ctx.db
    .prepare("SELECT status, COUNT(*) AS count FROM projections WHERE status IN ('stale','drifted') GROUP BY status")
    .all() as Array<{ status: string; count: number }>

  const countSync = (direction: string): number =>
    syncRows.find((row) => row.direction === direction)?.count ?? 0
  const countStatus = (rows: Array<{ status: string; count: number }>, status: string): number =>
    rows.find((row) => row.status === status)?.count ?? 0

  return {
    incoming: countSync('incoming'),
    outgoing: countSync('outgoing'),
    conflicts: countSync('conflict'),
    dispatchStale: countStatus(dispatchRows, 'stale'),
    dispatchDrifted: countStatus(dispatchRows, 'drifted'),
    projectionStale: countStatus(projectionRows, 'stale'),
    projectionDrifted: countStatus(projectionRows, 'drifted'),
  }
}

interface DetectedAgentRow {
  id: string
  name: string
  detected: boolean
  detectedAt: string | null
  skillDir: string | null
  mcpFile: string | null
  supportsSkills: boolean
  supportsMcp: boolean
  configFormat: string | null
}

async function syncAgentDetection(ctx: AppContext): Promise<string[]> {
  const at = nowIso()
  const rows: DetectedAgentRow[] = []
  for (const def of AGENT_DEFS) {
    const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
    const skillDir = paths.skillDir ? expandUserPath(paths.skillDir) : null
    const mcpFile = paths.mcpFile ? expandUserPath(paths.mcpFile) : null
    const skillPresent = skillDir ? await pathExists(skillDir) : false
    const configPresent = mcpFile ? await pathExists(mcpFile) : false
    const detected = skillPresent || configPresent
    rows.push({
      id: def.id,
      name: def.name,
      detected,
      detectedAt: detected ? at : null,
      skillDir,
      mcpFile,
      supportsSkills: def.supportsSkills,
      supportsMcp: def.supportsMcp,
      configFormat: paths.mcpFormat ?? null,
    })
  }

  const upsert = ctx.db.prepare(
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
  const tx = ctx.db.transaction(() => {
    for (const row of rows) {
      upsert.run(
        row.id,
        row.name,
        row.detected ? 1 : 0,
        row.detectedAt,
        row.skillDir,
        row.mcpFile,
        row.supportsSkills ? 1 : 0,
        row.supportsMcp ? 1 : 0,
        row.configFormat,
      )
    }
  })
  tx()

  return rows.filter((row) => row.detected).map((row) => row.id)
}

function recoveryState(ctx: AppContext): { degraded: boolean; issues: string[] } {
  try {
    const result = ctx.db.pragma('quick_check', { simple: true })
    if (typeof result === 'string' && result.toLowerCase() !== 'ok') {
      return {
        degraded: true,
        issues: [`The local database integrity check reported: ${result.slice(0, 300)}`],
      }
    }
  } catch {
    return { degraded: true, issues: ['The local database integrity check could not run.'] }
  }
  return { degraded: false, issues: [] }
}

function projectSummaries(ctx: AppContext): ProjectSummary[] {
  const rows = ctx.db
    .prepare(
      `SELECT p.id, p.name, p.root_path, p.created_at,
         (SELECT COUNT(*) FROM projections pr WHERE pr.project_id = p.id) AS projection_count,
         (SELECT COUNT(*) FROM projections pr WHERE pr.project_id = p.id AND pr.status = 'stale') AS stale_count,
         (SELECT COUNT(*) FROM projections pr WHERE pr.project_id = p.id AND pr.status = 'drifted') AS drifted_count
       FROM projects p
       ORDER BY p.created_at`,
    )
    .all() as Array<{
    id: string
    name: string
    root_path: string
    created_at: string
    projection_count: number
    stale_count: number
    drifted_count: number
  }>
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: row.created_at,
    projectionCount: row.projection_count,
    staleCount: row.stale_count,
    driftedCount: row.drifted_count,
  }))
}

function projectSummaryById(ctx: AppContext, projectId: string): ProjectSummary | null {
  return projectSummaries(ctx).find((project) => project.id === projectId) ?? null
}

function globalTargetRoots(ctx: AppContext): string[] {
  const roots: string[] = []
  const rows = ctx.db.prepare('SELECT path, path_mode FROM global_targets').all() as Array<{
    path: string
    path_mode: string
  }>
  for (const row of rows) {
    roots.push(row.path_mode === 'dir' ? row.path : dirname(row.path))
  }
  for (const def of GLOBAL_TARGET_DEFS) {
    const target = expandUserPath(platformPath(def, ctx.platform))
    roots.push(def.pathMode === 'dir' ? target : dirname(target))
  }
  return roots
}

function agentRoots(ctx: AppContext): string[] {
  const roots: string[] = []
  for (const def of AGENT_DEFS) {
    const paths = ctx.platform === 'win32' ? def.win32 : def.darwin
    if (paths.skillDir) roots.push(expandUserPath(paths.skillDir))
    if (paths.mcpFile) roots.push(dirname(expandUserPath(paths.mcpFile)))
  }
  return roots
}

function assertInsideRoots(roots: string[], target: string): void {
  const resolved = resolve(target)
  const allowed = roots.some((root) => isPathInside(resolve(root), resolved))
  if (!allowed) {
    throw new AppError(
      'SECURITY_BLOCK',
      'The requested item is outside the folders Prompt Keeper manages.',
    )
  }
}

function isDataLocationId(value: unknown): value is DataLocationId {
  return typeof value === 'string' && DATA_LOCATION_IDS.includes(value as DataLocationId)
}

export function createAppService(ctx: AppContext): AppService {
  return {
    async bootstrap(): Promise<BootstrapSnapshot> {
      const detectedAgentIds = await syncAgentDetection(ctx)
      const dataLocations = await collectDataLocations(ctx)
      const theme = readThemePreference(ctx)
      const density = readDensityPreference(ctx)
      const locale = (() => {
        try {
          return app.getLocale() || 'en-US'
        } catch {
          return 'en-US'
        }
      })()

      return {
        appVersion: ctx.appVersion,
        buildId: ctx.buildId,
        schemaVersion: currentSchemaVersion(ctx.db),
        contractVersion: 1,
        platform: ctx.platform,
        locale,
        theme,
        effectiveTheme: effectiveThemeFor(theme),
        density,
        safeStorage: {
          available: ctx.safeStorageAvailable,
          ...(ctx.safeStorageReason ? { reason: ctx.safeStorageReason } : {}),
        },
        capabilities: {
          ai: true,
          updates: UPDATES_SUPPORTED,
          globalProjections: true,
          multiWindow: false,
        },
        repo: repoStatusRow(ctx),
        counts: ctx.assets.countByKind(),
        pending: pendingCounts(ctx),
        detectedAgentIds,
        activeOperations: ctx.operations.activeRefs(),
        recovery: recoveryState(ctx),
        dataLocations,
      }
    },

    async theme(input: { theme: ThemeMode }): Promise<ThemeUpdateResult> {
      if (!isThemeMode(input?.theme)) {
        throw validationError('Choose light, dark, or system.', [
          { path: 'theme', message: 'Expected "light", "dark", or "system".' },
        ])
      }
      setSetting(ctx, THEME_SETTING_KEY, input.theme)
      applyNativeTheme(input.theme)
      ctx.events.domainChanged('settings', 'updated', [])
      return { theme: input.theme, effectiveTheme: effectiveThemeFor(input.theme) }
    },

    async openExternal(input: { url: string }): Promise<void> {
      const raw = typeof input?.url === 'string' ? input.url.trim() : ''
      if (!raw || raw.length > 2048) {
        throw validationError('Enter a valid link.', [
          { path: 'url', message: 'The link is empty or too long.' },
        ])
      }
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        throw validationError('Enter a valid link.', [
          { path: 'url', message: 'The link is not a valid URL.' },
        ])
      }
      if (url.protocol !== 'https:') {
        throw validationError('Only https links can be opened.', [
          { path: 'url', message: 'Use an https link.' },
        ])
      }
      if (url.username || url.password) {
        throw validationError('Links with embedded credentials are not allowed.', [
          { path: 'url', message: 'Remove the username and password from the link.' },
        ])
      }
      await shell.openExternal(url.toString())
    },

    async revealPath(input: { target: RevealTarget }): Promise<void> {
      const target = input?.target
      if (!target || typeof target !== 'object') {
        throw validationError('Choose an item to reveal.', [
          { path: 'target', message: 'A reveal target is required.' },
        ])
      }

      if (target.kind === 'data-location') {
        if (!isDataLocationId(target.location)) {
          throw validationError('This data location is not recognized.', [
            { path: 'target.location', message: 'Unknown data location.' },
          ])
        }
        const path = dataLocationPath(ctx, target.location)
        assertInsideRoots([ctx.paths.userData], path)
        shell.showItemInFolder(path)
        return
      }

      if (target.kind === 'projection') {
        const projectionId = target.projectionId
        if (typeof projectionId !== 'string' || !projectionId) {
          throw validationError('A projection is required.', [
            { path: 'target.projectionId', message: 'The projection ID is missing.' },
          ])
        }
        const row = ctx.db
          .prepare('SELECT scope, project_id, target_path FROM projections WHERE id = ?')
          .get(projectionId) as { scope: string; project_id: string; target_path: string } | undefined
        if (!row || !row.target_path) {
          throw new AppError('NOT_FOUND', 'This projection no longer exists.')
        }
        if (row.scope === 'project') {
          const project = ctx.db
            .prepare('SELECT root_path FROM projects WHERE id = ?')
            .get(row.project_id) as { root_path: string } | undefined
          if (!project) {
            throw new AppError(
              'SECURITY_BLOCK',
              'The project for this projection is no longer registered, so its location cannot be verified.',
            )
          }
          assertInsideRoots([project.root_path], row.target_path)
        } else {
          assertInsideRoots(globalTargetRoots(ctx), row.target_path)
        }
        shell.showItemInFolder(row.target_path)
        return
      }

      if (target.kind === 'deployment') {
        const deploymentId = target.deploymentId
        if (typeof deploymentId !== 'string' || !deploymentId) {
          throw validationError('A deployment is required.', [
            { path: 'target.deploymentId', message: 'The deployment ID is missing.' },
          ])
        }
        const row = ctx.db
          .prepare('SELECT target_path FROM deployments WHERE id = ?')
          .get(deploymentId) as { target_path: string } | undefined
        if (!row || !row.target_path) {
          throw new AppError('NOT_FOUND', 'This deployment no longer exists.')
        }
        assertInsideRoots(agentRoots(ctx), row.target_path)
        shell.showItemInFolder(row.target_path)
        return
      }

      throw validationError('This reveal target is not supported.', [
        { path: 'target.kind', message: 'Unknown target kind.' },
      ])
    },

    async projectsList(): Promise<ProjectSummary[]> {
      return projectSummaries(ctx)
    },

    async projectsRegister(input: ProjectRegisterInput): Promise<ProjectSummary> {
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (!name || name.length > 120) {
        throw validationError('Enter a project name.', [
          { path: 'name', message: 'The name is required and must be 120 characters or fewer.' },
        ])
      }
      const rawPath = typeof input?.rootPath === 'string' ? input.rootPath.trim() : ''
      if (!rawPath || !isAbsoluteUserPath(rawPath)) {
        throw validationError('Enter an absolute project folder.', [
          { path: 'rootPath', message: 'The root path must be absolute.' },
        ])
      }
      const expanded = expandUserPath(rawPath)
      const info = await stat(expanded).catch(() => null)
      if (!info || !info.isDirectory()) {
        throw validationError('The project root must be an existing directory.', [
          { path: 'rootPath', message: 'No directory exists at this path.' },
        ])
      }
      const rootPath = await realpath(expanded).catch(() => resolve(expanded))
      const existing = ctx.db.prepare('SELECT id FROM projects WHERE root_path = ?').get(rootPath) as
        | { id: string }
        | undefined
      if (existing) {
        throw new AppError('CONFLICT', 'This project folder is already registered.', {
          kind: 'duplicate',
          field: 'rootPath',
          value: rootPath,
        })
      }

      const projectId = newId('prj')
      ctx.db
        .prepare('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
        .run(projectId, name, rootPath, nowIso())
      ctx.events.domainChanged('settings', 'updated', [projectId])
      return (
        projectSummaryById(ctx, projectId) ?? {
          id: projectId,
          name,
          rootPath,
          createdAt: nowIso(),
          projectionCount: 0,
          staleCount: 0,
          driftedCount: 0,
        }
      )
    },

    async projectsRemove(input: { projectId: string; confirm: true }): Promise<ProjectRemoveResult> {
      const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
      if (!projectId) {
        throw validationError('Choose a project to remove.', [
          { path: 'projectId', message: 'The project ID is required.' },
        ])
      }
      if (input?.confirm !== true) {
        throw validationError('Removing a project requires confirmation.', [
          { path: 'confirm', message: 'Set confirm to true to remove the project.' },
        ])
      }
      const project = ctx.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as
        | { id: string }
        | undefined
      if (!project) throw new AppError('NOT_FOUND', 'This project no longer exists.')

      const orphaned = ctx.db
        .prepare('SELECT id FROM projections WHERE project_id = ?')
        .all(projectId) as Array<{ id: string }>
      const tx = ctx.db.transaction(() => {
        ctx.db.prepare('UPDATE projections SET orphaned = 1 WHERE project_id = ?').run(projectId)
        ctx.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      })
      tx()

      const orphanedProjectionIds = orphaned.map((row) => row.id)
      ctx.events.domainChanged('projections', 'reconciled', orphanedProjectionIds)
      ctx.events.domainChanged('settings', 'updated', [projectId])
      return { projectId, orphanedProjectionIds }
    },
  }
}

/** Kept exported so settings and other services use one definition of the local directories. */
export async function ensureLocalDirectories(ctx: AppContext): Promise<void> {
  await ensureDir(ctx.paths.library)
  await ensureDir(ctx.paths.blobs)
  await ensureDir(ctx.paths.backups)
}
