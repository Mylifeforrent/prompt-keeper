import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  AssetKind,
  AuditEvent,
  CancelResult,
  ConflictResolutionResult,
  IpcErrorCode,
  OperationRef,
  OperationResult,
  OperationType,
  Page,
  RepoAuthInput,
  RepoConnectInput,
  RepoConnectPreview,
  RepoConnectResult,
  RepoDisconnectInput,
  RepoDisconnectResult,
  RepoLayout,
  RepoPolicies,
  RepoProvider,
  RepoStatus,
  RepoUpdateInput,
  ScanFinding,
  SyncChangeDetail,
  SyncChangeKind,
  SyncChangeQuery,
  SyncChangeStatus,
  SyncChangeSummary,
  SyncConflictResolveInput,
  SyncDirection,
  SyncFileDiff,
  SyncHistoryQuery,
  SyncPolicy,
  SyncPullInput,
  SyncPushInput,
  SyncReviewInput,
  SyncReviewResult,
  SyncRisk,
} from '../../shared/contracts'
import { AppError, isAppError } from '../../shared/domain/errors'
import {
  isPathInside,
  isSafeFileName,
  isSafeRelativePath,
  normalizeFolder,
  slugify,
  validateFolder,
} from '../../shared/domain/folders'
import { newId, nowIso } from '../../shared/domain/ids'
import {
  canonicalManifestJson,
  isScriptFile,
  isTextFile,
  type ManifestFile,
} from '../../shared/domain/manifest'
import { diffStats, truncateText } from '../../shared/domain/diff'
import { scanFiles, scanText } from '../../shared/domain/scanner'
import { parsePromptFile } from '../../shared/domain/promptFile'
import { parseContractFile } from '../../shared/domain/contractFile'
import { parseMcpFile, isPlaceholder } from '../../shared/domain/mcpFile'
import type { AppContext } from '../context'
import { setSetting } from '../context'
import type { OperationContext } from '../operations'
import type { SyncService } from './types'
import { repoStatusRow } from './assetHelpers'
import type { AssetRecord, NewAssetFile, RevisionRecord } from './assetStore'
import { ensureDir, pathExists, removeIfExists, writeAtomic } from '../adapters/fs'
import { sha256Hex } from '../adapters/hash'
import {
  createGitClient,
  type GitAuth,
  type GitClient,
  type GitTreeEntry,
} from '../adapters/git'

/**
 * Git sync engine.
 *
 * The local library is the control plane. The clone is a read/write mirror used
 * for Git commands only: fetch reads remote refs, pull writes new library
 * revisions from reviewed remote content, and push writes canonical local files
 * into the clone and commits exactly those paths. Nothing here rewrites remote
 * history, force-pushes, or auto-merges.
 */

const REMOTE_NAME = 'origin'
const DEFAULT_BRANCH = 'main'
const DEFAULT_LAYOUT: RepoLayout = {
  prompts: 'prompts',
  contracts: 'instructions',
  skills: 'skills',
  mcp: 'mcp',
}
const DEFAULT_POLICIES: RepoPolicies = {
  prompts: true,
  contracts: true,
  skills: true,
  mcp: true,
}
const MAX_SCAN_FILES = 3_000
const MAX_SCAN_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_FILE_BYTES = 16 * 1024 * 1024
const MAX_DIFF_TEXT_CHARS = 2_000_000
const MAX_DETAIL_TEXT_BYTES = 512 * 1024
const MAX_FINDINGS = 500
const AHEAD_CACHE_MS = 5_000
const AUTO_FETCH_TICK_MS = 45_000
const KIND_LABEL: Record<AssetKind, string> = {
  prompt: 'Prompt',
  contract: 'Agent Instruction',
  skill: 'Skill',
  mcp: 'MCP server',
}
const KIND_ROOT_KEY: Record<AssetKind, keyof RepoLayout> = {
  prompt: 'prompts',
  contract: 'contracts',
  skill: 'skills',
  mcp: 'mcp',
}
const KIND_POLICY_KEY: Record<AssetKind, keyof RepoPolicies> = {
  prompt: 'prompts',
  contract: 'contracts',
  skill: 'skills',
  mcp: 'mcp',
}
const KIND_DOMAIN: Record<AssetKind, 'prompts' | 'contracts' | 'skills' | 'mcp'> = {
  prompt: 'prompts',
  contract: 'contracts',
  skill: 'skills',
  mcp: 'mcp',
}

/* ------------------------------------------------------------------ */
/* Row helpers                                                         */
/* ------------------------------------------------------------------ */

