export type ThemeMode = 'light' | 'dark' | 'system'
export type InstallMode = 'symlink' | 'copy'
export type PromptVariableType = 'text' | 'textarea' | 'number' | 'select'

/** Version snapshot: data holds the field content for this version (it differs by asset type) */
export interface VersionSnapshot {
  id: string
  version: number
  note?: string
  createdAt: string
  data: Record<string, string>
}

export interface PromptVariable {
  name: string
  type: PromptVariableType
  label?: string
  example?: string
  options?: string[]
  required?: boolean
}

/** inherit=follow repository policy; sync=explicitly synced; local=local machine only */
export type PromptSyncPolicy = 'inherit' | 'sync' | 'local'

export interface Prompt {
  id: string
  title: string
  description: string
  systemPrompt: string
  userPrompt: string
  folder: string | null
  tags: string[]
  isFavorite: boolean
  isPinned: boolean
  usageCount: number
  variables: PromptVariable[]
  syncPolicy: PromptSyncPolicy
  /** Whether this Prompt already existed in the repository at the last sync; distinguishes outgoing additions from modifications */
  inRepo?: boolean
  versions: VersionSnapshot[]
  createdAt: string
  updatedAt: string
}

export type SkillSource = 'official' | 'community' | 'import' | 'scan'

export interface Skill {
  id: string
  name: string
  emoji: string
  description: string
  author: string
  version: string
  source: SkillSource
  category: string
  /** Folder path inside the library (may be nested, e.g. dev-workflow/git); also maps to a repository directory */
  folder: string | null
  tags: string[]
  instructions: string
  /** platformId -> install mode; 'external' means installed externally (not written by this app) */
  installs: Record<string, InstallMode | 'external'>
  versions: VersionSnapshot[]
  installedAt?: string
  updatedAt?: string
}

export interface StoreSkill {
  id: string
  name: string
  emoji: string
  description: string
  author: string
  version: string
  category: string
  downloads: number
  source: 'official' | 'community'
  instructions: string
  files: { path: string; size: string }[]
}

export type McpTransport = 'stdio' | 'http'
export type McpSourceKind = 'manual' | 'market' | 'import'

export interface McpServer {
  id: string
  name: string
  description: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  requiredEnv?: string[]
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  isFavorite: boolean
  /** Folder path inside the library; one JSON file per server is written to the repository */
  folder: string | null
  tags: string[]
  source: McpSourceKind
  /** platformId -> already written by this app */
  installs: Record<string, boolean>
  notes: string
  versions: VersionSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface McpStoreItem {
  id: string
  name: string
  description: string
  whatItDoes: string
  useCases: string[]
  installCommand: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  envDocs: { key: string; desc: string; placeholder: string }[]
}

export interface ModelOption {
  id: string
  name: string
}

export interface HealthIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}

export interface SkillPlatform {
  id: string
  name: string
  dir: string
}

export interface McpTarget {
  id: string
  name: string
  file: string
  format: 'json' | 'toml'
}

/* ---------------- Agent Instructions / Contracts ---------------- */

export type ContractScope = 'user' | 'project' | 'path'
export type ContractActivationMode = 'always' | 'glob' | 'model' | 'manual'

export interface ContractActivation {
  mode: ContractActivationMode
  /** Path patterns applied when mode=glob; supports ** / * / ? / {a,b} */
  globs: string[]
  /** Description given to the model for relevance decisions when mode=model */
  description?: string
}

export interface AgentContract {
  id: string
  title: string
  description: string
  body: string
  /** Folder path inside the library; also maps to a repository directory */
  folder: string | null
  scope: ContractScope
  /** Directory prefix when scope=path, e.g. src */
  path?: string
  activation: ContractActivation
  /** Higher values take precedence; only explains merge order, never silently overwrites */
  priority: number
  /** @import paths for Claude Code */
  imports: string[]
  /** Target registry id, e.g. agents-md / claude / cursor */
  targets: string[]
  tags: string[]
  syncPolicy: PromptSyncPolicy
  inRepo?: boolean
  versions: VersionSnapshot[]
  createdAt: string
  updatedAt: string
}

export type ContractFormat =
  | 'agents-md'
  | 'claude-md'
  | 'copilot-instructions'
  | 'copilot-path'
  | 'cursor-mdc'
  | 'windsurf-rule'

export interface ContractTarget {
  id: string
  agentId: string
  agentName: string
  label: string
  format: ContractFormat
  /** Target file path template; {slug} is replaced by the contract slug */
  pathTemplate: string
  /** single-file: multiple contracts merge into one file; per-contract: one file per contract */
  merge: 'single-file' | 'per-contract'
  /** nearest: more specific paths win; concat: concatenate from root to specific; override: nearest wins and overrides */
  precedence: 'nearest' | 'concat' | 'override'
  supports: { globs: boolean; modelDecision: boolean; manual: boolean; imports: boolean }
  maxBytes?: number
  note: string
}

export type ProjectionStatus = 'synced' | 'stale' | 'drifted' | 'missing'

export interface ContractProjection {
  id: string
  contractId: string
  targetId: string
  status: Exclude<ProjectionStatus, 'missing'>
  deployedVersion: string
  previousVersion?: string
  deployedAt?: string
  note?: string
  /** Display info kept after the local contract is deleted, to help clean up orphan projections */
  contractTitle?: string
  contractSlug?: string
}

