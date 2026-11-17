export type ThemeMode = 'light' | 'dark' | 'system'
export type InstallMode = 'symlink' | 'copy'
export type PromptVariableType = 'text' | 'textarea' | 'number' | 'select'

/** 版本快照：data 为该版本的字段内容（按资产类型不同而不同） */
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
  tags: string[]
  instructions: string
  /** platformId -> 安装方式；'external' 表示外部安装（非本应用写入） */
  installs: Record<string, InstallMode | 'external'>
  versions: VersionSnapshot[]
  installedAt?: string
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
  tags: string[]
  source: McpSourceKind
  /** platformId -> 已由本应用写入 */
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

/* ---------------- Git 仓库同步 ---------------- */

export type AssetKind = 'skill' | 'mcp' | 'prompt'
export type SyncDirection = 'incoming' | 'outgoing' | 'conflict'
export type SyncChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'
/** none=低风险；scripts=含可执行脚本；secrets=含明文密钥；network=会访问网络 */
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
  layout: { skills: string; mcp: string; prompts: string }
  /** 资产是否参与仓库同步；Prompt 默认关闭 */
  policies: { skills: boolean; mcp: boolean; prompts: boolean }
}

export interface SyncChange {
  id: string
  kind: AssetKind
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

/* ---------------- 平台 Prompt 发现 ---------------- */

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
  prompts: Prompt[]
  skills: Skill[]
  mcps: McpServer[]
  settings: { theme: ThemeMode }
  repo: RepoConfig
  syncChanges: SyncChange[]
  deployments: Deployment[]
  syncEvents: SyncEvent[]
  /** 本机检测到的 Agent id；用于分发矩阵默认视图 */
  detectedAgents: string[]
}
