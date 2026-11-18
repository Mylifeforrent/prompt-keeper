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

/** inherit=跟随仓库策略；sync=显式参与；local=仅本机 */
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
  /** 最近一次同步时仓库中是否已有该 Prompt；用于区分待推送新增 / 修改 */
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
  /** 库内文件夹路径（可多级，例如 开发流程/Git）；同时映射为仓库目录 */
  folder: string | null
  tags: string[]
  instructions: string
  /** platformId -> 安装方式；'external' 表示外部安装（非本应用写入） */
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
  /** 库内文件夹路径；每个 server 一个 JSON 文件写入仓库 */
  folder: string | null
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

/* ---------------- Agent 指令 / 契约 ---------------- */

export type ContractScope = 'user' | 'project' | 'path'
export type ContractActivationMode = 'always' | 'glob' | 'model' | 'manual'

export interface ContractActivation {
  mode: ContractActivationMode
  /** mode=glob 时生效的路径模式；支持 ** / * / ? / {a,b} */
  globs: string[]
  /** mode=model 时给模型判断相关性的描述 */
  description?: string
}

export interface AgentContract {
  id: string
  title: string
  description: string
  body: string
  /** 库内文件夹路径；同时映射为仓库目录 */
  folder: string | null
  scope: ContractScope
  /** scope=path 时的目录前缀，例如 src */
  path?: string
  activation: ContractActivation
  /** 数值越大越优先；仅用于解释合并顺序，不做静默覆盖 */
  priority: number
  /** Claude Code 的 @import 路径 */
  imports: string[]
  /** 目标注册表 id，例如 agents-md / claude / cursor */
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
  /** 目标文件路径模板；{slug} 会被契约 slug 替换 */
  pathTemplate: string
  /** single-file：多条契约合并进一个文件；per-contract：一条契约一个文件 */
  merge: 'single-file' | 'per-contract'
  /** nearest：更具体路径优先；concat：从根到具体拼接；override：就近覆盖 */
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
  /** 删除本地契约后保留的展示信息，便于清理孤儿投影 */
  contractTitle?: string
  contractSlug?: string
}

/** 本地 Agent 的全局指令目标；路径允许用户改写，写回仅到本机目录 */
export interface AgentGlobalTarget {
  id: string
  agentId: string
  agentName: string
  label: string
  description: string
  /** file = path 指向一个文件；dir = path 指向目录，按契约生成独立文件 */
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
  /** 删除本地契约后保留的展示信息 */
  contractTitle?: string
  contractSlug?: string
}

export interface ResolvedContractEntry {
  contractId: string
  title: string
  sourcePath: string
  /** 为什么进入当前上下文，例如「项目级 · 始终生效」 */
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

/* ---------------- Git 仓库同步 ---------------- */

export type AssetKind = 'skill' | 'mcp' | 'prompt' | 'contract'
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
  layout: { skills: string; mcp: string; prompts: string; contracts: string }
  /** 资产是否参与仓库同步；Prompt 默认关闭 */
  policies: { skills: boolean; mcp: boolean; prompts: boolean; contracts: boolean }
}

export interface SyncChange {
  id: string
  kind: AssetKind
  /** 资产稳定标识；重命名时仍能匹配同一资产（Prompt 必填） */
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
  /** localStorage 结构版本；用于旧数据迁移 */
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
  /** 本机 Agent 全局目录配置；path 可由用户二次修改 */
  globalTargets: AgentGlobalTarget[]
  globalProjections: GlobalProjection[]
  syncEvents: SyncEvent[]
  /** 本机检测到的 Agent id；用于分发矩阵默认视图 */
  detectedAgents: string[]
}
