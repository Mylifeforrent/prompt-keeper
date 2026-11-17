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

export interface AppState {
  prompts: Prompt[]
  skills: Skill[]
  mcps: McpServer[]
  settings: { theme: ThemeMode }
}