interface RepoRow {
  id: string
  provider: RepoProvider
  url: string
  branch: string
  local_path: string
  auth_mode: 'credential' | 'ssh' | 'token'
  clone_mode: 'managed' | 'bound'
  policies_json: string
  layout_json: string
  auto_fetch: number
  fetch_interval_min: number
  push_mode: 'direct' | 'branch'
  last_fetched_at: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

interface RepoAssetRow {
  repo_id: string
  asset_id: string
  remote_path: string
  base_commit: string | null
  base_revision_id: string | null
  base_manifest_hash: string | null
  last_synced_at: string | null
}

interface SyncChangeRow {
  id: string
  repo_id: string
  asset_id: string | null
  asset_kind: AssetKind
  asset_name: string
  remote_path: string
  direction: SyncDirection
  change_kind: SyncChangeKind
  status: SyncChangeStatus
  risk_json: string
  fingerprint: string
  local_revision_id: string | null
  base_revision_id: string | null
  remote_commit: string | null
  remote_blob_hash: string | null
  additions: number
  deletions: number
  summary: string
  blocked: number
  created_at: string
  updated_at: string
}

interface SyncChangeListRow extends SyncChangeRow {
  local_version: number | null
  base_version: number | null
  base_commit_hint: string | null
}

interface AssetRow extends AssetRecord {
  deleted_at: string | null
}

interface RemoteFile {
  repoPath: string
  assetPath: string
  content: Buffer
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

interface SkillMeta {
  id: string
  title: string
  description: string
  folder: string
  tags: string[]
  versionLabel: string
  author: string
  category: string
  icon: string
}

interface RemoteAsset {
  kind: AssetKind
  id: string | null
  title: string
  description: string
  folder: string
  slug: string
  tags: string[]
  syncPolicy: SyncPolicy
  mainPath: string
  dirPath: string | null
  files: RemoteFile[]
  manifest: ManifestFile[]
  digest: string
  textFiles: Array<{ path: string; content: string }>
  risk: SyncRisk[]
  blocked: boolean
  promptModel: ReturnType<typeof parsePromptFile>['model']
  contractModel: ReturnType<typeof parseContractFile>['model']
  mcpModel: ReturnType<typeof parseMcpFile>['model']
  skillModel: SkillMeta | null
}

interface RepositoryScan {
  head: string
  assets: RemoteAsset[]
  malformed: Array<{ path: string; reason: string }>
  duplicateIds: Array<{ id: string; paths: string[] }>
  scripts: Array<{ path: string; kind: string }>
  findings: ScanFinding[]
  warnings: string[]
}

interface RepoWrite {
  assetId: string
  repoPath: string
  content: Buffer
  isExecutable: boolean
  skillDir: string | null
}

interface AheadCacheEntry {
  at: number
  head: string | null
  remote: string | null
  ahead: number
  behind: number
}

function loadRepo(ctx: AppContext): RepoRow | null {
  const row = ctx.db.prepare('SELECT * FROM repos ORDER BY created_at LIMIT 1').get() as
    | RepoRow
    | undefined
  return row ?? null
}

function requireRepo(ctx: AppContext): RepoRow {
  const repo = loadRepo(ctx)
  if (!repo) throw new AppError('NOT_FOUND', 'No repository is connected to this workspace.')
  return repo
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function layoutOf(repo: RepoRow): RepoLayout {
  const parsed = parseJson<Partial<RepoLayout>>(repo.layout_json, {})
  return sanitizeLayout(parsed)
}

function policiesOf(repo: RepoRow): RepoPolicies {
  const parsed = parseJson<Partial<RepoPolicies>>(repo.policies_json, {})
  return {
    prompts: parsed.prompts !== false,
    contracts: parsed.contracts !== false,
    skills: parsed.skills !== false,
    mcp: parsed.mcp !== false,
  }
}

function policyEnabled(policies: RepoPolicies, kind: AssetKind): boolean {
  return policies[KIND_POLICY_KEY[kind]]
}

function kindDomain(kind: AssetKind): 'prompts' | 'contracts' | 'skills' | 'mcp' {
  return KIND_DOMAIN[kind]
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error
  return new AppError(
    'INTERNAL',
    error instanceof Error ? error.message : 'An unexpected internal error occurred.',
  )
}

function shortHash(value: string | null | undefined): string | null {
  return value ? value.slice(0, 8) : null
}

function nowMs(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function sanitizeLayout(input: Partial<RepoLayout> | undefined): RepoLayout {
  const layout: RepoLayout = {
    prompts: normalizeFolder(input?.prompts ?? DEFAULT_LAYOUT.prompts),
    contracts: normalizeFolder(input?.contracts ?? DEFAULT_LAYOUT.contracts),
    skills: normalizeFolder(input?.skills ?? DEFAULT_LAYOUT.skills),
    mcp: normalizeFolder(input?.mcp ?? DEFAULT_LAYOUT.mcp),
  }
  const values = Object.values(layout)
  if (new Set(values).size !== values.length) {
    throw new AppError('VALIDATION', 'Each asset type needs a different repository directory.')
  }
  for (const [kind, root] of Object.entries(layout)) {
    if (!root || !isSafeRelativePath(root)) {
      throw new AppError('VALIDATION', `The repository directory for ${kind} must be a relative path.`)
    }
    const folderError = validateFolder(root)
    if (folderError) {
      throw new AppError('VALIDATION', `The repository directory for ${kind} is not valid: ${folderError}`)
    }
  }
  for (const outer of values) {
    for (const inner of values) {
      if (outer === inner) continue
      if (inner.startsWith(`${outer}/`)) {
        throw new AppError('VALIDATION', 'Repository directories must not be nested inside each other.')
      }
    }
  }
  return layout
}

function sanitizePolicies(input: Partial<RepoPolicies> | undefined, base?: RepoPolicies): RepoPolicies {
  const merged = { ...(base ?? DEFAULT_POLICIES), ...(input ?? {}) }
  return {
    prompts: merged.prompts !== false,
    contracts: merged.contracts !== false,
    skills: merged.skills !== false,
    mcp: merged.mcp !== false,
  }
}

function isValidBranchName(value: string): boolean {
  if (!value || value.length > 200) return false
  if (/[\s~^:?*[\\\u0000-\u001f]/.test(value)) return false
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) {
    return false
  }
  return !(value.includes('..') || value.includes('@{') || value.includes('//'))
}

interface RepoUrlInfo {
  url: string
  provider: RepoProvider
  host: string
  owner: string
  repo: string
}

function parseRepoUrl(raw: string, providerHint?: RepoProvider): RepoUrlInfo {
  const value = raw.trim()
  if (!value) throw new AppError('VALIDATION', 'A repository URL is required.')
  if (/[\u0000-\u001f\s]/.test(value)) {
    throw new AppError('VALIDATION', 'The repository URL must not contain whitespace or control characters.')
  }

  // Local repositories are accepted so tests and offline mirrors can use a
  // bare repository. They cannot carry credentials or cross a remote boundary.
  if (isAbsolute(value) || value.startsWith('file:')) {
    const localPath = value.startsWith('file:')
      ? value.slice('file:'.length).replace(/^\/\//, '/')
      : value
    if (!localPath || !isAbsolute(localPath)) {
      throw new AppError('VALIDATION', 'The local repository URL must contain an absolute path.')
    }
    return {
      url: value,
      provider: 'generic',
      host: 'local',
      owner: '',
      repo: basename(localPath),
    }
  }

  // scp-like SSH syntax: git@host:owner/repo.git
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([^\s]+)$/.exec(value)
  if (scp) {
    const ownerRepo = scp[3].replace(/\.git$/, '')
    const [owner, repo] = ownerRepo.split('/')
    if (!owner || !repo) throw new AppError('VALIDATION', 'The repository URL is not valid.')
    return {
      url: `${scp[1]}@${scp[2]}:${scp[3]}`,
      provider: detectProvider(scp[2], providerHint),
      host: scp[2],
      owner,
      repo,
    }
  }

  // owner/repo shorthand expands only for a known provider.
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes('://')) {
    if (providerHint === 'github') {
      return parseRepoUrl(`https://github.com/${value.replace(/\.git$/, '')}.git`, 'github')
    }
    if (providerHint === 'gitlab') {
      return parseRepoUrl(`https://gitlab.com/${value.replace(/\.git$/, '')}.git`, 'gitlab')
    }
    throw new AppError('VALIDATION', 'Use a full HTTPS or SSH repository URL.')
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AppError('VALIDATION', 'The repository URL is not valid. Use an HTTPS or SSH URL.')
  }
  if (parsed.protocol === 'http:') {
    throw new AppError('VALIDATION', 'The repository URL must use HTTPS or SSH, not plain HTTP.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
    throw new AppError('VALIDATION', 'The repository URL must use HTTPS or SSH.')
  }
  if (parsed.password) {
    throw new AppError('VALIDATION', 'The repository URL must not contain a password or token.')
  }
  if (parsed.protocol === 'https:' && parsed.username) {
    throw new AppError('VALIDATION', 'The repository URL must not contain credentials.')
  }
  if (!parsed.hostname) throw new AppError('VALIDATION', 'The repository URL is missing a host.')
  const segments = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/')
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new AppError('VALIDATION', 'The repository URL must include an owner and a repository name.')
  }
  return {
    url: value,
    provider: detectProvider(parsed.hostname, providerHint),
    host: parsed.hostname,
    owner: segments[0],
    repo: segments[1],
  }
}

function detectProvider(host: string, hint?: RepoProvider): RepoProvider {
  if (hint) return hint
  if (/github/i.test(host)) return 'github'
  if (/gitlab/i.test(host)) return 'gitlab'
  return 'generic'
}

function isInsideAppBundle(path: string): boolean {
  const candidate = resolve(path)
  if (!process.resourcesPath) return false
  const roots = uniqueStrings([process.resourcesPath, dirname(process.execPath)])
  return roots.some((root) => isPathInside(root, candidate) || resolve(root) === candidate)
}

function managedRepoId(url: string, branch: string): string {
  return `repo_${sha256Hex(`${url}\n${branch}`).slice(0, 16)}`
}

function previewTokenFor(input: {
  url: string
  branch: string
  localPath: string
  mode: 'managed' | 'bound'
  head: string | null
}): string {
  return sha256Hex(
    JSON.stringify({
      url: input.url,
      branch: input.branch,
      localPath: input.localPath,
      mode: input.mode,
      head: input.head,
    }),
  )
}

function safeSlug(value: string): string {
  const trimmed = value.trim()
  if (trimmed && isSafeFileName(trimmed) && !trimmed.includes('/')) return trimmed
  return slugify(trimmed, 'asset')
}

function uniqueSlug(
  ctx: AppContext,
  kind: AssetKind,
  folder: string,
  desired: string,
  excludeId?: string,
): string {
  const base = safeSlug(desired)
  let candidate = base
  let suffix = 2
  while (true) {
    const row = ctx.db
      .prepare('SELECT id FROM assets WHERE kind = ? AND folder = ? AND slug = ?')
      .get(kind, folder, candidate) as { id: string } | undefined
    if (!row || row.id === excludeId) return candidate
    candidate = `${base}-${suffix++}`
  }
}

function assetRepoPath(ctx: AppContext, layout: RepoLayout, asset: AssetRecord): string {
  return ctx.assets.repoPathForLayout(asset, layout[KIND_ROOT_KEY[asset.kind]])
}

function fileStem(path: string, suffixes: string[]): string {
  const name = basename(path)
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length)
  }
  return name
}

function folderFromRepoPath(root: string, path: string): string {
  const relative = path.slice(root.length + 1)
  const dir = dirname(relative)
  return normalizeFolder(dir === '.' ? '' : dir)
}

function skillFolderFromDirPath(root: string, dirPath: string): string {
  const relative = dirPath.slice(root.length + 1)
  const dir = dirname(relative)
  return normalizeFolder(dir === '.' ? '' : dir)
}

/* ------------------------------------------------------------------ */
/* Authentication and status                                           */
/* ------------------------------------------------------------------ */

function sshKeySettingKey(repoId: string): string {
  return `repo.sshKeyPath.${repoId}`
}

function fetchErrorSettingKey(repoId: string): string {
  return `repo.fetchError.${repoId}`
}

function loadFetchError(ctx: AppContext, repoId: string): RepoStatus['fetchError'] {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(fetchErrorSettingKey(repoId)) as
    | { value_json: string }
    | undefined
  if (!row) return undefined
  try {
    const parsed = JSON.parse(row.value_json) as {
      code?: IpcErrorCode
      message?: string
      retryable?: boolean
    }
    if (!parsed.code || !parsed.message) return undefined
    return { code: parsed.code, message: parsed.message, retryable: !!parsed.retryable }
  } catch {
    return undefined
  }
}

function storeFetchError(ctx: AppContext, repoId: string, error: AppError): void {
  setSetting(ctx, fetchErrorSettingKey(repoId), {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  })
}

function clearFetchError(ctx: AppContext, repoId: string): void {
  ctx.db.prepare('DELETE FROM settings WHERE key = ?').run(fetchErrorSettingKey(repoId))
}

function hasRepoToken(ctx: AppContext, repoId: string): boolean {
  try {
    return ctx.secrets.has('git_token', repoId, 'token')
  } catch {
    return false
  }
}

function readSshKeyPath(ctx: AppContext, repoId: string): string | null {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(sshKeySettingKey(repoId)) as
    | { value_json: string }
    | undefined
  if (!row) return null
  try {
    const value = JSON.parse(row.value_json) as unknown
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

function authForRepo(ctx: AppContext, repo: RepoRow): GitAuth {
  if (repo.auth_mode === 'token') {
    if (!ctx.secrets.available()) {
      throw new AppError(
        'UNSUPPORTED',
        'Secure secret storage is unavailable, so the repository token cannot be read.',
        { kind: 'unsupported', feature: 'safeStorage', reason: 'unavailable' },
      )
    }
    const token = ctx.secrets.get('git_token', repo.id, 'token')
    if (!token) {
      throw new AppError('GIT_AUTH', 'The repository token is missing. Save the token again.')
    }
    return { mode: 'token', token }
  }
  if (repo.auth_mode === 'ssh') {
    return { mode: 'ssh', sshKeyPath: readSshKeyPath(ctx, repo.id) }
  }
  return { mode: 'credential' }
}

function isSyncOperationType(type: OperationType): boolean {
  return type === 'sync_fetch' || type === 'sync_pull' || type === 'sync_push'
}

/* ------------------------------------------------------------------ */
/* Remote parsing                                                      */
/* ------------------------------------------------------------------ */

function parseSkillFile(
  text: string,
  sourcePath: string,
  dirName: string,
): { meta: SkillMeta | null; error?: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  let frontmatter: Record<string, unknown> = {}
  if (normalized.startsWith('---\n')) {
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
    if (!match) return { meta: null, error: 'The SKILL.md frontmatter is not terminated.' }
    try {
      const parsed = parseYaml(match[1])
      if (parsed !== null && parsed !== undefined) {
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { meta: null, error: 'The SKILL.md frontmatter must be a YAML mapping.' }
        }
        frontmatter = parsed as Record<string, unknown>
      }
    } catch (error) {
      return {
        meta: null,
        error: `Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : 'unknown error'}`,
      }
    }
  }
  if (!text.trim()) return { meta: null, error: 'The SKILL.md file is empty.' }

  const asString = (key: string): string => {
    const value = frontmatter[key]
    return typeof value === 'string' ? value.trim() : ''
  }
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  const title = asString('title') || asString('name') || dirName
  if (!title) return { meta: null, error: 'The skill has no title and no directory name.' }

  return {
    meta: {
      id: asString('id'),
      title,
      description: asString('description'),
      folder: normalizeFolder(asString('folder')),
      tags,
      versionLabel: asString('version') || '1.0.0',
      author: asString('author'),
      category: asString('category'),
      icon: asString('icon'),
    },
  }
}

function manifestDigest(files: ManifestFile[]): string {
  return sha256Hex(canonicalManifestJson(files))
}

function textBudget(files: Array<{ path: string; content: string }>): string {
  let budget = MAX_DIFF_TEXT_CHARS
  const parts: string[] = []
  for (const file of files) {
    if (budget <= 0) break
    const text = file.content.slice(0, budget)
    parts.push(text)
    budget -= text.length
  }
  return parts.join('\n')
}

function scanTextFiles(
  kind: AssetKind,
  files: Array<{ path: string; content: string }>,
): ScanFinding[] {
  if (!files.length) return []
  return scanFiles(files, kind === 'mcp' ? '${VAR}' : '{{variable}}')
}

function buildRemoteAsset(input: {
  kind: AssetKind
  root: string
  mainPath: string
  dirPath: string | null
  files: RepoFileInput[]
  slugHint: string
  folderHint: string
}): { asset: RemoteAsset | null; error?: string } {
  const { kind, mainPath, files } = input
  if (!files.length) return { asset: null, error: 'The asset has no files.' }
  const main = files.find((file) => file.repoPath === mainPath)
  if (!main) return { asset: null, error: 'The main repository file is missing.' }

  const manifest: ManifestFile[] = files.map((file) => ({
    path: file.assetPath,
    blobHash: sha256Hex(file.content),
    size: file.content.length,
    mediaKind: file.mediaKind,
    isExecutable: file.isExecutable,
  }))
  const digest = manifestDigest(manifest)
  const textFiles = files
    .filter((file) => file.mediaKind === 'text')
    .map((file) => ({ path: file.assetPath, content: file.content.toString('utf8') }))
  const findings = scanTextFiles(kind, textFiles)
  const highFindings = findings.some((finding) => finding.confidence === 'high')
  const risk: SyncRisk[] = []
  if (kind === 'skill') {
    if (files.some((file) => file.isExecutable || isScriptFile(file.assetPath, file.content.toString('utf8')))) {
      risk.push('scripts')
    }
  }
  if (highFindings) risk.push('secrets')

  const mainText = main.content.toString('utf8')
  const slug = safeSlug(input.slugHint)

  if (kind === 'prompt') {
    const parsed = parsePromptFile(mainText, mainPath)
    if (!parsed.model) return { asset: null, error: parsed.error ?? 'Invalid prompt file.' }
    const folder = normalizeFolder(parsed.model.folder)
    const folderError = validateFolder(folder)
    if (folderError) return { asset: null, error: `Invalid prompt folder: ${folderError}` }
    return {
      asset: {
        kind,
        id: parsed.model.id || null,
        title: parsed.model.title,
        description: parsed.model.description,
        folder,
        slug,
        tags: parsed.model.tags,
        syncPolicy: parsed.model.syncPolicy,
        mainPath,
        dirPath: null,
        files,
        manifest,
        digest,
        textFiles,
        risk,
        blocked: highFindings,
        promptModel: parsed.model,
        contractModel: null,
        mcpModel: null,
        skillModel: null,
      },
    }
  }
  if (kind === 'contract') {
    const parsed = parseContractFile(mainText, mainPath)
    if (!parsed.model) return { asset: null, error: parsed.error ?? 'Invalid contract file.' }
    const folder = normalizeFolder(parsed.model.folder)
    const folderError = validateFolder(folder)
    if (folderError) return { asset: null, error: `Invalid contract folder: ${folderError}` }
    return {
      asset: {
        kind,
        id: parsed.model.id || null,
        title: parsed.model.title,
        description: parsed.model.description,
        folder,
        slug,
        tags: parsed.model.tags,
        syncPolicy: parsed.model.syncPolicy,
        mainPath,
        dirPath: null,
        files,
        manifest,
        digest,
        textFiles,
        risk,
        blocked: highFindings,
        promptModel: null,
        contractModel: parsed.model,
        mcpModel: null,
        skillModel: null,
      },
    }
  }
  if (kind === 'mcp') {
    const parsed = parseMcpFile(mainText, mainPath)
    if (!parsed.model) return { asset: null, error: parsed.error ?? 'Invalid MCP file.' }
    const folder = normalizeFolder(parsed.model.folder)
    const folderError = validateFolder(folder)
    if (folderError) return { asset: null, error: `Invalid MCP folder: ${folderError}` }
    if (parsed.model.transport === 'http' || parsed.model.url) risk.push('network')
    return {
      asset: {
        kind,
        id: parsed.model.id || null,
        title: parsed.model.title,
        description: parsed.model.description,
        folder,
        slug,
        tags: parsed.model.tags,
        syncPolicy: 'inherit',
        mainPath,
        dirPath: null,
        files,
        manifest,
        digest,
        textFiles,
        risk: uniqueStrings(risk) as SyncRisk[],
        blocked: highFindings,
        promptModel: null,
        contractModel: null,
        mcpModel: parsed.model,
        skillModel: null,
      },
    }
  }

  const skillMain = files.find((file) => file.assetPath === 'SKILL.md')
  if (!skillMain) return { asset: null, error: 'The skill directory has no SKILL.md at its root.' }
  const dirName = input.dirPath ? basename(input.dirPath) : input.slugHint
  const parsedSkill = parseSkillFile(skillMain.content.toString('utf8'), mainPath, dirName)
  if (!parsedSkill.meta) return { asset: null, error: parsedSkill.error ?? 'Invalid SKILL.md.' }
  const folder = normalizeFolder(parsedSkill.meta.folder || input.folderHint)
  const folderError = validateFolder(folder)
  if (folderError) return { asset: null, error: `Invalid skill folder: ${folderError}` }
  return {
    asset: {
      kind,
      id: parsedSkill.meta.id || null,
      title: parsedSkill.meta.title,
      description: parsedSkill.meta.description,
      folder,
      slug,
      tags: parsedSkill.meta.tags,
      syncPolicy: 'inherit',
      mainPath,
      dirPath: input.dirPath,
      files,
      manifest,
      digest,
      textFiles,
      risk,
      blocked: highFindings,
      promptModel: null,
      contractModel: null,
      mcpModel: null,
      skillModel: parsedSkill.meta,
    },
  }
}

interface RepoFileInput {
  repoPath: string
  assetPath: string
  content: Buffer
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

async function readRemoteFiles(
  client: GitClient,
  repoPath: string,
  commit: string,
  kind: AssetKind,
  remotePath: string,
  signal?: OperationContext['signal'],
): Promise<{ files: RepoFileInput[]; dirPath: string | null }> {
  if (kind === 'skill') {
    const dirPath = dirname(remotePath)
    const entries = await client.lsTree(repoPath, commit, [dirPath], { signal })
    const blobs = entries.filter((entry) => entry.type === 'blob' && entry.path.startsWith(`${dirPath}/`))
    if (blobs.length > MAX_SCAN_FILES) {
      throw new AppError('VALIDATION', 'The skill contains too many files to read.')
    }
    const files: RepoFileInput[] = []
    let total = 0
    for (const entry of blobs) {
      if (signal?.cancelled) throw new AppError('INTERNAL', 'The operation was cancelled.')
      const content = await client.show(repoPath, commit, entry.path, {
        signal,
        maxOutputBytes: MAX_SINGLE_FILE_BYTES,
      })
      if (!content) continue
      total += content.length
      if (total > MAX_SCAN_BYTES) {
        throw new AppError('VALIDATION', 'The skill is too large to read.')
      }
      const assetPath = entry.path.slice(dirPath.length + 1)
      files.push({
        repoPath: entry.path,
        assetPath,
        content,
        mediaKind: isTextFile(assetPath) ? 'text' : 'binary',
        isExecutable: (Number.parseInt(entry.mode, 8) & 0o111) !== 0,
      })
    }
    return { files, dirPath }
  }
  const content = await client.show(repoPath, commit, remotePath, {
    signal,
    maxOutputBytes: MAX_SINGLE_FILE_BYTES,
  })
  if (!content) return { files: [], dirPath: null }
  return {
    files: [
      {
        repoPath: remotePath,
        assetPath: basename(remotePath),
        content,
        mediaKind: isTextFile(remotePath) ? 'text' : 'binary',
        isExecutable: false,
      },
    ],
    dirPath: null,
  }
}

async function scanRepository(
  client: GitClient,
  repoPath: string,
  commit: string,
  layout: RepoLayout,
  signal?: OperationContext['signal'],
): Promise<RepositoryScan> {
  const roots: Array<{ kind: AssetKind; root: string }> = [
    { kind: 'prompt', root: layout.prompts },
    { kind: 'contract', root: layout.contracts },
    { kind: 'skill', root: layout.skills },
    { kind: 'mcp', root: layout.mcp },
  ]
  const tree = await client.lsTree(
    repoPath,
    commit,
    roots.map((entry) => entry.root),
    { signal },
  )
  const blobs = tree.filter((entry) => entry.type === 'blob')
  if (blobs.length > MAX_SCAN_FILES) {
    throw new AppError(
      'VALIDATION',
      `The repository contains more than ${MAX_SCAN_FILES} files under the configured directories. Narrow the layout roots and retry.`,
    )
  }

  const assets: RemoteAsset[] = []
  const malformed: Array<{ path: string; reason: string }> = []
  const warnings: string[] = []
  const scripts: Array<{ path: string; kind: string }> = []
  const findings: ScanFinding[] = []
  const cache = new Map<string, Buffer>()
  let totalBytes = 0

  const read = async (entry: GitTreeEntry): Promise<Buffer | null> => {
    const cached = cache.get(entry.path)
    if (cached) return cached
    if (signal?.cancelled) throw new AppError('INTERNAL', 'The operation was cancelled.')
    const content = await client.show(repoPath, commit, entry.path, {
      signal,
      maxOutputBytes: MAX_SINGLE_FILE_BYTES,
    })
    if (!content) return null
    totalBytes += content.length
    if (totalBytes > MAX_SCAN_BYTES) {
      throw new AppError('VALIDATION', 'The repository content is too large to scan.')
    }
    cache.set(entry.path, content)
    return content
  }

  const filesFor = async (entries: GitTreeEntry[], dirPath: string | null): Promise<RepoFileInput[]> => {
    const files: RepoFileInput[] = []
    for (const entry of entries) {
      const content = await read(entry)
      if (!content) {
        malformed.push({ path: entry.path, reason: 'The file could not be read.' })
        continue
      }
      const assetPath = dirPath ? entry.path.slice(dirPath.length + 1) : basename(entry.path)
      files.push({
        repoPath: entry.path,
        assetPath,
        content,
        mediaKind: isTextFile(assetPath) ? 'text' : 'binary',
        isExecutable: (Number.parseInt(entry.mode, 8) & 0o111) !== 0,
      })
    }
    return files
  }

  for (const kind of ['prompt', 'contract', 'mcp'] as const) {
    const root = layout[KIND_ROOT_KEY[kind]]
    const suffix = kind === 'prompt' ? '.prompt.md' : kind === 'contract' ? '.contract.md' : '.json'
    const entries = blobs.filter(
      (entry) => entry.path.startsWith(`${root}/`) && entry.path.endsWith(suffix),
    )
    for (const entry of entries) {
      const files = await filesFor([entry], null)
      if (!files.length) continue
      const slugHint = fileStem(entry.path, [suffix])
      const built = buildRemoteAsset({
        kind,
        root,
        mainPath: entry.path,
        dirPath: null,
        files,
        slugHint,
        folderHint: folderFromRepoPath(root, entry.path),
      })
      if (!built.asset) {
        malformed.push({ path: entry.path, reason: built.error ?? 'The asset could not be parsed.' })
        continue
      }
      assets.push(built.asset)
    }
  }

  const skillRoot = layout.skills
  const skillEntries = blobs.filter((entry) => entry.path.startsWith(`${skillRoot}/`))
  const skillDirs = new Set<string>()
  for (const entry of skillEntries) {
    if (basename(entry.path) === 'SKILL.md') skillDirs.add(dirname(entry.path))
  }
  for (const dirPath of skillDirs) {
    const entries = skillEntries.filter((entry) => entry.path.startsWith(`${dirPath}/`))
    const files = await filesFor(entries, dirPath)
    const built = buildRemoteAsset({
      kind: 'skill',
      root: skillRoot,
      mainPath: `${dirPath}/SKILL.md`,
      dirPath,
      files,
      slugHint: basename(dirPath),
      folderHint: skillFolderFromDirPath(skillRoot, dirPath),
    })
    if (!built.asset) {
      malformed.push({ path: dirPath, reason: built.error ?? 'The skill could not be parsed.' })
      continue
    }
    assets.push(built.asset)
    for (const file of built.asset.files) {
      if (file.isExecutable || isScriptFile(file.assetPath, file.content.toString('utf8'))) {
        const extension = file.assetPath.includes('.')
          ? file.assetPath.slice(file.assetPath.lastIndexOf('.') + 1)
          : 'executable'
        scripts.push({ path: file.repoPath, kind: extension || 'executable' })
      }
    }
  }
  const matchedDirs = [...skillDirs]
  for (const entry of skillEntries) {
    if (matchedDirs.some((dir) => entry.path.startsWith(`${dir}/`))) continue
    if (warnings.length < 20) {
      warnings.push(`The file ${entry.path} is outside a skill directory and was ignored.`)
    }
  }

  const byId = new Map<string, string[]>()
  for (const asset of assets) {
    if (!asset.id) continue
    const paths = byId.get(asset.id) ?? []
    paths.push(asset.mainPath)
    byId.set(asset.id, paths)
  }
  const duplicateIds = [...byId.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, paths }))

  for (const asset of assets) {
    findings.push(...scanTextFiles(asset.kind, asset.textFiles))
    if (findings.length > MAX_FINDINGS) break
  }

  for (const entry of roots) {
    if (!blobs.some((blob) => blob.path.startsWith(`${entry.root}/`))) {
      warnings.push(`No files were found under the ${entry.root}/ directory.`)
    }
  }
  if (malformed.length) warnings.push(`${malformed.length} file(s) could not be parsed and will not be imported.`)
  if (duplicateIds.length) warnings.push('Some assets share the same stable ID. Resolve the duplicates before connecting.')
  if (findings.some((finding) => finding.confidence === 'high')) {
    warnings.push('The repository contains likely credentials. Pulled content is blocked until it is replaced with variables.')
  }
  if (scripts.length) warnings.push('This repository contains scripts. Scripts and MCP commands may run on this machine.')

  return {
    head: commit,
    assets,
    malformed,
    duplicateIds,
    scripts,
    findings: findings.slice(0, MAX_FINDINGS),
    warnings: warnings.slice(0, 40),
  }
}

/* ------------------------------------------------------------------ */
/* Manifest / risk helpers                                             */
/* ------------------------------------------------------------------ */

function revisionFiles(ctx: AppContext, revisionId: string): ManifestFile[] {
  try {
    return ctx.assets.revisionFiles(revisionId)
  } catch {
    return []
  }
}

function revisionText(ctx: AppContext, revisionId: string): string {
  const files: Array<{ path: string; content: string }> = []
  for (const file of revisionFiles(ctx, revisionId)) {
    if (file.mediaKind !== 'text') continue
    try {
      files.push({ path: file.path, content: ctx.blobs.readSync(file.blobHash).toString('utf8') })
    } catch {
      // A missing blob surfaces as an empty diff, not as a sync crash here.
    }
  }
  return textBudget(files)
}

function assetRisk(ctx: AppContext, asset: AssetRecord, revisionId: string): SyncRisk[] {
  const risk: SyncRisk[] = []
  const files: Array<{ path: string; content: string }> = []
  for (const file of revisionFiles(ctx, revisionId)) {
    if (file.mediaKind !== 'text') continue
    try {
      files.push({ path: file.path, content: ctx.blobs.readSync(file.blobHash).toString('utf8') })
    } catch {
      continue
    }
  }
  if (
    scanFiles(files, asset.kind === 'mcp' ? '${VAR}' : '{{variable}}').some(
      (finding) => finding.confidence === 'high',
    )
  ) {
    risk.push('secrets')
  }
  if (
    asset.kind === 'skill' &&
    revisionFiles(ctx, revisionId).some((file) => isScriptFile(file.path))
  ) {
    risk.push('scripts')
  }
  if (asset.kind === 'mcp') {
    const row = ctx.db
      .prepare('SELECT transport, url FROM mcp_servers WHERE asset_id = ?')
      .get(asset.id) as { transport: string; url: string | null } | undefined
    if (row && (row.transport === 'http' || !!row.url)) risk.push('network')
  }
  return uniqueStrings(risk) as SyncRisk[]
}

/* ------------------------------------------------------------------ */
/* Import / apply remote assets                                        */
/* ------------------------------------------------------------------ */

function defaultSyncPolicyFor(kind: AssetKind, policies: RepoPolicies, repoPolicy: SyncPolicy): SyncPolicy {
  if (!policyEnabled(policies, kind)) return 'local'
  return repoPolicy === 'local' ? 'local' : 'inherit'
}

function insertAssetExact(
  ctx: AppContext,
  input: {
    id: string
    kind: AssetKind
    title: string
    slug: string
    folder: string
    description: string
    tags: string[]
    syncPolicy: SyncPolicy
  },
): AssetRecord {
  const at = nowIso()
  const tx = ctx.db.transaction(() => {
    ctx.db
      .prepare(
        'INSERT INTO assets (id, kind, title, slug, folder, description, sync_policy, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.id,
        input.kind,
        input.title.trim(),
        input.slug,
        input.folder,
        input.description,
        input.syncPolicy,
        'git',
        at,
        at,
      )
    ctx.assets.replaceTags(input.id, input.tags)
  })
  tx()
  return ctx.assets.getAsset(input.id)
}

function updateAssetExact(
  ctx: AppContext,
  asset: AssetRecord,
  input: {
    title: string
    slug: string
    folder: string
    description: string
    tags: string[]
  },
): AssetRecord {
  const folderError = validateFolder(input.folder)
  if (folderError) throw new AppError('VALIDATION', folderError)
  const tx = ctx.db.transaction(() => {
    ctx.db
      .prepare(
        'UPDATE assets SET title = ?, slug = ?, folder = ?, description = ?, source = ?, updated_at = ? WHERE id = ?',
      )
      .run(input.title.trim(), input.slug, input.folder, input.description, 'git', nowIso(), asset.id)
    ctx.assets.replaceTags(asset.id, input.tags)
  })
  tx()
  ctx.assets.reindex(asset.id)
  return ctx.assets.getAsset(asset.id)
}

function fieldMapToJson(
  fields: Record<string, { value: string; secret: boolean }>,
): { json: Record<string, string | { $secret: string }>; required: string[] } {
  const json: Record<string, string | { $secret: string }> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(fields)) {
    if (!field.secret) {
      json[key] = field.value
      continue
    }
    if (isPlaceholder(field.value)) {
      // Placeholders are safe at rest and keep the canonical file round-trippable.
      json[key] = field.value
      required.push(key)
    } else {
      // A real value committed to the repository is dropped from the plaintext
      // column. The change stays blocked until the repository uses a placeholder.
      json[key] = { $secret: '' }
      required.push(key)
    }
  }
  return { json, required }
}

function upsertStructured(ctx: AppContext, assetId: string, remote: RemoteAsset): void {
  if (remote.kind === 'prompt' && remote.promptModel) {
    const model = remote.promptModel
    ctx.db
      .prepare(
        `INSERT INTO prompts (asset_id, system_prompt, user_prompt, variables_json, usage_count, is_favorite, is_pinned)
         VALUES (?, ?, ?, ?, 0, 0, 0)
         ON CONFLICT(asset_id) DO UPDATE SET
           system_prompt = excluded.system_prompt,
           user_prompt = excluded.user_prompt,
           variables_json = excluded.variables_json`,
      )
      .run(assetId, model.systemPrompt, model.userPrompt, JSON.stringify(model.variables))
    return
  }
  if (remote.kind === 'contract' && remote.contractModel) {
    const model = remote.contractModel
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
        model.body,
        model.scope,
        model.pathPrefix,
        JSON.stringify(model.activation),
        model.priority,
        JSON.stringify(model.imports),
        JSON.stringify(model.targetIds),
      )
    return
  }
  if (remote.kind === 'skill' && remote.skillModel) {
    const model = remote.skillModel
    ctx.db
      .prepare(
        `INSERT INTO skills (asset_id, version_label, author, category, icon)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           version_label = excluded.version_label,
           author = excluded.author,
           category = excluded.category,
           icon = excluded.icon`,
      )
      .run(assetId, model.versionLabel, model.author, model.category, model.icon)
    return
  }
  if (remote.kind === 'mcp' && remote.mcpModel) {
    const model = remote.mcpModel
    const env = fieldMapToJson(model.env)
    const headers = fieldMapToJson(model.headers)
    const required = uniqueStrings([...model.requiredEnv, ...env.required, ...headers.required])
    ctx.db
      .prepare(
        `INSERT INTO mcp_servers
           (asset_id, transport, command, args_json, url, env_json, headers_json, required_env_json, enabled, is_favorite, notes, health_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]')
         ON CONFLICT(asset_id) DO UPDATE SET
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           url = excluded.url,
           env_json = excluded.env_json,
           headers_json = excluded.headers_json,
           required_env_json = excluded.required_env_json,
           enabled = excluded.enabled,
           notes = excluded.notes`,
      )
      .run(
        assetId,
        model.transport,
        model.command ?? null,
        JSON.stringify(model.args),
        model.url ?? null,
        JSON.stringify(env.json),
        JSON.stringify(headers.json),
        JSON.stringify(required),
        model.enabled ? 1 : 0,
        model.notes,
      )
  }
}