/** Global instruction targets for local agents; users may edit paths, and writes go only to local machine directories */
export interface AgentGlobalTarget {
  id: string
  agentId: string
  agentName: string
  label: string
  description: string
  /** file = path points to a file; dir = path points to a directory, one separate file per contract */
  pathMode: 'file' | 'dir'
  defaultPath: string
  path: string
  format: 'claude-md' | 'agents-md' | 'cursor-mdc' | 'windsurf-rule' | 'plain-md'
  merge: 'single-file' | 'per-contract'
  fileExt?: string
  supports: { globs: boolean; modelDecision: boolean; manual: boolean; imports: boolean }
  maxBytes?: number
  note: string
}

export interface GlobalProjection {
  id: string
  contractId: string
  targetId: string
  status: Exclude<ProjectionStatus, 'missing'>
  deployedVersion: string
  previousVersion?: string
  deployedAt?: string
  note?: string
  /** Display info kept after the local contract is deleted */
  contractTitle?: string
  contractSlug?: string
}

export interface ResolvedContractEntry {
  contractId: string
  title: string
  sourcePath: string
  /** Why it enters the current context, e.g. "Project · Always on" */
  reason: string
  bytes: number
}

export interface SkippedContractEntry {
  contractId: string
  title: string
  reason: string
}

export interface ResolvedPreview {
  targetId: string
  filePath: string
  included: ResolvedContractEntry[]
  skipped: SkippedContractEntry[]
  totalBytes: number
  maxBytes?: number
  warnings: string[]
}

/* ---------------- Git repository sync ---------------- */

export type AssetKind = 'skill' | 'mcp' | 'prompt' | 'contract'
export type SyncDirection = 'incoming' | 'outgoing' | 'conflict'
export type SyncChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'
/** none=low risk; scripts=contains executable scripts; secrets=contains plaintext secret; network=network access */
export type SyncRisk = 'none' | 'scripts' | 'secrets' | 'network'

export interface RepoConfig {
  connected: boolean
  provider: 'github' | 'gitlab' | 'generic'
  url: string
  branch: string
  localPath: string
  auth: 'credential' | 'ssh' | 'token'
  autoFetch: boolean
  fetchIntervalMin: number
  pushMode: 'direct' | 'branch-pr'
  lastFetchedAt?: string
  lastSyncedAt?: string
  ahead: number
  behind: number
  layout: { skills: string; mcp: string; prompts: string; contracts: string }
  /** Whether assets participate in repository sync; off by default for Prompts */
  policies: { skills: boolean; mcp: boolean; prompts: boolean; contracts: boolean }
}

export interface SyncChange {
  id: string
  kind: AssetKind
  /** Stable asset identifier; still matches the same asset after a rename (required for Prompts) */
  assetId?: string
  assetName: string
  path: string
  change: SyncChangeKind
  direction: SyncDirection
  summary: string
  additions: number
  deletions: number
  risk: SyncRisk
  versionLabel?: string
  remoteVersion?: string
  localVersion?: string
  baseVersion?: string
  remoteContent?: string
  localContent?: string
  baseContent?: string
  files?: { path: string; size: string }[]
  resolved?: boolean
  blocked?: boolean
}

export interface AgentRuntime {
  id: string
  name: string
  skillDir: string
  mcpFile: string
  supportsSkills: boolean
  supportsMcp: boolean
}

export type FanoutStatus = 'synced' | 'stale' | 'drifted' | 'missing' | 'paused'

export interface Deployment {
  id: string
  kind: 'skill' | 'mcp'
  assetId: string
  assetName: string
  agentId: string
  mode: InstallMode
  status: FanoutStatus
  deployedVersion: string
  previousVersion?: string
  deployedAt: string
  note?: string
}

export type SyncEventType =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'conflict'
  | 'deploy'
  | 'blocked'
  | 'connect'
  | 'rollback'
  | 'review'

export interface SyncEvent {
  id: string
  at: string
  type: SyncEventType
  title: string
  detail?: string
  result: 'success' | 'warning' | 'error'
}

/* ---------------- Platform Prompt discovery ---------------- */

export interface PromptPlatformItem {
  id: string
  title: string
  description: string
  author: string
  category: string
  tags: string[]
  systemPrompt: string
  userPrompt: string
  variables: PromptVariable[]
  uses: number
  updatedAt: string
}

export interface AppState {
  /** localStorage schema version; used for legacy data migration */
  schemaVersion: number
  prompts: Prompt[]
  contracts: AgentContract[]
  skills: Skill[]
  mcps: McpServer[]
  settings: { theme: ThemeMode }
  repo: RepoConfig
  syncChanges: SyncChange[]
  deployments: Deployment[]
  contractProjections: ContractProjection[]
  /** Global directory config for local agents; path can be edited by the user */
  globalTargets: AgentGlobalTarget[]
  globalProjections: GlobalProjection[]
  syncEvents: SyncEvent[]
  /** Agent ids detected on this machine; used for the default dispatch matrix view */
  detectedAgents: string[]
}