function upsertBase(
  ctx: AppContext,
  input: {
    repoId: string
    assetId: string
    remotePath: string
    baseCommit: string | null
    baseRevisionId: string | null
    baseManifestHash: string | null
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO repo_assets (repo_id, asset_id, remote_path, base_commit, base_revision_id, base_manifest_hash, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, asset_id) DO UPDATE SET
         remote_path = excluded.remote_path,
         base_commit = excluded.base_commit,
         base_revision_id = excluded.base_revision_id,
         base_manifest_hash = excluded.base_manifest_hash,
         last_synced_at = excluded.last_synced_at`,
    )
    .run(
      input.repoId,
      input.assetId,
      input.remotePath,
      input.baseCommit,
      input.baseRevisionId,
      input.baseManifestHash,
      nowIso(),
    )
}

function importRemoteAsset(
  ctx: AppContext,
  repo: RepoRow,
  policies: RepoPolicies,
  remote: RemoteAsset,
  commit: string | null,
  note: string,
): { asset: AssetRecord; revision: RevisionRecord } {
  const files: NewAssetFile[] = remote.files.map((file) => ({
    path: file.assetPath,
    content: file.content,
    mediaKind: file.mediaKind,
    isExecutable: file.isExecutable,
  }))
  if (!files.length) throw new AppError('VALIDATION', `The ${KIND_LABEL[remote.kind]} has no files.`)

  const existingById = remote.id
    ? (ctx.db.prepare('SELECT * FROM assets WHERE id = ?').get(remote.id) as AssetRow | undefined)
    : undefined
  const baseCollision = ctx.db
    .prepare('SELECT * FROM assets WHERE kind = ? AND folder = ? AND slug = ?')
    .get(remote.kind, remote.folder, remote.slug) as AssetRow | undefined

  // A stable ID always wins. A path collision only records the remote content
  // when the file has no ID or the IDs already agree; otherwise both assets are
  // kept and the import allocates a distinct slug.
  const target: AssetRow | undefined =
    existingById && existingById.kind === remote.kind
      ? existingById
      : baseCollision && (!remote.id || baseCollision.id === remote.id)
        ? baseCollision
        : undefined

  const syncPolicy: SyncPolicy = target
    ? target.syncPolicy
    : defaultSyncPolicyFor(remote.kind, policies, remote.syncPolicy)

  if (!target) {
    const id =
      remote.id && !ctx.db.prepare('SELECT 1 FROM assets WHERE id = ?').get(remote.id)
        ? remote.id
        : newId('ast')
    const slug = uniqueSlug(ctx, remote.kind, remote.folder, remote.slug)
    const asset = insertAssetExact(ctx, {
      id,
      kind: remote.kind,
      title: remote.title,
      slug,
      folder: remote.folder,
      description: remote.description,
      tags: remote.tags,
      syncPolicy,
    })
    const revision = ctx.assets.addRevision(asset.id, files, note)
    upsertStructured(ctx, asset.id, remote)
    upsertBase(ctx, {
      repoId: repo.id,
      assetId: asset.id,
      remotePath: remote.mainPath,
      baseCommit: commit,
      baseRevisionId: revision.id,
      baseManifestHash: revision.manifestHash,
    })
    ctx.events.domainChanged(kindDomain(asset.kind), 'synced', [asset.id])
    return { asset: ctx.assets.getAsset(asset.id), revision }
  }

  const restored = target.deleted_at ? ctx.assets.restoreAsset(target.id) : target
  const slug = uniqueSlug(ctx, remote.kind, remote.folder, remote.slug, restored.id)
  const asset = updateAssetExact(ctx, ctx.assets.getAsset(restored.id), {
    title: remote.title,
    slug,
    folder: remote.folder,
    description: remote.description,
    tags: remote.tags,
  })
  const revision = ctx.assets.addRevision(asset.id, files, note)
  upsertStructured(ctx, asset.id, remote)
  upsertBase(ctx, {
    repoId: repo.id,
    assetId: asset.id,
    remotePath: remote.mainPath,
    baseCommit: commit,
    baseRevisionId: revision.id,
    baseManifestHash: revision.manifestHash,
  })
  ctx.events.domainChanged(kindDomain(asset.kind), 'synced', [asset.id])
  return { asset: ctx.assets.getAsset(asset.id), revision }
}

/* ------------------------------------------------------------------ */
/* Change computation                                                  */
/* ------------------------------------------------------------------ */

interface DesiredChange {
  assetId: string | null
  kind: AssetKind
  name: string
  path: string
  direction: SyncDirection
  change: SyncChangeKind
  risk: SyncRisk[]
  fingerprint: string
  localRevisionId: string | null
  baseRevisionId: string | null
  remoteCommit: string
  remoteBlobHash: string | null
  additions: number
  deletions: number
  summary: string
  blocked: boolean
}

function baseDigestFor(ctx: AppContext, base: RepoAssetRow | null): string | null {
  if (!base) return null
  if (base.base_revision_id) {
    try {
      return ctx.assets.getRevision(base.base_revision_id).manifestHash
    } catch {
      return base.base_manifest_hash
    }
  }
  return base.base_manifest_hash
}

function changeFingerprint(input: {
  repoId: string
  identity: string
  kind: AssetKind
  direction: SyncDirection
  change: SyncChangeKind
  path: string
  localDigest: string | null
  baseDigest: string | null
  remoteDigest: string | null
}): string {
  return sha256Hex(
    [
      input.repoId,
      input.identity,
      input.kind,
      input.direction,
      input.change,
      input.path,
      input.localDigest ?? 'none',
      input.baseDigest ?? 'none',
      input.remoteDigest ?? 'none',
    ].join('|'),
  )
}

function summaryFor(
  direction: SyncDirection,
  change: SyncChangeKind,
  kind: AssetKind,
  name: string,
): string {
  const label = KIND_LABEL[kind]
  if (direction === 'conflict') return `${label} "${name}" changed both locally and in the repository.`
  if (direction === 'incoming') {
    if (change === 'added') return `New ${label.toLowerCase()} "${name}" is available from the repository.`
    if (change === 'deleted') return `The repository deleted ${label.toLowerCase()} "${name}".`
    if (change === 'renamed') return `The repository moved ${label.toLowerCase()} "${name}" to a new path.`
    return `The repository has a newer version of ${label.toLowerCase()} "${name}".`
  }
  if (change === 'added') return `${label} "${name}" is new locally and has not been pushed.`
  if (change === 'renamed') return `${label} "${name}" was renamed locally.`
  return `Local changes to ${label.toLowerCase()} "${name}" have not been pushed.`
}

function reconcileChanges(
  ctx: AppContext,
  repo: RepoRow,
  layout: RepoLayout,
  policies: RepoPolicies,
  scan: RepositoryScan,
  commit: string,
): { incoming: number; outgoing: number; conflicts: number } {
  const duplicateIds = new Set(scan.duplicateIds.map((entry) => entry.id))
  const remoteAssets = scan.assets.filter(
    (asset) => policyEnabled(policies, asset.kind) && !(asset.id && duplicateIds.has(asset.id)),
  )

  const baseRows = ctx.db
    .prepare('SELECT * FROM repo_assets WHERE repo_id = ?')
    .all(repo.id) as RepoAssetRow[]
  const baseByAsset = new Map(baseRows.map((row) => [row.asset_id, row]))
  const baseByPath = new Map(baseRows.map((row) => [row.remote_path, row]))

  const allAssets = ctx.db
    .prepare("SELECT * FROM assets WHERE deleted_at IS NULL OR id IN (SELECT asset_id FROM repo_assets WHERE repo_id = ?)")
    .all(repo.id) as AssetRow[]
  const assetById = new Map(allAssets.map((row) => [row.id, row]))
  const localByPath = new Map<string, AssetRow>()
  for (const asset of allAssets) {
    if (asset.deleted_at) continue
    if (!policyEnabled(policies, asset.kind)) continue
    if (asset.syncPolicy === 'local') continue
    localByPath.set(assetRepoPath(ctx, layout, asset), asset)
  }

  // Resolve remote assets to local identities where possible.
  const remoteForIdentity = new Map<string, RemoteAsset>()
  const remoteOnly: RemoteAsset[] = []
  const claimedRemote = new Set<RemoteAsset>()
  for (const remote of remoteAssets) {
    let identity: string | null = null
    if (remote.id && assetById.has(remote.id)) identity = remote.id
    if (!identity && baseByPath.has(remote.mainPath)) identity = baseByPath.get(remote.mainPath)!.asset_id
    if (!identity && localByPath.has(remote.mainPath)) identity = localByPath.get(remote.mainPath)!.id
    if (identity) {
      if (!remoteForIdentity.has(identity)) {
        remoteForIdentity.set(identity, remote)
        claimedRemote.add(remote)
      }
    }
  }
  for (const remote of remoteAssets) {
    if (!claimedRemote.has(remote)) remoteOnly.push(remote)
  }

  const desired = new Map<string, DesiredChange>()
  const add = (change: DesiredChange): void => {
    if (!desired.has(change.fingerprint)) desired.set(change.fingerprint, change)
  }

  const consider = (
    identity: string,
    asset: AssetRow | null,
    base: RepoAssetRow | null,
    remote: RemoteAsset | null,
  ): void => {
    if (!asset && !base && !remote) return
    const kind: AssetKind = asset?.kind ?? remote?.kind ?? (base ? (baseKind(ctx, base) ?? 'prompt') : 'prompt')
    if (!policyEnabled(policies, kind)) return

    const active = !!asset && !asset.deleted_at
    if (active && asset.syncPolicy === 'local') return
    const participates = active
    const localPath = asset ? assetRepoPath(ctx, layout, asset) : null
    const basePath = base?.remote_path ?? null
    const remotePath = remote?.mainPath ?? null
    const baseDigest = baseDigestFor(ctx, base)
    const hasBase = !!base && (base.base_revision_id !== null || base.base_manifest_hash !== null)
    const revision = participates && asset ? ctx.assets.currentRevisionOrNull(asset.id) : null
    const localDigest = revision?.manifestHash ?? null
    if (participates && !revision) return
    const name = asset?.title ?? remote?.title ?? identity
    const localRisk = participates && asset && revision ? assetRisk(ctx, asset, revision.id) : []
    const remoteRisk = remote?.risk ?? []
    const remoteText = remote ? textBudget(remote.textFiles) : ''
    const localText = revision ? revisionText(ctx, revision.id) : ''
    const baseText = base?.base_revision_id ? revisionText(ctx, base.base_revision_id) : ''

    const emit = (
      direction: SyncDirection,
      change: SyncChangeKind,
      path: string,
      additions: number,
      deletions: number,
      risk: SyncRisk[],
      blocked: boolean,
    ): void => {
      const fingerprint = changeFingerprint({
        repoId: repo.id,
        identity,
        kind,
        direction,
        change,
        path,
        localDigest,
        baseDigest,
        remoteDigest: remote?.digest ?? null,
      })
      add({
        assetId: asset?.id ?? null,
        kind,
        name,
        path,
        direction,
        change,
        risk,
        fingerprint,
        localRevisionId: revision?.id ?? null,
        baseRevisionId: base?.base_revision_id ?? null,
        remoteCommit: commit,
        remoteBlobHash: remote?.digest ?? null,
        additions,
        deletions,
        summary: summaryFor(direction, change, kind, name),
        blocked,
      })
    }

    if (!hasBase) {
      if (participates && remote) {
        if (localDigest === remote.digest) return
        const stats = diffStats(localText, remoteText)
        emit(
          'conflict',
          'modified',
          remotePath ?? localPath ?? '',
          stats.additions,
          stats.deletions,
          uniqueStrings([...localRisk, ...remoteRisk]) as SyncRisk[],
          remote.blocked,
        )
        return
      }
      if (participates) {
        const stats = diffStats('', localText)
        emit('outgoing', 'added', localPath ?? '', stats.additions, stats.deletions, localRisk, false)
        return
      }
      if (remote) {
        const stats = diffStats('', remoteText)
        emit('incoming', 'added', remotePath ?? '', stats.additions, stats.deletions, remoteRisk, remote.blocked)
      }
      return
    }

    if (participates) {
      if (remote) {
        const localChanged = localDigest !== baseDigest
        const remoteChanged = remote.digest !== baseDigest
        if (!localChanged && !remoteChanged) return
        if (localChanged && !remoteChanged) {
          const renamed = !!basePath && localPath !== basePath
          const change: SyncChangeKind = renamed ? 'renamed' : 'modified'
          const stats = diffStats(baseText, localText)
          emit('outgoing', change, localPath ?? '', stats.additions, stats.deletions, localRisk, false)
          return
        }
        if (!localChanged && remoteChanged) {
          const renamed = !!basePath && remotePath !== basePath
          const change: SyncChangeKind = renamed ? 'renamed' : 'modified'
          const stats = diffStats(baseText, remoteText)
          emit('incoming', change, remotePath ?? '', stats.additions, stats.deletions, remoteRisk, remote.blocked)
          return
        }
        if (localDigest === remote.digest) return
        const stats = diffStats(localText, remoteText)
        emit(
          'conflict',
          'modified',
          remotePath ?? localPath ?? '',
          stats.additions,
          stats.deletions,
          uniqueStrings([...localRisk, ...remoteRisk]) as SyncRisk[],
          remote.blocked,
        )
        return
      }
      // The remote file was deleted and the local asset still exists.
      if (localDigest === baseDigest) {
        const stats = diffStats(baseText, '')
        emit('incoming', 'deleted', basePath ?? localPath ?? '', 0, stats.deletions, remoteRisk, false)
      } else {
        const stats = diffStats(localText, '')
        emit('conflict', 'deleted', basePath ?? localPath ?? '', stats.additions, stats.deletions, localRisk, false)
      }
      return
    }

    // The local asset is soft-deleted or missing. A remote file keeps existing,
    // so surface it as an incoming change. Local deletion never deletes remote
    // content in the MVP.
    if (asset && active) return
    if (remote) {
      const change: SyncChangeKind = remote.digest === baseDigest ? 'added' : 'modified'
      const stats = diffStats(baseText, remoteText)
      emit(
        'incoming',
        change,
        remote.mainPath,
        change === 'added' ? diffStats('', remoteText).additions : stats.additions,
        change === 'added' ? 0 : stats.deletions,
        remoteRisk,
        remote.blocked,
      )
    }
  }

  const seen = new Set<string>()
  for (const base of baseRows) {
    const asset = assetById.get(base.asset_id) ?? null
    const kind: AssetKind = asset?.kind ?? baseKind(ctx, base) ?? 'prompt'
    if (!policyEnabled(policies, kind)) continue
    const remote = remoteForIdentity.get(base.asset_id) ?? null
    seen.add(base.asset_id)
    consider(base.asset_id, asset, base, remote)
  }
  for (const asset of allAssets) {
    if (asset.deleted_at) continue
    if (!policyEnabled(policies, asset.kind)) continue
    if (baseByAsset.has(asset.id)) continue
    const remote = remoteForIdentity.get(asset.id) ?? null
    seen.add(asset.id)
    consider(asset.id, asset, null, remote)
  }
  for (const remote of remoteOnly) {
    const identity = remote.id ?? `path:${remote.kind}:${remote.mainPath}`
    if (seen.has(identity)) continue
    consider(identity, null, null, remote)
  }

  const tx = ctx.db.transaction(() => {
    const existing = ctx.db
      .prepare("SELECT id, fingerprint FROM sync_changes WHERE repo_id = ? AND status IN ('open','reviewed')")
      .all(repo.id) as Array<{ id: string; fingerprint: string }>
    for (const row of existing) {
      if (!desired.has(row.fingerprint)) {
        ctx.db.prepare('DELETE FROM sync_changes WHERE id = ?').run(row.id)
      }
    }
    const at = nowIso()
    for (const change of desired.values()) {
      const id = `chg_${sha256Hex(change.fingerprint).slice(0, 20)}`
      ctx.db
        .prepare(
          `INSERT INTO sync_changes
             (id, repo_id, asset_id, asset_kind, asset_name, remote_path, direction, change_kind, status,
              risk_json, fingerprint, local_revision_id, base_revision_id, remote_commit, remote_blob_hash,
              additions, deletions, summary, blocked, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
             asset_id = excluded.asset_id,
             asset_kind = excluded.asset_kind,
             asset_name = excluded.asset_name,
             remote_path = excluded.remote_path,
             direction = excluded.direction,
             change_kind = excluded.change_kind,
             risk_json = excluded.risk_json,
             local_revision_id = excluded.local_revision_id,
             base_revision_id = excluded.base_revision_id,
             remote_commit = excluded.remote_commit,
             remote_blob_hash = excluded.remote_blob_hash,
             additions = excluded.additions,
             deletions = excluded.deletions,
             summary = excluded.summary,
             blocked = excluded.blocked,
             updated_at = excluded.updated_at
           WHERE sync_changes.status IN ('open', 'reviewed')`,
        )
        .run(
          id,
          repo.id,
          change.assetId,
          change.kind,
          change.name,
          change.path,
          change.direction,
          change.change,
          JSON.stringify(change.risk),
          change.fingerprint,
          change.localRevisionId,
          change.baseRevisionId,
          change.remoteCommit,
          change.remoteBlobHash,
          change.additions,
          change.deletions,
          change.summary,
          change.blocked ? 1 : 0,
          at,
          at,
        )
    }
  })
  tx()

  const counts = ctx.db
    .prepare(
      "SELECT direction, COUNT(*) AS count FROM sync_changes WHERE repo_id = ? AND status IN ('open','reviewed') GROUP BY direction",
    )
    .all(repo.id) as Array<{ direction: SyncDirection; count: number }>
  return {
    incoming: counts.find((row) => row.direction === 'incoming')?.count ?? 0,
    outgoing: counts.find((row) => row.direction === 'outgoing')?.count ?? 0,
    conflicts: counts.find((row) => row.direction === 'conflict')?.count ?? 0,
  }
}

function baseKind(ctx: AppContext, base: RepoAssetRow): AssetKind | null {
  const row = ctx.db.prepare('SELECT kind FROM assets WHERE id = ?').get(base.asset_id) as
    | { kind: AssetKind }
    | undefined
  return row?.kind ?? null
}

/* ------------------------------------------------------------------ */
/* Change row mapping                                                  */
/* ------------------------------------------------------------------ */

function riskOf(row: SyncChangeRow): SyncRisk[] {
  try {
    const parsed = JSON.parse(row.risk_json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is SyncRisk =>
        value === 'scripts' || value === 'secrets' || value === 'network',
    )
  } catch {
    return []
  }
}

function blockReasonOf(row: SyncChangeRow): string | undefined {
  if (!row.blocked) return undefined
  if (riskOf(row).includes('secrets')) {
    return 'High-confidence credential findings were detected in the incoming content.'
  }
  return 'Blocked by the repository security policy.'
}

function changeSummary(ctx: AppContext, row: SyncChangeListRow): SyncChangeSummary {
  return {
    id: row.id,
    kind: row.asset_kind,
    assetId: row.asset_id,
    assetName: row.asset_name,
    path: row.remote_path,
    change: row.change_kind,
    direction: row.direction,
    status: row.status,
    risk: riskOf(row),
    summary: row.summary,
    additions: row.additions,
    deletions: row.deletions,
    blocked: !!row.blocked,
    ...(blockReasonOf(row) ? { blockReason: blockReasonOf(row) } : {}),
    fingerprint: row.fingerprint,
    remoteVersion: shortHash(row.remote_commit),
    localVersion: row.local_version !== null ? `v${row.local_version}` : null,
    baseVersion: row.base_version !== null ? `v${row.base_version}` : shortHash(row.base_commit_hint),
    ...(row.status === 'reviewed' ? { reviewedAt: row.updated_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/* ------------------------------------------------------------------ */
/* Change detail                                                       */
/* ------------------------------------------------------------------ */

const DETAIL_REDACTIONS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp_|github_pat_|glpat-)[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk_live_[0-9A-Za-z]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  /\bAuthorization\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
]

function redactDetail(text: string): string {
  let out = text
  for (const pattern of DETAIL_REDACTIONS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]')
  }
  return out
}

function sideText(content: Buffer | null): { text: string | null; truncated: boolean } {
  if (!content) return { text: null, truncated: false }
  const decoded = content.toString('utf8')
  const { text, truncated } = truncateText(decoded, MAX_DETAIL_TEXT_BYTES)
  return { text: redactDetail(text), truncated }
}

interface FileSide {
  assetPath: string
  content: Buffer
  mediaKind: 'text' | 'binary'
}

function localSides(ctx: AppContext, revisionId: string | null): FileSide[] {
  if (!revisionId) return []
  const sides: FileSide[] = []
  for (const file of revisionFiles(ctx, revisionId)) {
    try {
      sides.push({
        assetPath: file.path,
        content: ctx.blobs.readSync(file.blobHash),
        mediaKind: file.mediaKind,
      })
    } catch {
      continue
    }
  }
  return sides
}

async function remoteSides(
  client: GitClient,
  repoPath: string,
  commit: string | null,
  kind: AssetKind,
  remotePath: string | null,
  signal?: OperationContext['signal'],
): Promise<FileSide[]> {
  if (!commit || !remotePath) return []
  const files = await readRemoteFiles(client, repoPath, commit, kind, remotePath, signal)
  return files.files.map((file) => ({
    assetPath: file.assetPath,
    content: file.content,
    mediaKind: file.mediaKind,
  }))
}

function detailFiles(
  kind: AssetKind,
  changeKind: SyncChangeKind,
  base: FileSide[],
  local: FileSide[],
  remote: FileSide[],
): SyncFileDiff[] {
  if (kind !== 'skill') {
    const baseFile = base[0]
    const localFile = local[0]
    const remoteFile = remote[0]
    const anyBinary = [baseFile, localFile, remoteFile].some(
      (file) => file && file.mediaKind === 'binary',
    )
    const path = remoteFile?.assetPath ?? localFile?.assetPath ?? baseFile?.assetPath ?? 'file'
    const baseText = anyBinary ? { text: null, truncated: false } : sideText(baseFile?.content ?? null)
    const localText = anyBinary ? { text: null, truncated: false } : sideText(localFile?.content ?? null)
    const remoteText = anyBinary ? { text: null, truncated: false } : sideText(remoteFile?.content ?? null)
    return [
      {
        path,
        change: changeKind,
        mediaKind: anyBinary ? 'binary' : 'text',
        base: baseText.text,
        local: localText.text,
        remote: remoteText.text,
        truncated: baseText.truncated || localText.truncated || remoteText.truncated,
      },
    ]
  }

  const paths = uniqueStrings([
    ...base.map((file) => file.assetPath),
    ...local.map((file) => file.assetPath),
    ...remote.map((file) => file.assetPath),
  ]).sort()
  return paths.map((path) => {
    const baseFile = base.find((file) => file.assetPath === path)
    const localFile = local.find((file) => file.assetPath === path)
    const remoteFile = remote.find((file) => file.assetPath === path)
    const binary = [baseFile, localFile, remoteFile].some((file) => file?.mediaKind === 'binary')
    let fileChange: SyncChangeKind = changeKind
    if (!baseFile && localFile && remoteFile) fileChange = 'added'
    else if (baseFile && !localFile && !remoteFile) fileChange = 'deleted'
    else if (baseFile && localFile && remoteFile) fileChange = 'modified'
    const baseText = binary ? { text: null, truncated: false } : sideText(baseFile?.content ?? null)
    const localText = binary ? { text: null, truncated: false } : sideText(localFile?.content ?? null)
    const remoteText = binary ? { text: null, truncated: false } : sideText(remoteFile?.content ?? null)
    return {
      path,
      change: fileChange,
      mediaKind: binary ? 'binary' : 'text',
      base: baseText.text,
      local: localText.text,
      remote: remoteText.text,
      truncated: baseText.truncated || localText.truncated || remoteText.truncated,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export function createSyncService(ctx: AppContext): SyncService {
  const client = createGitClient(ctx)
  const aheadCache = new Map<string, AheadCacheEntry>()

  function loadChange(changeId: string): SyncChangeListRow {
    const row = ctx.db
      .prepare(
        `SELECT sc.*, lr.version AS local_version, br.version AS base_version, ra.base_commit AS base_commit_hint
         FROM sync_changes sc
         LEFT JOIN asset_revisions lr ON lr.id = sc.local_revision_id
         LEFT JOIN asset_revisions br ON br.id = sc.base_revision_id
         LEFT JOIN repo_assets ra ON ra.asset_id = sc.asset_id
         WHERE sc.id = ?`,
      )
      .get(changeId) as SyncChangeListRow | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This sync change no longer exists.')
    return row
  }

  function assertNoActiveSyncOperation(): void {
    const active = ctx.operations.activeRefs().find((ref) => isSyncOperationType(ref.type))
    if (active) {
      throw new AppError('LOCKED', 'Another repository operation is running. Wait for it to finish.', {
        kind: 'lock',
        operationId: active.operationId,
        operationType: active.type,
      })
    }
  }

  async function requireClone(repo: RepoRow): Promise<void> {
    if (!(await pathExists(repo.local_path))) {
      throw new AppError(
        'GIT_NOT_FOUND',
        'The repository clone is missing. Reconnect the repository to continue.',
      )
    }
  }

  async function readAheadBehind(repo: RepoRow): Promise<{ ahead: number; behind: number }> {
    const cached = aheadCache.get(repo.id)
    if (cached && Date.now() - cached.at < AHEAD_CACHE_MS / 2) {
      return { ahead: cached.ahead, behind: cached.behind }
    }
    try {
      const head = await client.currentHead(repo.local_path)
      const remote = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
      if (
        cached &&
        Date.now() - cached.at < AHEAD_CACHE_MS &&
        cached.head === head &&
        cached.remote === remote
      ) {
        return { ahead: cached.ahead, behind: cached.behind }
      }
      if (!head || !remote) {
        const value = { ahead: 0, behind: 0 }
        aheadCache.set(repo.id, { at: Date.now(), head, remote, ...value })
        return value
      }
      const counts = await client.aheadBehind(repo.local_path, 'HEAD', `refs/remotes/${REMOTE_NAME}/${repo.branch}`)
      aheadCache.set(repo.id, { at: Date.now(), head, remote, ...counts })
      return counts
    } catch {
      return cached ? { ahead: cached.ahead, behind: cached.behind } : { ahead: 0, behind: 0 }
    }
  }

  async function buildRepoStatus(repo: RepoRow): Promise<RepoStatus> {
    const base = repoStatusRow(ctx)
    if (!base) throw new AppError('NOT_FOUND', 'No repository is connected to this workspace.')
    const counts = await readAheadBehind(repo)
    const blocked = ctx.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sync_changes WHERE repo_id = ? AND status IN ('open','reviewed') AND blocked = 1",
      )
      .get(repo.id) as { count: number }
    const operation =
      ctx.operations.activeRefs().find((ref) => isSyncOperationType(ref.type)) ?? null
    const fetchError = loadFetchError(ctx, repo.id)
    const status: RepoStatus = {
      ...base,
      auth: { mode: repo.auth_mode, hasToken: hasRepoToken(ctx, repo.id) },
      ahead: counts.ahead,
      behind: counts.behind,
      operation,
      security: { plaintextCredentialCount: blocked.count, blocked: blocked.count > 0 },
    }
    if (fetchError) return { ...status, fetchError }
    return status
  }

  /* -------------------------- connect -------------------------- */

  interface ConnectPlan {
    repoId: string
    info: RepoUrlInfo
    branch: string
    cloneMode: 'managed' | 'bound'
    localPath: string
    auth: RepoAuthInput
    policies: RepoPolicies
    layout: RepoLayout
    autoFetch: boolean
    fetchIntervalMin: number
  }

  interface ResolvedAuth {
    auth: GitAuth
    storeToken: string | null
  }

  function resolveConnectAuth(input: RepoAuthInput): ResolvedAuth {
    if (input.mode === 'credential') return { auth: { mode: 'credential' }, storeToken: null }
    if (input.mode === 'ssh') {
      if (input.keyPath !== undefined && input.keyPath !== '') {
        if (!isAbsolute(input.keyPath)) {
          throw new AppError('VALIDATION', 'The SSH key path must be absolute.')
        }
      }
      return { auth: { mode: 'ssh', sshKeyPath: input.keyPath ?? null }, storeToken: null }
    }
    const token = input.token?.trim() ?? ''
    if (!token) {
      throw new AppError('VALIDATION', 'A repository token is required for token authentication.', {
        kind: 'validation',
        fields: [{ path: 'auth.token', message: 'Enter a token or choose another authentication method.' }],
      })
    }
    if (token.length > 4_096) {
      throw new AppError('VALIDATION', 'The repository token is too long.')
    }
    return { auth: { mode: 'token', token }, storeToken: token }
  }

  async function validateSshKey(path: string): Promise<void> {
    try {
      await access(path, constants.R_OK)
    } catch {
      throw new AppError('VALIDATION', 'The SSH key file cannot be read.')
    }
  }

  function planConnect(input: RepoConnectInput): ConnectPlan {
    const info = parseRepoUrl(input.url, input.provider)
    const branch = (input.branch ?? DEFAULT_BRANCH).trim() || DEFAULT_BRANCH
    if (!isValidBranchName(branch)) throw new AppError('VALIDATION', 'The repository branch name is not valid.')
    const policies = sanitizePolicies(input.policies)
    const layout = sanitizeLayout(input.layout)
    const autoFetch = input.autoFetch === true
    const fetchIntervalMin = input.fetchIntervalMin ?? 15
    if (!Number.isFinite(fetchIntervalMin) || fetchIntervalMin < 5 || fetchIntervalMin > 1_440) {
      throw new AppError('VALIDATION', 'The fetch interval must be between 5 and 1440 minutes.')
    }
    if (input.cloneMode !== 'managed' && input.cloneMode !== 'bound') {
      throw new AppError('VALIDATION', 'Choose a managed clone or a bound clone.')
    }
    const repoId = managedRepoId(info.url, branch)
    let localPath: string
    if (input.cloneMode === 'managed') {
      localPath = join(ctx.paths.repos, repoId)
    } else {
      const raw = (input.localPath ?? '').trim()
      if (!raw) throw new AppError('VALIDATION', 'A local path is required for a bound clone.')
      if (!isAbsolute(raw)) throw new AppError('VALIDATION', 'The local clone path must be absolute.')
      localPath = resolve(raw)
      if (isInsideAppBundle(localPath)) {
        throw new AppError('VALIDATION', 'The local clone path must be outside the application bundle.')
      }
    }
    return {
      repoId,
      info,
      branch,
      cloneMode: input.cloneMode,
      localPath,
      auth: input.auth,
      policies,
      layout,
      autoFetch,
      fetchIntervalMin,
    }
  }

  async function validateBoundClone(plan: ConnectPlan): Promise<{ head: string | null; warnings: string[] }> {
    let info: Awaited<ReturnType<typeof stat>> | null = null
    try {
      info = await stat(plan.localPath)
      await access(plan.localPath, constants.R_OK | constants.W_OK)
    } catch {
      throw new AppError('VALIDATION', 'The local clone path must exist, be a directory, and be writable.')
    }
    if (!info.isDirectory()) {
      throw new AppError('VALIDATION', 'The local clone path must be a directory.')
    }
    if (!(await client.isGitWorktree(plan.localPath))) {
      throw new AppError('VALIDATION', 'The local path must be the root of a Git worktree.')
    }
    const top = await client.topLevelPath(plan.localPath)
    if (top) {
      const [a, b] = await Promise.all([
        realpath(top).catch(() => top),
        realpath(plan.localPath).catch(() => plan.localPath),
      ])
      if (resolve(a) !== resolve(b)) {
        throw new AppError('VALIDATION', 'Choose the root directory of the Git worktree.')
      }
    }
    const warnings: string[] = []
    const head = await client.currentHead(plan.localPath)
    const localBranch = await client.revParse(plan.localPath, `refs/heads/${plan.branch}`)
    const branchRef =
      localBranch ?? (await client.revParse(plan.localPath, `refs/remotes/${REMOTE_NAME}/${plan.branch}`))
    if (head) {
      const currentBranch = await client.currentBranch(plan.localPath)
      if (currentBranch !== plan.branch) {
        throw new AppError(
          'VALIDATION',
          `The bound clone must have "${plan.branch}" checked out. Check out the branch and connect again.`,
        )
      }
      if (!localBranch || localBranch !== head) {
        throw new AppError(
          'VALIDATION',
          `The bound clone HEAD does not match the local "${plan.branch}" branch.`,
        )
      }
    }
    if (!head && !branchRef) {
      warnings.push('The bound clone has no commits yet.')
    }
    const origin = await client.remoteUrl(plan.localPath, REMOTE_NAME)
    if (origin) {
      const originInfo = tryParseUrl(origin)
      if (originInfo && (originInfo.owner !== plan.info.owner || originInfo.repo !== plan.info.repo)) {
        warnings.push('The bound clone origin points to a different repository than the requested URL.')
      }
    } else {
      warnings.push('The bound clone has no origin remote.')
    }
    return { head: branchRef ?? head, warnings }
  }

  function tryParseUrl(value: string): RepoUrlInfo | null {
    try {
      return parseRepoUrl(value)
    } catch {
      return null
    }
  }

  async function repoPreview(plan: ConnectPlan, input: RepoConnectInput): Promise<RepoConnectPreview> {
    await client.version()
    let scan: RepositoryScan
    let head: string | null
    const warnings: string[] = []
    if (plan.cloneMode === 'managed') {
      const tempDir = join(ctx.paths.temp, 'connect', `${plan.repoId}-${Date.now().toString(36)}`)
      await removeIfExists(tempDir)
      try {
        await client.clone({
          url: plan.info.url,
          directory: tempDir,
          branch: plan.branch,
          shallow: true,
          auth: resolveConnectAuth(plan.auth).auth,
        })
        head = await client.currentHead(tempDir)
        if (!head) throw new AppError('GIT_CONFLICT', 'The repository has no commits on the selected branch.')
        scan = await scanRepository(client, tempDir, head, plan.layout)
      } finally {
        await removeIfExists(tempDir)
      }
    } else {
      const bound = await validateBoundClone(plan)
      warnings.push(...bound.warnings)
      if (!bound.head) throw new AppError('GIT_CONFLICT', 'The bound clone has no commit to scan.')
      head = bound.head
      const dirty = await client.statusPorcelain(plan.localPath, uniqueStrings(Object.values(plan.layout)))
      if (dirty.length) {
        warnings.push(
          `${dirty.length} uncommitted path(s) exist in the repository directories. Push will refuse until the clone is clean.`,
        )
      }
      scan = await scanRepository(client, plan.localPath, head, plan.layout)
    }

    if (plan.auth.mode === 'ssh' && plan.auth.keyPath) await validateSshKey(plan.auth.keyPath)

    const counts: Record<AssetKind, number> = { prompt: 0, contract: 0, skill: 0, mcp: 0 }
    for (const asset of scan.assets) counts[asset.kind] += 1

    const allWarnings = [...warnings, ...scan.warnings]
    return {
      phase: 'preview',
      repo: {
        provider: plan.info.provider,
        url: plan.info.url,
        branch: plan.branch,
        localPath: plan.localPath,
        cloneMode: plan.cloneMode,
        headCommit: head,
      },
      layout: plan.layout,
      counts,
      malformed: scan.malformed,
      duplicateIds: scan.duplicateIds,
      scripts: scan.scripts,
      credentialFindings: scan.findings,
      warnings: allWarnings.slice(0, 50),
      previewToken: previewTokenFor({
        url: plan.info.url,
        branch: plan.branch,
        localPath: plan.localPath,
        mode: plan.cloneMode,
        head,
      }),
    }
  }

  async function repoApply(plan: ConnectPlan, input: RepoConnectInput): Promise<RepoConnectResult> {
    await client.version()
    if (loadRepo(ctx)) {
      throw new AppError('CONFLICT', 'A repository is already connected to this workspace.')
    }

    const resolved = resolveConnectAuth(plan.auth)
    if (resolved.storeToken && !ctx.secrets.available()) {
      throw new AppError(
        'UNSUPPORTED',
        ctx.secrets.reason() ?? 'Secure secret storage is unavailable.',
        { kind: 'unsupported', feature: 'safeStorage', reason: 'unavailable' },
      )
    }
    if (plan.auth.mode === 'ssh' && plan.auth.keyPath) await validateSshKey(plan.auth.keyPath)

    let managedCloneCreated = false
    let persisted = false
    try {
      let head: string | null = null
      let scan: RepositoryScan
      if (plan.cloneMode === 'managed') {
        await ensureDir(ctx.paths.repos)
        if (await pathExists(plan.localPath)) {
          throw new AppError(
            'CONFLICT',
            'The managed clone path already exists. Disconnect or remove it before connecting again.',
          )
        }
        managedCloneCreated = true
        await client.clone({
          url: plan.info.url,
          directory: plan.localPath,
          branch: plan.branch,
          auth: resolved.auth,
        })
        head = await client.currentHead(plan.localPath)
        if (!head) throw new AppError('GIT_CONFLICT', 'The repository has no commits on the selected branch.')
        scan = await scanRepository(client, plan.localPath, head, plan.layout)
      } else {
        const bound = await validateBoundClone(plan)
        head = bound.head
        if (!head) throw new AppError('GIT_CONFLICT', 'The bound clone has no commit to scan.')
        scan = await scanRepository(client, plan.localPath, head, plan.layout)
      }

      const expectedToken = previewTokenFor({
        url: plan.info.url,
        branch: plan.branch,
        localPath: plan.localPath,
        mode: plan.cloneMode,
        head,
      })
      if (!input.previewToken || input.previewToken !== expectedToken) {
        throw new AppError(
          'VALIDATION',
          'The repository preview is out of date. Preview the repository again before connecting.',
        )
      }
      if (scan.duplicateIds.length) {
        const first = scan.duplicateIds[0]
        throw new AppError(
          'CONFLICT',
          `The repository contains more than one asset with the ID "${first.id}". Resolve the duplicate files first.`,
          { kind: 'duplicate', field: 'id', value: first.id },
        )
      }
      if (scan.scripts.length && input.acknowledgeScripts !== true) {
        throw new AppError(
          'VALIDATION',
          'This repository contains scripts. Confirm that you understand scripts and MCP commands may run on this machine.',
          {
            kind: 'validation',
            fields: [
              {
                path: 'acknowledgeScripts',
                message: 'Acknowledge the scripts before connecting.',
              },
            ],
          },
        )
      }

      const at = nowIso()
      const repo: RepoRow = {
        id: plan.repoId,
        provider: plan.info.provider,
        url: plan.info.url,
        branch: plan.branch,
        local_path: plan.localPath,
        auth_mode: resolved.auth.mode,
        clone_mode: plan.cloneMode,
        policies_json: JSON.stringify(plan.policies),
        layout_json: JSON.stringify(plan.layout),
        auto_fetch: plan.autoFetch ? 1 : 0,
        fetch_interval_min: plan.fetchIntervalMin,
        push_mode: 'direct',
        last_fetched_at: at,
        last_synced_at: at,
        created_at: at,
        updated_at: at,
      }

      const tx = ctx.db.transaction(() => {
        ctx.db
          .prepare(
            `INSERT INTO repos
               (id, provider, url, branch, local_path, auth_mode, clone_mode, policies_json, layout_json,
                auto_fetch, fetch_interval_min, push_mode, last_fetched_at, last_synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            repo.id,
            repo.provider,
            repo.url,
            repo.branch,
            repo.local_path,
            repo.auth_mode,
            repo.clone_mode,
            repo.policies_json,
            repo.layout_json,
            repo.auto_fetch,
            repo.fetch_interval_min,
            repo.push_mode,
            repo.last_fetched_at,
            repo.last_synced_at,
            repo.created_at,
            repo.updated_at,
          )
        if (resolved.storeToken) {
          ctx.secrets.set('git_token', repo.id, 'token', resolved.storeToken)
        }
        if (plan.auth.mode === 'ssh' && plan.auth.keyPath) {
          setSetting(ctx, sshKeySettingKey(repo.id), plan.auth.keyPath)
        }
        for (const remote of scan.assets) {
          importRemoteAsset(
            ctx,
            repo,
            plan.policies,
            remote,
            head,
            `Imported from ${REMOTE_NAME}/${plan.branch} at ${head?.slice(0, 8) ?? 'connect'}`,
          )
        }
      })
      tx()
      persisted = true

      ctx.audit.log({
        type: 'connect',
        repoId: repo.id,
        title: 'Repository connected',
        detail: {
          provider: repo.provider,
          branch: repo.branch,
          cloneMode: repo.clone_mode,
          counts: scan.assets.length,
          malformed: scan.malformed.length,
          scripts: scan.scripts.length,
          credentialFindings: scan.findings.length,
        },
      })
      ctx.events.domainChanged('sync', 'synced', [])
      const status = await buildRepoStatus(repo)
      return { phase: 'applied', repo: status }
    } catch (error) {
      if (managedCloneCreated && !persisted) {
        await removeIfExists(plan.localPath).catch(() => false)
      }
      try {
        ctx.secrets.deleteOwner('git_token', plan.repoId)
      } catch {
        // No token was stored.
      }
      throw toAppError(error)
    }
  }

  /* -------------------------- fetch -------------------------- */

  type FetchResult = Extract<OperationResult, { type: 'sync_fetch' }>

  async function runFetch(repo: RepoRow, op: OperationContext): Promise<FetchResult> {
    try {
      await client.version()
      await requireClone(repo)
      const auth = authForRepo(ctx, repo)
      op.progress('fetch', 0, 0, 'Fetching the repository')
      await client.fetch(repo.local_path, REMOTE_NAME, { auth, signal: op.signal })
      if (op.signal.cancelled) throw new AppError('INTERNAL', 'The operation was cancelled.')
      const commit = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
      if (!commit) {
        throw new AppError(
          'GIT_CONFLICT',
          `The branch "${repo.branch}" does not exist on the remote repository.`,
        )
      }
      op.progress('scan', 0, 0, 'Reading the repository layout')
      const scan = await scanRepository(client, repo.local_path, commit, layoutOf(repo), op.signal)
      op.progress('changes', 1, 1, 'Computing changes')
      const counts = reconcileChanges(ctx, repo, layoutOf(repo), policiesOf(repo), scan, commit)
      const at = nowIso()
      ctx.db
        .prepare('UPDATE repos SET last_fetched_at = ?, updated_at = ? WHERE id = ?')
        .run(at, at, repo.id)
      clearFetchError(ctx, repo.id)
      ctx.audit.log({
        type: 'fetch',
        repoId: repo.id,
        title: 'Repository fetched',
        detail: {
          branch: repo.branch,
          commit: shortHash(commit),
          incoming: counts.incoming,
          outgoing: counts.outgoing,
          conflicts: counts.conflicts,
          malformed: scan.malformed.length,
        },
      })
      ctx.events.domainChanged('sync', 'synced', [])
      return { type: 'sync_fetch', incoming: counts.incoming, outgoing: counts.outgoing, conflicts: counts.conflicts }
    } catch (error) {
      const appError = toAppError(error)
      storeFetchError(ctx, repo.id, appError)
      ctx.audit.log({
        type: 'fetch',
        result: 'error',
        repoId: repo.id,
        title: 'Repository fetch failed',
        detail: { code: appError.code, message: appError.message },
      })
      throw appError
    }
  }

  async function fetchOperation(
    input: { requestId?: string },
    options: { automatic: boolean },
  ): Promise<OperationRef | null> {
    void input
    const repo = loadRepo(ctx)
    if (!repo) {
      if (options.automatic) return null
      throw new AppError('NOT_FOUND', 'No repository is connected to this workspace.')
    }
    if (options.automatic) {
      if (ctx.operations.activeRefs().some((ref) => isSyncOperationType(ref.type))) return null
    } else {
      assertNoActiveSyncOperation()
    }
    return ctx.operations.start<FetchResult>('sync_fetch', (op) => runFetch(repo, op), {
      repoId: repo.id,
      cancellable: true,
      sync: true,
    })
  }

  /* -------------------------- changes -------------------------- */

  function changes(query: SyncChangeQuery): Page<SyncChangeSummary> {
    const repo = requireRepo(ctx)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const offset = Math.max(query.offset ?? 0, 0)
    const where: string[] = ['sc.repo_id = ?']
    const params: unknown[] = [repo.id]
    if (query.direction) {
      where.push('sc.direction = ?')
      params.push(query.direction)
    }
    if (query.status) {
      where.push('sc.status = ?')
      params.push(query.status)
    } else {
      where.push("sc.status IN ('open','reviewed')")
    }
    if (query.kind) {
      where.push('sc.asset_kind = ?')
      params.push(query.kind)
    }
    if (query.risk) {
      where.push('sc.risk_json LIKE ?')
      params.push(`%"${query.risk}"%`)
    }
    if (query.blocked !== undefined) {
      where.push('sc.blocked = ?')
      params.push(query.blocked ? 1 : 0)
    }
    if (query.search) {
      where.push('(sc.asset_name LIKE ? OR sc.remote_path LIKE ? OR sc.summary LIKE ?)')
      const pattern = `%${query.search}%`
      params.push(pattern, pattern, pattern)
    }
    const clause = `WHERE ${where.join(' AND ')}`
    const total = (
      ctx.db.prepare(`SELECT COUNT(*) AS count FROM sync_changes sc ${clause}`).get(...params) as {
        count: number
      }
    ).count
    const rows = ctx.db
      .prepare(
        `SELECT sc.*, lr.version AS local_version, br.version AS base_version, ra.base_commit AS base_commit_hint
         FROM sync_changes sc
         LEFT JOIN asset_revisions lr ON lr.id = sc.local_revision_id
         LEFT JOIN asset_revisions br ON br.id = sc.base_revision_id
         LEFT JOIN repo_assets ra ON ra.asset_id = sc.asset_id
         ${clause}
         ORDER BY sc.updated_at DESC, sc.id
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as SyncChangeListRow[]
    return { items: rows.map((row) => changeSummary(ctx, row)), total, limit, offset }
  }

  async function changeDetail(input: { changeId: string }): Promise<SyncChangeDetail> {
    const repo = requireRepo(ctx)
    const row = loadChange(input.changeId)
    if (row.repo_id !== repo.id) throw new AppError('NOT_FOUND', 'This sync change no longer exists.')
    let base: FileSide[] = []
    if (row.base_revision_id) {
      base = localSides(ctx, row.base_revision_id)
    } else if (row.asset_id) {
      const baseRow = ctx.db
        .prepare('SELECT * FROM repo_assets WHERE repo_id = ? AND asset_id = ?')
        .get(repo.id, row.asset_id) as RepoAssetRow | undefined
      if (baseRow?.base_commit && baseRow.remote_path) {
        base = await remoteSides(
          client,
          repo.local_path,
          baseRow.base_commit,
          row.asset_kind,
          baseRow.remote_path,
        )
      }
    }
    const local = localSides(ctx, row.local_revision_id)
    const remote = await remoteSides(
      client,
      repo.local_path,
      row.remote_commit,
      row.asset_kind,
      row.direction === 'outgoing' ? null : row.remote_path,
    )
    const files = detailFiles(row.asset_kind, row.change_kind, base, local, remote)
    const reviewToken = sha256Hex(
      JSON.stringify({
        fingerprint: row.fingerprint,
        files: files.map((file) => ({
          path: file.path,
          change: file.change,
          base: file.base,
          local: file.local,
          remote: file.remote,
          truncated: file.truncated,
        })),
      }),
    )
    return {
      ...changeSummary(ctx, row),
      files,
      redacted: true,
      reviewToken,
    }
  }

  /* -------------------------- review -------------------------- */

  function reviewRuleViolation(
    rows: SyncChangeListRow[],
    input: SyncReviewInput,
  ): AppError | null {
    const risky = rows.filter(
      (row) =>
        row.asset_kind === 'prompt' ||
        row.asset_kind === 'contract' ||
        (row.asset_kind === 'skill' &&
          (row.change_kind === 'added' || riskOf(row).includes('scripts'))),
    )
    if (risky.length && rows.length > 1) {
      return new AppError(
        'VALIDATION',
        'Prompts, Agent Instructions, and new or script-containing Skills must be reviewed one item at a time.',
        {
          kind: 'per-item-required',
          changeIds: risky.map((row) => row.id),
          reason: 'These changes require an individual review.',
        },
      )
    }
    // New or script-containing Skills additionally require proof that the full
    // content was opened. Prompts and Contracts are covered by the one-at-a-time
    // rule and their full-text preview in the renderer.
    for (const row of risky) {
      if (row.asset_kind !== 'skill') continue
      const token = input.reviewTokens?.[row.id]
      if (!token) {
        return new AppError(
          'VALIDATION',
          'Open the full content of this Skill and confirm it before approving.',
          {
            kind: 'per-item-required',
            changeIds: [row.id],
            reason: 'A full-content review token is required for this Skill.',
          },
        )
      }
    }
    return null
  }

  async function review(input: SyncReviewInput): Promise<SyncReviewResult> {
    requireRepo(ctx)
    if (!Array.isArray(input.changeIds) || !input.changeIds.length) {
      throw new AppError('VALIDATION', 'Select at least one change to review.')
    }
    if (input.decision !== 'approve' && input.decision !== 'dismiss') {
      throw new AppError('VALIDATION', 'The review decision is not valid.')
    }
    const rows: SyncChangeListRow[] = []
    const invalidated: string[] = []
    for (const id of uniqueStrings(input.changeIds)) {
      const row = loadChange(id)
      if (row.status === 'resolved' || row.status === 'dismissed') {
        invalidated.push(id)
        continue
      }
      const expected = input.expectedFingerprints[id]
      if (!expected || expected !== row.fingerprint) {
        invalidated.push(id)
        continue
      }
      rows.push(row)
    }
    if (invalidated.length) {
      const currentFingerprints: Record<string, string> = {}
      for (const id of invalidated) {
        const row = ctx.db
          .prepare('SELECT fingerprint FROM sync_changes WHERE id = ?')
          .get(id) as { fingerprint: string } | undefined
        if (row) currentFingerprints[id] = row.fingerprint
      }
      return {
        approved: [],
        dismissed: [],
        invalidated,
      }
    }

    if (input.decision === 'approve') {
      const violation = reviewRuleViolation(rows, input)
      if (violation) throw violation
      for (const row of rows) {
        if (row.blocked) {
          throw new AppError(
            'SECURITY_BLOCK',
            'This change is blocked because the incoming content contains likely credentials.',
            { kind: 'security-block', operation: 'apply', findings: [] },
          )
        }
      }
      for (const row of rows) {
        if (row.asset_kind === 'skill') {
          const token = input.reviewTokens?.[row.id]
          if (token) {
            const detail = await changeDetail({ changeId: row.id })
            if (detail.reviewToken !== token) {
              return { approved: [], dismissed: [], invalidated: rows.map((entry) => entry.id) }
            }
          }
        }
      }
    }

    const at = nowIso()
    const status: SyncChangeStatus = input.decision === 'approve' ? 'reviewed' : 'dismissed'
    const tx = ctx.db.transaction(() => {
      for (const row of rows) {
        ctx.db
          .prepare("UPDATE sync_changes SET status = ?, updated_at = ? WHERE id = ? AND status IN ('open','reviewed')")
          .run(status, at, row.id)
      }
    })
    tx()
    ctx.audit.log({
      type: 'review',
      repoId: rows[0]?.repo_id,
      title: input.decision === 'approve' ? 'Sync changes approved' : 'Sync changes dismissed',
      detail: {
        decision: input.decision,
        changeIds: rows.map((row) => row.id),
        ...(input.note ? { note: input.note } : {}),
      },
    })
    ctx.events.domainChanged(
      'sync',
      'reviewed',
      rows.map((row) => row.asset_id).filter((id): id is string => !!id),
      undefined,
    )
    return {
      approved: input.decision === 'approve' ? rows.map((row) => row.id) : [],
      dismissed: input.decision === 'dismiss' ? rows.map((row) => row.id) : [],
      invalidated: [],
    }
  }

  /* -------------------------- pull -------------------------- */

  type PullResult = Extract<OperationResult, { type: 'sync_pull' }>

  function markResolved(changeId: string): void {
    ctx.db
      .prepare("UPDATE sync_changes SET status = 'resolved', updated_at = ? WHERE id = ?")
      .run(nowIso(), changeId)
  }

  function buildRemoteFromFiles(
    kind: AssetKind,
    remotePath: string,
    files: RepoFileInput[],
    dirPath: string | null,
    fallbackFolder: string,
    slugHint: string,
  ): { asset: RemoteAsset | null; error?: string } {
    return buildRemoteAsset({
      kind,
      root: '',
      mainPath: remotePath,
      dirPath,
      files,
      slugHint,
      folderHint: fallbackFolder,
    })
  }

  async function remoteAssetFromChange(
    repo: RepoRow,
    row: SyncChangeListRow,
    signal?: OperationContext['signal'],
  ): Promise<RemoteAsset> {
    if (!row.remote_commit) {
      throw new AppError('CORRUPT', 'The sync change has no remote commit. Fetch the repository again.')
    }
    const files = await readRemoteFiles(
      client,
      repo.local_path,
      row.remote_commit,
      row.asset_kind,
      row.remote_path,
      signal,
    )
    if (!files.files.length) {
      throw new AppError('CONFLICT', 'The remote file no longer exists at the recorded commit.')
    }
    const root = layoutOf(repo)[KIND_ROOT_KEY[row.asset_kind]]
    const folder =
      row.asset_kind === 'skill'
        ? skillFolderFromDirPath(root, dirname(row.remote_path))
        : folderFromRepoPath(root, row.remote_path)
    const suffix =
      row.asset_kind === 'prompt'
        ? '.prompt.md'
        : row.asset_kind === 'contract'
          ? '.contract.md'
          : row.asset_kind === 'mcp'
            ? '.json'
            : ''
    const slugHint =
      row.asset_kind === 'skill'
        ? basename(dirname(row.remote_path))
        : fileStem(row.remote_path, suffix ? [suffix] : [])
    const built = buildRemoteAsset({
      kind: row.asset_kind,
      root,
      mainPath: row.remote_path,
      dirPath: files.dirPath,
      files: files.files,
      slugHint,
      folderHint: folder,
    })
    if (!built.asset) {
      throw new AppError('VALIDATION', built.error ?? 'The remote content could not be parsed.')
    }
    return built.asset
  }

  async function runPull(repo: RepoRow, input: SyncPullInput, op: OperationContext): Promise<PullResult> {
    await requireClone(repo)
    const ids = uniqueStrings(input.changeIds)
    if (!ids.length) throw new AppError('VALIDATION', 'Select at least one change to pull.')
    const rows: SyncChangeListRow[] = []
    const invalidated: string[] = []
    for (const id of ids) {
      const row = loadChange(id)
      if (row.repo_id !== repo.id) throw new AppError('NOT_FOUND', 'This sync change no longer exists.')
      if (row.direction !== 'incoming') {
        throw new AppError('VALIDATION', 'Only incoming changes can be pulled.')
      }
      if (row.status !== 'reviewed') {
        throw new AppError('VALIDATION', 'Review every selected change before pulling.', {
          kind: 'review-required',
          changeIds: [row.id],
        })
      }
      const expected = input.expectedFingerprints[row.id]
      if (!expected || expected !== row.fingerprint) invalidated.push(row.id)
      rows.push(row)
    }
    if (invalidated.length) {
      const currentFingerprints: Record<string, string> = {}
      for (const id of invalidated) {
        const row = ctx.db.prepare('SELECT fingerprint FROM sync_changes WHERE id = ?').get(id) as
          | { fingerprint: string }
          | undefined
        if (row) currentFingerprints[id] = row.fingerprint
      }
      throw new AppError('CONFLICT', 'Some changes changed after review. Review them again.', {
        kind: 'review-invalidated',
        changeIds: invalidated,
        currentFingerprints,
      })
    }
    if (rows.some((row) => row.blocked)) {
      throw new AppError(
        'SECURITY_BLOCK',
        'A selected change is blocked because the incoming content contains likely credentials.',
        { kind: 'security-block', operation: 'apply', findings: [] },
      )
    }

    const policies = policiesOf(repo)
    const layout = layoutOf(repo)
    let applied = 0
    let failed = 0
    let skipped = 0
    op.progress('pull', 0, rows.length, 'Applying reviewed changes')
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      if (op.signal.cancelled) throw new AppError('INTERNAL', 'The operation was cancelled.')
      try {
        if (row.change_kind === 'deleted') {
          if (row.asset_id) {
            const asset = ctx.db.prepare('SELECT * FROM assets WHERE id = ?').get(row.asset_id) as
              | AssetRow
              | undefined
            if (asset && !asset.deleted_at) ctx.assets.softDelete(asset.id)
            ctx.db
              .prepare('DELETE FROM repo_assets WHERE repo_id = ? AND asset_id = ?')
              .run(repo.id, row.asset_id)
            ctx.events.domainChanged(kindDomain(row.asset_kind), 'deleted', [row.asset_id])
          }
          markResolved(row.id)
          applied += 1
          op.progress('pull', index + 1, rows.length, `Applied ${index + 1} of ${rows.length}`)
          continue
        }
        const remote = await remoteAssetFromChange(repo, row, op.signal)
        if (row.remote_blob_hash && remote.digest !== row.remote_blob_hash) {
          ctx.db
            .prepare("UPDATE sync_changes SET status = 'open', updated_at = ? WHERE id = ?")
            .run(nowIso(), row.id)
          skipped += 1
          continue
        }
        if (remote.blocked) {
          failed += 1
          ctx.db
            .prepare('UPDATE sync_changes SET blocked = 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), row.id)
          continue
        }
        importRemoteAsset(
          ctx,
          repo,
          policies,
          remote,
          row.remote_commit,
          `Pulled ${row.remote_path} from ${REMOTE_NAME}/${repo.branch} at ${row.remote_commit?.slice(0, 8) ?? ''}`,
        )
        markResolved(row.id)
        applied += 1
      } catch (error) {
        const appError = toAppError(error)
        if (appError.code === 'SECURITY_BLOCK') throw appError
        failed += 1
        if (appError.code === 'VALIDATION' || appError.code === 'CORRUPT') {
          ctx.db
            .prepare('UPDATE sync_changes SET blocked = 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), row.id)
        }
        ctx.logger.warn('sync', 'A reviewed change could not be applied', {
          changeId: row.id,
          code: appError.code,
        })
      }
      op.progress('pull', index + 1, rows.length, `Processed ${index + 1} of ${rows.length}`)
    }

    try {
      const commit = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
      if (commit) {
        const scan = await scanRepository(client, repo.local_path, commit, layout, op.signal)
        reconcileChanges(ctx, repo, layout, policies, scan, commit)
      }
    } catch {
      // Reconciliation is best effort; the next fetch repairs the change list.
    }

    if (applied > 0) {
      const at = nowIso()
      ctx.db.prepare('UPDATE repos SET last_synced_at = ?, updated_at = ? WHERE id = ?').run(at, at, repo.id)
    }
    ctx.audit.log({
      type: 'pull',
      result: failed > 0 ? 'warning' : 'success',
      repoId: repo.id,
      title: 'Reviewed changes pulled',
      detail: { applied, skipped, failed },
    })
    ctx.events.domainChanged('sync', 'synced', [])
    if (applied === 0 && failed > 0) {
      throw new AppError('CONFLICT', 'No reviewed change could be applied. Check the change details and retry.')
    }
    return { type: 'sync_pull', applied, skipped, failed }
  }

  async function pull(input: SyncPullInput): Promise<OperationRef> {
    const repo = requireRepo(ctx)
    if (!Array.isArray(input.changeIds) || !uniqueStrings(input.changeIds).length) {
      throw new AppError('VALIDATION', 'Select at least one change to pull.')
    }
    if (!input.expectedFingerprints || typeof input.expectedFingerprints !== 'object') {
      throw new AppError('VALIDATION', 'Fingerprints are required for every selected change.')
    }
    assertNoActiveSyncOperation()
    return ctx.operations.start<PullResult>('sync_pull', (op) => runPull(repo, input, op), {
      repoId: repo.id,
      cancellable: true,
      sync: true,
    })
  }

  /* -------------------------- push -------------------------- */

  type PushResult = Extract<OperationResult, { type: 'sync_push' }>

  interface PushCandidate {
    row: SyncChangeListRow
    asset: AssetRecord
    files: RepoWrite[]
  }

  function canonicalPushFiles(
    asset: AssetRecord,
    layout: RepoLayout,
  ): { files: RepoWrite[]; error?: string } {
    const revision = ctx.assets.currentRevisionOrNull(asset.id)
    if (!revision) return { files: [], error: 'The asset has no current revision.' }
    const manifest = revisionFiles(ctx, revision.id)
    const root = layout[KIND_ROOT_KEY[asset.kind]]
    const writes: RepoWrite[] = []

    if (asset.kind === 'skill') {
      const dir = ctx.assets.repoPathForLayout(asset, root)
      const skillFile = manifest.find((file) => file.path === 'SKILL.md')
      if (!skillFile) return { files: [], error: 'The skill has no SKILL.md file.' }
      for (const file of manifest) {
        if (!isSafeRelativePath(file.path)) {
          return { files: [], error: `The skill contains an unsafe file path: ${file.path}` }
        }
        const content = ctx.blobs.readSync(file.blobHash)
        writes.push({
          assetId: asset.id,
          repoPath: `${dir}/${file.path}`,
          content,
          isExecutable: file.isExecutable,
          skillDir: dir,
        })
      }
      return { files: writes }
    }

    if (manifest.length !== 1) {
      return { files: [], error: 'A Prompt, Agent Instruction, or MCP file must contain exactly one file.' }
    }
    const file = manifest[0]
    if (file.mediaKind !== 'text') {
      return { files: [], error: 'The canonical file must be text.' }
    }
    const content = ctx.blobs.readSync(file.blobHash)
    const text = content.toString('utf8')
    if (asset.kind === 'prompt') {
      const parsed = parsePromptFile(text, file.path)
      if (!parsed.model) return { files: [], error: parsed.error ?? 'The prompt file is not valid.' }
      if (!parsed.model.id) return { files: [], error: 'The prompt file has no stable ID.' }
      if (parsed.model.id !== asset.id) {
        return { files: [], error: 'The prompt stable ID does not match the local asset.' }
      }
    } else if (asset.kind === 'contract') {
      const parsed = parseContractFile(text, file.path)
      if (!parsed.model) return { files: [], error: parsed.error ?? 'The contract file is not valid.' }
      if (!parsed.model.id) return { files: [], error: 'The contract file has no stable ID.' }
      if (parsed.model.id !== asset.id) {
        return { files: [], error: 'The contract stable ID does not match the local asset.' }
      }
    } else {
      const parsed = parseMcpFile(text, file.path)
      if (!parsed.model) return { files: [], error: parsed.error ?? 'The MCP file is not valid.' }
      if (!parsed.model.id) return { files: [], error: 'The MCP file has no stable ID.' }
      if (parsed.model.id !== asset.id) {
        return { files: [], error: 'The MCP stable ID does not match the local asset.' }
      }
    }
    const remotePath = ctx.assets.repoPathForLayout(asset, root)
    return {
      files: [
        {
          assetId: asset.id,
          repoPath: remotePath,
          content,
          isExecutable: false,
          skillDir: null,
        },
      ],
    }
  }

  function scanPushFiles(candidates: PushCandidate[]): ScanFinding[] {
    const findings: ScanFinding[] = []
    for (const candidate of candidates) {
      const replacement = candidate.asset.kind === 'mcp' ? '${VAR}' : '{{variable}}'
      for (const file of candidate.files) {
        if (!isTextFile(file.repoPath)) continue
        findings.push(
          ...scanText(file.content.toString('utf8'), {
            path: file.repoPath,
            replacement,
          }),
        )
      }
    }
    return findings.filter((finding) => finding.confidence === 'high').slice(0, MAX_FINDINGS)
  }

  function worktreePath(repo: RepoRow, repoPath: string): string {
    if (!isSafeRelativePath(repoPath)) {
      throw new AppError('VALIDATION', `The repository path "${repoPath}" is not safe.`)
    }
    const full = resolve(repo.local_path, repoPath)
    if (!isPathInside(repo.local_path, full)) {
      throw new AppError('VALIDATION', 'A repository path escaped the clone directory.')
    }
    return full
  }

  function compareUrlFor(repo: RepoRow, newBranch: string): string | undefined {
    const info = tryParseUrl(repo.url)
    if (!info) return undefined
    const base = `${info.host}/${info.owner}/${info.repo}`
    if (info.provider === 'github') {
      return `https://${base}/compare/${repo.branch}...${newBranch}?expand=1`
    }
    if (info.provider === 'gitlab') {
      return `https://${base}/-/compare/${repo.branch}...${newBranch}`
    }
    return undefined
  }

  async function runPush(repo: RepoRow, input: SyncPushInput, op: OperationContext): Promise<PushResult> {
    const ids = uniqueStrings(input.changeIds)
    if (!ids.length) throw new AppError('VALIDATION', 'Select at least one change to push.')
    const message = (input.commitMessage ?? '').trim()
    if (!message) throw new AppError('VALIDATION', 'A commit message is required.')
    if (input.method !== 'direct' && input.method !== 'branch') {
      throw new AppError('VALIDATION', 'The push method is not valid.')
    }
    await client.version()
    await requireClone(repo)
    const auth = authForRepo(ctx, repo)
    const layout = layoutOf(repo)
    const candidates: PushCandidate[] = []
    const failures: string[] = []

    for (const id of ids) {
      const row = loadChange(id)
      if (row.repo_id !== repo.id) throw new AppError('NOT_FOUND', 'This sync change no longer exists.')
      if (row.direction !== 'outgoing') {
        throw new AppError('VALIDATION', 'Only outgoing changes can be pushed.', {
          kind: 'review-required',
          changeIds: [row.id],
        })
      }
      if (row.status === 'resolved' || row.status === 'dismissed') {
        failures.push(row.id)
        continue
      }
      if (!row.asset_id) {
        failures.push(row.id)
        continue
      }
      let asset: AssetRecord
      try {
        asset = ctx.assets.getAsset(row.asset_id)
      } catch {
        failures.push(row.id)
        continue
      }
      const built = canonicalPushFiles(asset, layout)
      if (built.error || !built.files.length) {
        failures.push(row.id)
        ctx.logger.warn('sync', 'A change could not be prepared for push', {
          changeId: row.id,
          reason: built.error ?? 'no files',
        })
        continue
      }
      candidates.push({ row, asset, files: built.files })
    }

    if (!candidates.length) {
      throw new AppError(
        'VALIDATION',
        'None of the selected changes can be pushed. Fix the reported file problems and try again.',
      )
    }

    const findings = scanPushFiles(candidates)
    if (findings.length) {
      ctx.audit.log({
        type: 'blocked',
        result: 'warning',
        repoId: repo.id,
        title: 'Push blocked by a credential scan',
        detail: { changeIds: candidates.map((candidate) => candidate.row.id), findings: findings.length },
      })
      throw new AppError(
        'SECURITY_BLOCK',
        'The credential scan found likely secrets in the selected files. Replace them with variables before pushing.',
        { kind: 'security-block', operation: 'push', findings },
      )
    }

    if (!(await client.isGitWorktree(repo.local_path))) {
      throw new AppError('GIT_NOT_FOUND', 'The repository clone is missing or is not a Git worktree.')
    }
    const managedRoots = uniqueStrings(Object.values(layout))
    const dirty = await client.statusPorcelain(repo.local_path, managedRoots)
    if (dirty.length) {
      throw new AppError(
        'GIT_CONFLICT',
        'The clone has uncommitted changes in repository directories. Commit or discard them outside Prompt Keeper before pushing.',
      )
    }

    const remoteCommit = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
    let head = await client.currentHead(repo.local_path)
    if (head && remoteCommit && head !== remoteCommit) {
      if (await client.isAncestor(repo.local_path, head, remoteCommit)) {
        await client.fastForward(repo.local_path, remoteCommit, op.signal)
        head = await client.currentHead(repo.local_path)
      } else if (!(await client.isAncestor(repo.local_path, remoteCommit, head))) {
        throw new AppError(
          'GIT_CONFLICT',
          'The local clone and the remote branch have diverged. Fetch and resolve incoming changes before pushing.',
        )
      }
    }
    if (!head) {
      // A clone of an empty repository can be on a different default branch.
      await client.ensureUnbornBranch(repo.local_path, repo.branch)
    }

    // The previous repository path is needed when a local rename must delete
    // the old file or skill directory before committing the new path.
    const oldPathsByAsset = new Map<string, string>()
    for (const candidate of candidates) {
      const row = ctx.db
        .prepare('SELECT * FROM repo_assets WHERE repo_id = ? AND asset_id = ?')
        .get(repo.id, candidate.asset.id) as RepoAssetRow | undefined
      if (!row?.remote_path) continue
      const skillDir = candidate.files[0]?.skillDir
      const mainPath = skillDir ? `${skillDir}/SKILL.md` : candidate.files[0].repoPath
      if (row.remote_path !== mainPath) oldPathsByAsset.set(candidate.asset.id, row.remote_path)
    }

    const headTree = head
      ? await client.lsTree(repo.local_path, 'HEAD', managedRoots, { signal: op.signal })
      : []
    const headPaths = new Set(
      headTree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
    )

    const written: string[] = []
    const removed: string[] = []
    const created: string[] = []
    let committed = false

    try {
      for (const candidate of candidates) {
        for (const file of candidate.files) {
          if (!headPaths.has(file.repoPath)) created.push(file.repoPath)
          await writeAtomic(worktreePath(repo, file.repoPath), file.content, {
            mode: file.isExecutable ? 0o755 : 0o644,
          })
          written.push(file.repoPath)
        }
        // A Skill revision is the complete file set, so tracked files that are
        // no longer present must be removed from the worktree as well.
        const newPaths = new Set(candidate.files.map((file) => file.repoPath))
        const removeTrackedUnder = async (dir: string): Promise<void> => {
          if (!head) return
          const tree = await client
            .lsTree(repo.local_path, 'HEAD', [dir], { signal: op.signal })
            .catch(() => [] as GitTreeEntry[])
          for (const entry of tree) {
            if (entry.type !== 'blob') continue
            if (!entry.path.startsWith(`${dir}/`)) continue
            if (newPaths.has(entry.path)) continue
            await removeIfExists(worktreePath(repo, entry.path))
            removed.push(entry.path)
          }
        }
        if (candidate.asset.kind === 'skill' && candidate.files[0]?.skillDir) {
          await removeTrackedUnder(candidate.files[0].skillDir)
        }
        const oldPath = oldPathsByAsset.get(candidate.asset.id)
        if (!oldPath) continue
        if (candidate.asset.kind === 'skill') {
          const oldDir = oldPath.endsWith('/SKILL.md') ? dirname(oldPath) : oldPath
          if (candidate.files[0]?.skillDir !== oldDir) await removeTrackedUnder(oldDir)
        } else {
          await removeIfExists(worktreePath(repo, oldPath))
          removed.push(oldPath)
        }
      }

      const changedPaths = uniqueStrings([...written, ...removed])
      if (!changedPaths.length) {
        throw new AppError('CONFLICT', 'The selected changes no longer differ from the repository.')
      }
      await client.add(repo.local_path, changedPaths)
      const pending = await client.statusPorcelain(repo.local_path, changedPaths)
      let commit: string | null = head
      if (pending.length) {
        commit = await client.commit(repo.local_path, message, changedPaths)
        committed = true
      }
      if (!commit) throw new AppError('GIT_CONFLICT', 'There is no commit to push.')

      const pushBranch =
        input.method === 'branch'
          ? `prompt-keeper/sync-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`
          : repo.branch
      if (input.method === 'branch') {
        await client.push(repo.local_path, REMOTE_NAME, repo.branch, {
          refspec: `HEAD:refs/heads/${pushBranch}`,
          auth,
          signal: op.signal,
        })
      } else {
        await client.push(repo.local_path, REMOTE_NAME, repo.branch, { auth, signal: op.signal })
      }

      const at = nowIso()
      for (const candidate of candidates) {
        const revision = ctx.assets.currentRevisionOrNull(candidate.asset.id)
        if (!revision) continue
        const skillDir = candidate.files[0]?.skillDir
        upsertBase(ctx, {
          repoId: repo.id,
          assetId: candidate.asset.id,
          remotePath: skillDir ? `${skillDir}/SKILL.md` : candidate.files[0].repoPath,
          baseCommit: commit,
          baseRevisionId: revision.id,
          baseManifestHash: revision.manifestHash,
        })
        ctx.db
          .prepare("UPDATE sync_changes SET status = 'resolved', updated_at = ? WHERE id = ?")
          .run(at, candidate.row.id)
      }
      ctx.db
        .prepare('UPDATE repos SET last_synced_at = ?, updated_at = ? WHERE id = ?')
        .run(at, at, repo.id)
      clearFetchError(ctx, repo.id)
      try {
        const scan = await scanRepository(client, repo.local_path, commit, layout, op.signal)
        reconcileChanges(ctx, repo, layout, policiesOf(repo), scan, commit)
      } catch {
        // The next fetch reconciles any remaining rows.
      }
      ctx.audit.log({
        type: 'push',
        repoId: repo.id,
        title: 'Local changes pushed',
        detail: {
          commit: shortHash(commit),
          branch: pushBranch,
          method: input.method,
          pushed: candidates.length,
          failed: failures.length,
          message,
        },
      })
      ctx.events.domainChanged('sync', 'synced', [])
      return {
        type: 'sync_push',
        commit,
        branch: pushBranch,
        pushed: candidates.length,
        failed: failures.length,
        ...(input.method === 'branch'
          ? (() => {
              const compareUrl = compareUrlFor(repo, pushBranch)
              return compareUrl ? { compareUrl } : {}
            })()
          : {}),
      }
    } catch (error) {
      const appError = toAppError(error)
      if (!committed) {
        try {
          await client.restore(repo.local_path, uniqueStrings([...written, ...removed]))
          for (const path of created) await removeIfExists(worktreePath(repo, path))
        } catch {
          // Cleaning up is best effort; the dirty-worktree check stops the next push.
        }
      }
      ctx.audit.log({
        type: 'push',
        result: 'error',
        repoId: repo.id,
        title: 'Push failed',
        detail: { code: appError.code, message: appError.message },
      })
      throw appError
    }
  }

  async function push(input: SyncPushInput): Promise<OperationRef> {
    const repo = requireRepo(ctx)
    if (!Array.isArray(input.changeIds) || !uniqueStrings(input.changeIds).length) {
      throw new AppError('VALIDATION', 'Select at least one change to push.')
    }
    if (!(input.commitMessage ?? '').trim()) {
      throw new AppError('VALIDATION', 'A commit message is required.')
    }
    if (input.method !== 'direct' && input.method !== 'branch') {
      throw new AppError('VALIDATION', 'The push method is not valid.')
    }
    assertNoActiveSyncOperation()
    return ctx.operations.start<PushResult>('sync_push', (op) => runPush(repo, input, op), {
      repoId: repo.id,
      cancellable: true,
      sync: true,
    })
  }

  /* -------------------------- conflicts -------------------------- */

  function markContractProjectionsStale(assetId: string): void {
    ctx.db
      .prepare("UPDATE projections SET status = 'stale' WHERE contract_id = ? AND status = 'synced'")
      .run(assetId)
  }

  async function conflictResolve(input: SyncConflictResolveInput): Promise<ConflictResolutionResult> {
    const repo = requireRepo(ctx)
    await requireClone(repo)
    const row = loadChange(input.changeId)
    if (row.repo_id !== repo.id) throw new AppError('NOT_FOUND', 'This sync change no longer exists.')
    if (row.direction !== 'conflict') {
      throw new AppError('VALIDATION', 'Only conflicts can be resolved with this action.')
    }
    if (row.fingerprint !== input.expectedFingerprint) {
      throw new AppError('CONFLICT', 'The conflict changed after it was opened. Review it again.', {
        kind: 'review-invalidated',
        changeIds: [row.id],
        currentFingerprints: { [row.id]: row.fingerprint },
      })
    }
    const strategy = input.strategy
    if (strategy !== 'take-remote' && strategy !== 'keep-local' && strategy !== 'manual') {
      throw new AppError('VALIDATION', 'The conflict strategy is not valid.')
    }
    if (strategy === 'take-remote' && input.confirm !== true) {
      throw new AppError('VALIDATION', 'Taking the repository version discards local changes. Confirm the action.', {
        kind: 'validation',
        fields: [{ path: 'confirm', message: 'Set confirm to true.' }],
      })
    }
    if (!row.asset_id) {
      throw new AppError('CONFLICT', 'This conflict has no local asset to resolve.')
    }
    const asset = ctx.assets.getAsset(row.asset_id)
    const layout = layoutOf(repo)
    const policies = policiesOf(repo)
    // A conflict can also mean the repository deleted the file while the local
    // asset changed. In that case there is no remote content to read.
    const remote = row.change_kind === 'deleted' ? null : await remoteAssetFromChange(repo, row)
    const note = input.note?.trim()

    let localRevisionId: string | undefined
    let outgoingChangeId: string | undefined

    if (strategy === 'take-remote') {
      if (!remote) {
        ctx.assets.softDelete(asset.id)
        ctx.db
          .prepare('DELETE FROM repo_assets WHERE repo_id = ? AND asset_id = ?')
          .run(repo.id, asset.id)
        markResolved(row.id)
        if (asset.kind === 'contract') markContractProjectionsStale(asset.id)
        ctx.events.domainChanged(kindDomain(asset.kind), 'deleted', [asset.id])
        await reconcileAfterConflict(repo, layout, policies)
        ctx.audit.log({
          type: 'conflict',
          repoId: repo.id,
          assetId: asset.id,
          title: 'Conflict resolved by accepting the repository deletion',
          detail: { strategy, note: note ?? '' },
        })
        return { changeId: row.id, resolved: true, strategy }
      }
      if (remote.blocked) {
        throw new AppError(
          'SECURITY_BLOCK',
          'The repository version contains likely credentials and cannot be applied.',
          { kind: 'security-block', operation: 'apply', findings: [] },
        )
      }
      const imported = importRemoteAsset(
        ctx,
        repo,
        policies,
        remote,
        row.remote_commit,
        `Conflict resolved with the repository version (${row.remote_path})${note ? `: ${note}` : ''}`,
      )
      localRevisionId = imported.revision.id
      markResolved(row.id)
      if (asset.kind === 'contract') markContractProjectionsStale(asset.id)
      await reconcileAfterConflict(repo, layout, policies)
      ctx.audit.log({
        type: 'conflict',
        repoId: repo.id,
        assetId: asset.id,
        title: 'Conflict resolved with the repository version',
        detail: { strategy, note: note ?? '' },
      })
      return { changeId: row.id, resolved: true, strategy, localRevisionId }
    }

    if (strategy === 'keep-local') {
      const localRevision = ctx.assets.currentRevisionOrNull(asset.id)
      if (!localRevision) throw new AppError('CORRUPT', 'The local asset has no revision.')
      setBaseToRemote(repo, asset.id, row)
      markResolved(row.id)
      const reconciled = await reconcileAfterConflict(repo, layout, policies)
      outgoingChangeId =
        reconciled.find((entry) => entry.assetId === asset.id && entry.direction === 'outgoing')?.id ??
        undefined
      if (asset.kind === 'contract') markContractProjectionsStale(asset.id)
      ctx.audit.log({
        type: 'conflict',
        repoId: repo.id,
        assetId: asset.id,
        title: 'Conflict resolved by keeping local content',
        detail: { strategy, note: note ?? '', outgoingChangeId },
      })
      return {
        changeId: row.id,
        resolved: true,
        strategy,
        localRevisionId: localRevision.id,
        ...(outgoingChangeId ? { outgoingChangeId } : {}),
      }
    }

    // Manual merge.
    const merged = input.mergedFiles ?? []
    if (!merged.length) {
      throw new AppError('VALIDATION', 'A manual merge needs at least one merged file.')
    }
    const localRevision = ctx.assets.currentRevisionOrNull(asset.id)
    const localFiles: NewAssetFile[] = localRevision
      ? ctx.assets.revisionFiles(localRevision.id).map((file) => ({
          path: file.path,
          content: ctx.blobs.readSync(file.blobHash),
          mediaKind: file.mediaKind,
          isExecutable: file.isExecutable,
        }))
      : []
    const remoteFiles: NewAssetFile[] = remote
      ? remote.files.map((file) => ({
          path: file.assetPath,
          content: file.content,
          mediaKind: file.mediaKind,
          isExecutable: file.isExecutable,
        }))
      : []
    let baseFiles: NewAssetFile[]
    if (asset.kind === 'skill') {
      // Keep local-only files and prefer the repository version on shared paths.
      const byPath = new Map<string, NewAssetFile>()
      for (const file of localFiles) byPath.set(file.path, file)
      for (const file of remoteFiles) byPath.set(file.path, file)
      baseFiles = [...byPath.values()]
    } else {
      baseFiles = remoteFiles.length ? [remoteFiles[0]] : localFiles.slice(0, 1)
    }
    if (!baseFiles.length) {
      throw new AppError('VALIDATION', 'There is no content to merge for this conflict.')
    }
    const allowed = new Set(baseFiles.map((file) => file.path))
    for (const file of merged) {
      if (!allowed.has(file.path)) {
        throw new AppError('VALIDATION', `The merged file ${file.path} is not part of this conflict.`)
      }
    }
    const mergedMap = new Map(merged.map((file) => [file.path, file.content]))
    const files: NewAssetFile[] = baseFiles.map((file) => {
      const override = mergedMap.get(file.path)
      const content = override !== undefined ? Buffer.from(override, 'utf8') : file.content
      return {
        path: file.path,
        content,
        mediaKind: override !== undefined ? 'text' : file.mediaKind,
        isExecutable: file.isExecutable,
      }
    })
    validateMergedFiles(asset.kind, files)
    const scanFindings = scanFiles(
      files
        .filter((file) => (file.mediaKind ?? 'text') === 'text')
        .map((file) => ({ path: file.path, content: Buffer.from(file.content).toString('utf8') })),
      asset.kind === 'mcp' ? '${VAR}' : '{{variable}}',
    )
    if (scanFindings.some((finding) => finding.confidence === 'high')) {
      throw new AppError(
        'SECURITY_BLOCK',
        'The merged content still contains likely credentials.',
        { kind: 'security-block', operation: 'apply', findings: scanFindings },
      )
    }
    const revision = ctx.assets.addRevision(
      asset.id,
      files,
      `Manual conflict merge (local v${ctx.assets.currentRevision(asset.id).version}, remote ${row.remote_commit?.slice(0, 8) ?? ''})${note ? `: ${note}` : ''}`,
    )
    applyStructuredFromFiles(ctx, asset, files)
    setBaseToRemote(repo, asset.id, row)
    markResolved(row.id)
    const reconciled = await reconcileAfterConflict(repo, layout, policies)
    outgoingChangeId =
      reconciled.find((entry) => entry.assetId === asset.id && entry.direction === 'outgoing')?.id ??
      undefined
    ctx.audit.log({
      type: 'conflict',
      repoId: repo.id,
      assetId: asset.id,
      title: 'Conflict resolved with a manual merge',
      detail: { strategy, note: note ?? '', outgoingChangeId },
    })
    return {
      changeId: row.id,
      resolved: true,
      strategy,
      localRevisionId: revision.id,
      ...(outgoingChangeId ? { outgoingChangeId } : {}),
    }
  }

  function setBaseToRemote(repo: RepoRow, assetId: string, row: SyncChangeListRow): void {
    ctx.db
      .prepare(
        `INSERT INTO repo_assets (repo_id, asset_id, remote_path, base_commit, base_revision_id, base_manifest_hash, last_synced_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(repo_id, asset_id) DO UPDATE SET
           remote_path = excluded.remote_path,
           base_commit = excluded.base_commit,
           base_revision_id = NULL,
           base_manifest_hash = excluded.base_manifest_hash,
           last_synced_at = excluded.last_synced_at`,
      )
      .run(repo.id, assetId, row.remote_path, row.remote_commit, row.remote_blob_hash, nowIso())
  }

  async function reconcileAfterConflict(
    repo: RepoRow,
    layout: RepoLayout,
    policies: RepoPolicies,
  ): Promise<Array<{ id: string; assetId: string | null; direction: SyncDirection }>> {
    try {
      const commit = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
      if (!commit) return []
      const scan = await scanRepository(client, repo.local_path, commit, layout)
      reconcileChanges(ctx, repo, layout, policies, scan, commit)
      return ctx.db
        .prepare(
          "SELECT id, asset_id AS assetId, direction FROM sync_changes WHERE repo_id = ? AND status IN ('open','reviewed')",
        )
        .all(repo.id) as Array<{ id: string; assetId: string | null; direction: SyncDirection }>
    } catch {
      return []
    }
  }

  function validateMergedFiles(kind: AssetKind, files: NewAssetFile[]): void {
    if (!files.length) throw new AppError('VALIDATION', 'The merged content is empty.')
    if (kind === 'skill') {
      const main = files.find((file) => file.path === 'SKILL.md')
      if (!main) throw new AppError('VALIDATION', 'A merged skill must keep SKILL.md at its root.')
      for (const file of files) {
        if (file.path === 'SKILL.md') {
          const parsed = parseSkillFile(Buffer.from(file.content).toString('utf8'), file.path, 'skill')
          if (!parsed.meta) throw new AppError('VALIDATION', parsed.error ?? 'Invalid SKILL.md.')
        }
      }
      return
    }
    if (files.length !== 1) {
      throw new AppError('VALIDATION', 'The merged asset must contain exactly one file.')
    }
    const main = files[0]
    const text = Buffer.from(main.content).toString('utf8')
    if (kind === 'prompt') {
      const parsed = parsePromptFile(text, main.path)
      if (!parsed.model) throw new AppError('VALIDATION', parsed.error ?? 'The merged prompt is not valid.')
    } else if (kind === 'contract') {
      const parsed = parseContractFile(text, main.path)
      if (!parsed.model) throw new AppError('VALIDATION', parsed.error ?? 'The merged contract is not valid.')
    } else {
      const parsed = parseMcpFile(text, main.path)
      if (!parsed.model) throw new AppError('VALIDATION', parsed.error ?? 'The merged MCP file is not valid.')
    }
  }

  function applyStructuredFromFiles(ctx: AppContext, asset: AssetRecord, files: NewAssetFile[]): void {
    const main = files.find((file) => file.path.endsWith('.prompt.md') || file.path.endsWith('.contract.md') || file.path.endsWith('.json'))
    if (!main) return
    const text = Buffer.from(main.content).toString('utf8')
    if (asset.kind === 'prompt') {
      const parsed = parsePromptFile(text, main.path)
      if (parsed.model) {
        ctx.db
          .prepare(
            'UPDATE prompts SET system_prompt = ?, user_prompt = ?, variables_json = ? WHERE asset_id = ?',
          )
          .run(parsed.model.systemPrompt, parsed.model.userPrompt, JSON.stringify(parsed.model.variables), asset.id)
      }
    } else if (asset.kind === 'contract') {
      const parsed = parseContractFile(text, main.path)
      if (parsed.model) {
        ctx.db
          .prepare(
            'UPDATE contracts SET body = ?, scope = ?, path_prefix = ?, activation_json = ?, priority = ?, imports_json = ?, target_ids_json = ? WHERE asset_id = ?',
          )
          .run(
            parsed.model.body,
            parsed.model.scope,
            parsed.model.pathPrefix,
            JSON.stringify(parsed.model.activation),
            parsed.model.priority,
            JSON.stringify(parsed.model.imports),
            JSON.stringify(parsed.model.targetIds),
            asset.id,
          )
      }
    } else if (asset.kind === 'mcp') {
      const parsed = parseMcpFile(text, main.path)
      if (parsed.model) {
        upsertStructured(ctx, asset.id, {
          kind: 'mcp',
          id: parsed.model.id,
          title: parsed.model.title,
          description: parsed.model.description,
          folder: parsed.model.folder,
          slug: asset.slug,
          tags: parsed.model.tags,
          syncPolicy: 'inherit',
          mainPath: main.path,
          dirPath: null,
          files: [],
          manifest: [],
          digest: '',
          textFiles: [],
          risk: [],
          blocked: false,
          promptModel: null,
          contractModel: null,
          mcpModel: parsed.model,
          skillModel: null,
        })
      }
    }
  }

  /* -------------------------- repo update -------------------------- */

  async function repoUpdate(input: RepoUpdateInput): Promise<RepoStatus> {
    const repo = requireRepo(ctx)
    assertNoActiveSyncOperation()
    const currentPolicies = policiesOf(repo)
    const nextPolicies = sanitizePolicies(input.policies, currentPolicies)
    const currentLayout = layoutOf(repo)
    const nextLayout = input.layout ? sanitizeLayout({ ...currentLayout, ...input.layout }) : currentLayout
    const autoFetch = input.autoFetch ?? !!repo.auto_fetch
    const fetchIntervalMin = input.fetchIntervalMin ?? repo.fetch_interval_min
    if (!Number.isFinite(fetchIntervalMin) || fetchIntervalMin < 5 || fetchIntervalMin > 1_440) {
      throw new AppError('VALIDATION', 'The fetch interval must be between 5 and 1440 minutes.')
    }
    const pushMode = input.pushMode ?? repo.push_mode
    if (pushMode !== 'direct' && pushMode !== 'branch') {
      throw new AppError('VALIDATION', 'The push method is not valid.')
    }

    const disabledKinds = (Object.keys(nextPolicies) as Array<keyof RepoPolicies>).filter(
      (key) => currentPolicies[key] && !nextPolicies[key],
    )
    if (disabledKinds.length && input.confirmPolicyWithdrawal !== true) {
      const kinds = disabledKinds.map((key) =>
        key === 'prompts' ? 'prompt' : key === 'contracts' ? 'contract' : key === 'skills' ? 'skill' : 'mcp',
      ) as AssetKind[]
      const placeholders = kinds.map(() => '?').join(',')
      const pending = (
        ctx.db
          .prepare(
            `SELECT COUNT(*) AS count FROM sync_changes WHERE repo_id = ? AND status IN ('open','reviewed') AND asset_kind IN (${placeholders})`,
          )
          .get(repo.id, ...kinds) as { count: number }
      ).count
      if (pending > 0) {
        throw new AppError(
          'CONFLICT',
          'Turning off this policy withdraws pending changes. Confirm the withdrawal to continue.',
        )
      }
    }

    let authMode = repo.auth_mode
    let sshKeyPath: string | null | undefined
    if (input.auth) {
      if (input.auth.mode === 'credential') {
        authMode = 'credential'
        sshKeyPath = null
        try {
          ctx.secrets.deleteOwner('git_token', repo.id)
        } catch {
          // No token to clear.
        }
      } else if (input.auth.mode === 'ssh') {
        authMode = 'ssh'
        try {
          ctx.secrets.deleteOwner('git_token', repo.id)
        } catch {
          // No token to clear.
        }
        if (input.auth.keyPath !== undefined) {
          if (input.auth.keyPath === '') {
            sshKeyPath = null
          } else {
            if (!isAbsolute(input.auth.keyPath)) {
              throw new AppError('VALIDATION', 'The SSH key path must be absolute.')
            }
            await validateSshKey(input.auth.keyPath)
            sshKeyPath = input.auth.keyPath
          }
        }
      } else {
        authMode = 'token'
        sshKeyPath = null
        if (input.auth.clearToken) {
          ctx.secrets.deleteOwner('git_token', repo.id)
        } else if (input.auth.token !== undefined) {
          const token = input.auth.token.trim()
          if (!token) throw new AppError('VALIDATION', 'The repository token is empty.')
          if (!ctx.secrets.available()) {
            throw new AppError(
              'UNSUPPORTED',
              ctx.secrets.reason() ?? 'Secure secret storage is unavailable.',
              { kind: 'unsupported', feature: 'safeStorage', reason: 'unavailable' },
            )
          }
          ctx.secrets.set('git_token', repo.id, 'token', token)
        } else if (!hasRepoToken(ctx, repo.id)) {
          throw new AppError('GIT_AUTH', 'A token is required for token authentication.')
        }
      }
    }

    const at = nowIso()
    ctx.db
      .prepare(
        `UPDATE repos SET policies_json = ?, layout_json = ?, auto_fetch = ?, fetch_interval_min = ?, push_mode = ?, auth_mode = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify(nextPolicies),
        JSON.stringify(nextLayout),
        autoFetch ? 1 : 0,
        fetchIntervalMin,
        pushMode,
        authMode,
        at,
        repo.id,
      )
    if (sshKeyPath !== undefined) {
      if (sshKeyPath) setSetting(ctx, sshKeySettingKey(repo.id), sshKeyPath)
      else ctx.db.prepare('DELETE FROM settings WHERE key = ?').run(sshKeySettingKey(repo.id))
    }

    if (disabledKinds.length) {
      const kinds = disabledKinds.map((key) =>
        key === 'prompts' ? 'prompt' : key === 'contracts' ? 'contract' : key === 'skills' ? 'skill' : 'mcp',
      ) as AssetKind[]
      const placeholders = kinds.map(() => '?').join(',')
      ctx.db
        .prepare(
          `UPDATE sync_changes SET status = 'resolved', updated_at = ? WHERE repo_id = ? AND status IN ('open','reviewed') AND asset_kind IN (${placeholders})`,
        )
        .run(nowIso(), repo.id, ...kinds)
      ctx.audit.log({
        type: 'review',
        repoId: repo.id,
        title: 'Repository policies updated',
        detail: { withdrawnKinds: kinds },
      })
    }

    const layoutChanged = JSON.stringify(currentLayout) !== JSON.stringify(nextLayout)
    if (layoutChanged) {
      try {
        const commit = await client.remoteHead(repo.local_path, REMOTE_NAME, repo.branch)
        if (commit) {
          const scan = await scanRepository(client, repo.local_path, commit, nextLayout)
          reconcileChanges(
            ctx,
            { ...repo, policies_json: JSON.stringify(nextPolicies), layout_json: JSON.stringify(nextLayout) },
            nextLayout,
            nextPolicies,
            scan,
            commit,
          )
        }
      } catch {
        // The next fetch recomputes changes for the new layout.
      }
    }
    ctx.audit.log({
      type: 'connect',
      repoId: repo.id,
      title: 'Repository settings updated',
      detail: {
        policies: nextPolicies,
        layoutChanged,
        pushMode,
        autoFetch,
        fetchIntervalMin,
        authMode,
        tokenStored: hasRepoToken(ctx, repo.id),
        ...(disabledKinds.length ? { withdrawnKinds: disabledKinds } : {}),
      },
    })
    ctx.events.domainChanged('sync', 'synced', [])
    return buildRepoStatus({ ...repo, auth_mode: authMode })
  }

  /* -------------------------- disconnect -------------------------- */

  async function repoDisconnect(input: RepoDisconnectInput): Promise<RepoDisconnectResult> {
    if (input.confirm !== true) {
      throw new AppError('VALIDATION', 'Disconnecting a repository requires confirmation.', {
        kind: 'validation',
        fields: [{ path: 'confirm', message: 'Set confirm to true.' }],
      })
    }
    const repo = requireRepo(ctx)
    assertNoActiveSyncOperation()
    ctx.db.prepare('DELETE FROM sync_changes WHERE repo_id = ?').run(repo.id)
    ctx.db.prepare('DELETE FROM repo_assets WHERE repo_id = ?').run(repo.id)
    ctx.db.prepare('DELETE FROM repos WHERE id = ?').run(repo.id)
    try {
      ctx.secrets.deleteOwner('git_token', repo.id)
    } catch {
      // No token stored.
    }
    ctx.db.prepare('DELETE FROM settings WHERE key = ?').run(sshKeySettingKey(repo.id))
    clearFetchError(ctx, repo.id)
    aheadCache.delete(repo.id)

    let cloneDeleted = false
    if (input.deleteManagedClone === true && repo.clone_mode === 'managed') {
      if (isPathInside(ctx.paths.repos, repo.local_path)) {
        if (await pathExists(repo.local_path)) cloneDeleted = await removeIfExists(repo.local_path)
      } else {
        ctx.logger.warn('sync', 'Refused to delete a managed clone outside the managed repository directory')
      }
    }
    ctx.audit.log({
      type: 'connect',
      repoId: repo.id,
      title: 'Repository disconnected',
      detail: { cloneDeleted },
    })
    ctx.events.domainChanged('sync', 'synced', [])
    return { disconnected: true, cloneDeleted }
  }

  /* -------------------------- scheduler -------------------------- */

  let autoFetchRunning = false
  let autoFetchFailures = 0
  let autoFetchTimer: NodeJS.Timeout | null = null

  async function tickAutoFetch(): Promise<void> {
    if (autoFetchRunning) return
    autoFetchRunning = true
    try {
      const repo = loadRepo(ctx)
      if (!repo || !repo.auto_fetch) return
      const intervalMs = Math.max(repo.fetch_interval_min, 1) * 60_000
      const backoff = autoFetchFailures > 0 ? Math.min(2 ** autoFetchFailures, 8) : 1
      const jitter = 0.9 + Math.random() * 0.2
      const last = nowMs(repo.last_fetched_at ?? repo.created_at)
      if (Date.now() < last + intervalMs * backoff * jitter) return
      if (ctx.operations.isActive()) return
      if (!(await isOnline())) return
      if (ctx.operations.activeRefs().some((ref) => isSyncOperationType(ref.type))) return
      ctx.operations.start<FetchResult>(
        'sync_fetch',
        async (op) => {
          try {
            const result = await runFetch(repo, op)
            autoFetchFailures = 0
            return result
          } catch (error) {
            autoFetchFailures += 1
            throw error
          }
        },
        { repoId: repo.id, cancellable: true, sync: true },
      )
      ctx.logger.info('sync', 'Auto-fetch started', { repoId: repo.id })
    } catch (error) {
      autoFetchFailures += 1
      ctx.logger.warn('sync', 'Auto-fetch could not start', {
        message: toAppError(error).message,
      })
    } finally {
      autoFetchRunning = false
    }
  }

  autoFetchTimer = setInterval(() => {
    void tickAutoFetch()
  }, AUTO_FETCH_TICK_MS)
  autoFetchTimer.unref?.()
  void autoFetchTimer

  return {
    async repoGet() {
      const repo = loadRepo(ctx)
      if (!repo) return null
      try {
        return await buildRepoStatus(repo)
      } catch {
        const base = repoStatusRow(ctx)
        return base
      }
    },
    async repoConnect(input) {
      const existing = loadRepo(ctx)
      if (existing) {
        throw new AppError('CONFLICT', 'A repository is already connected to this workspace.')
      }
      const plan = planConnect(input)
      if (input.confirm !== true) return repoPreview(plan, input)
      return repoApply(plan, input)
    },
    repoDisconnect,
    repoUpdate,
    async fetch(input) {
      const ref = await fetchOperation(input, { automatic: false })
      if (!ref) throw new AppError('LOCKED', 'Another repository operation is running.')
      return ref
    },
    async changes(query) {
      return changes(query)
    },
    changeDetail,
    review,
    pull,
    push,
    conflictResolve,
    async history(query: SyncHistoryQuery): Promise<Page<AuditEvent>> {
      return ctx.audit.list(query)
    },
    async cancel(input: { operationId: string }): Promise<CancelResult> {
      return { cancelled: ctx.operations.cancel(input.operationId) }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

async function isOnline(): Promise<boolean> {
  interface ElectronNetModule {
    net?: { isOnline?: () => boolean }
  }
  try {
    const electron = (await import('electron')) as unknown as ElectronNetModule
    return electron.net?.isOnline ? electron.net.isOnline() : true
  } catch {
    return true
  }
}
