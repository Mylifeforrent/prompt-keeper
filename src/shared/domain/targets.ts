import type {
  ContractActivationMode,
  ContractFileModel,
  ContractTarget,
  DispatchAgent,
  GlobalTargetDetail,
  TargetCompatibility,
} from '../contracts'
import { safePathSegment } from './folders'

export type Platform = 'darwin' | 'win32'

/**
 * Project-level target registry. Vendor behavior lives in data; adding a target
 * means adding an entry plus contract tests, never a new workspace.
 */
export const PROJECT_TARGETS: ContractTarget[] = [
  {
    id: 'agents-md',
    agentId: 'agents',
    agentName: 'AGENTS.md ecosystem',
    label: 'AGENTS.md',
    format: 'agents-md',
    pathTemplate: 'AGENTS.md',
    merge: 'single-file',
    precedence: 'nearest',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    maxBytes: 32768,
    note: 'Read by Codex, GitHub Copilot, Cursor, Windsurf, OpenCode, and others. Codex merges up to 32 KiB by default; nested files take precedence by proximity.',
  },
  {
    id: 'claude',
    agentId: 'claude',
    agentName: 'Claude Code',
    label: 'CLAUDE.md',
    format: 'claude-md',
    pathTemplate: 'CLAUDE.md',
    merge: 'single-file',
    precedence: 'concat',
    supports: { globs: false, modelDecision: false, manual: false, imports: true },
    note: 'Concatenated from the repository root down to the current directory. Supports @import up to four hops and falls back to AGENTS.md when no CLAUDE.md exists.',
  },
  {
    id: 'copilot',
    agentId: 'copilot',
    agentName: 'GitHub Copilot',
    label: '.github/copilot-instructions.md',
    format: 'copilot-instructions',
    pathTemplate: '.github/copilot-instructions.md',
    merge: 'single-file',
    precedence: 'concat',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'Repository-level always-on instructions. Path-level rules belong to the separate path target.',
  },
  {
    id: 'copilot-path',
    agentId: 'copilot-path',
    agentName: 'GitHub Copilot (path-level)',
    label: '.github/instructions/*.instructions.md',
    format: 'copilot-path',
    pathTemplate: '.github/instructions/{slug}.instructions.md',
    merge: 'per-contract',
    precedence: 'concat',
    supports: { globs: true, modelDecision: false, manual: false, imports: false },
    note: 'Frontmatter uses applyTo globs. Matching paths and repository-level instructions are both provided to Copilot.',
  },
  {
    id: 'cursor',
    agentId: 'cursor',
    agentName: 'Cursor',
    label: '.cursor/rules/*.mdc',
    format: 'cursor-mdc',
    pathTemplate: '.cursor/rules/{slug}.mdc',
    merge: 'per-contract',
    precedence: 'nearest',
    supports: { globs: true, modelDecision: true, manual: true, imports: false },
    note: 'Frontmatter supports description, globs, and alwaysApply. Cursor can decide relevance from the description.',
  },
  {
    id: 'windsurf',
    agentId: 'windsurf',
    agentName: 'Windsurf',
    label: '.windsurf/rules/*.md',
    format: 'windsurf-rule',
    pathTemplate: '.windsurf/rules/{slug}.md',
    merge: 'per-contract',
    precedence: 'nearest',
    supports: { globs: true, modelDecision: true, manual: true, imports: false },
    note: 'Trigger modes are always_on, glob, model_decision, and manual. global_rules.md is managed as a separate global target.',
  },
]

export const TARGET_BY_ID: Record<string, ContractTarget> = Object.fromEntries(
  PROJECT_TARGETS.map((target) => [target.id, target]),
)

export function projectTarget(targetId: string): ContractTarget | undefined {
  return TARGET_BY_ID[targetId]
}

export interface GlobalTargetDef {
  id: string
  agentId: string
  agentName: string
  label: string
  description: string
  pathMode: 'file' | 'dir'
  darwin: string
  win32: string
  format: 'claude-md' | 'agents-md' | 'cursor-mdc' | 'windsurf-rule' | 'plain-md'
  merge: 'single-file' | 'per-contract'
  fileExt?: string
  supports: { globs: boolean; modelDecision: boolean; manual: boolean; imports: boolean }
  maxBytes?: number
  note: string
}

/** User-level instruction targets. Paths can be edited and stay local-only. */
export const GLOBAL_TARGET_DEFS: GlobalTargetDef[] = [
  {
    id: 'gt-claude',
    agentId: 'claude',
    agentName: 'Claude Code',
    label: 'Claude Global Memory',
    description: 'Writes to the user-level CLAUDE.md and applies to all projects. Supports @import.',
    pathMode: 'file',
    darwin: '~/.claude/CLAUDE.md',
    win32: '~/.claude/CLAUDE.md',
    format: 'claude-md',
    merge: 'single-file',
    supports: { globs: false, modelDecision: false, manual: false, imports: true },
    maxBytes: 32768,
    note: 'Claude Code reads CLAUDE.md from the user-level directory. Multiple contracts merge into managed blocks.',
  },
  {
    id: 'gt-codex',
    agentId: 'codex',
    agentName: 'Codex CLI',
    label: 'Codex Global AGENTS.md',
    description: 'Writes to the user-level AGENTS.md used as fallback instructions for every project.',
    pathMode: 'file',
    darwin: '~/.codex/AGENTS.md',
    win32: '~/.codex/AGENTS.md',
    format: 'agents-md',
    merge: 'single-file',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    maxBytes: 32768,
    note: 'Codex reads the user-level AGENTS.md. Project-level AGENTS.md files still apply by proximity.',
  },
  {
    id: 'gt-cursor',
    agentId: 'cursor',
    agentName: 'Cursor',
    label: 'Cursor Global Rules Directory',
    description: 'One .mdc file per contract, written to the user-level rules directory.',
    pathMode: 'dir',
    darwin: '~/.cursor/rules',
    win32: '~/.cursor/rules',
    format: 'cursor-mdc',
    merge: 'per-contract',
    fileExt: '.mdc',
    supports: { globs: true, modelDecision: true, manual: true, imports: false },
    note: 'Cursor user-level rules support description, globs, and alwaysApply activation.',
  },
  {
    id: 'gt-windsurf',
    agentId: 'windsurf',
    agentName: 'Windsurf',
    label: 'Windsurf Global Rules',
    description: 'Writes to the user-level global_rules.md and applies to all workspaces.',
    pathMode: 'file',
    darwin: '~/.codeium/windsurf/memories/global_rules.md',
    win32: '~/.codeium/windsurf/memories/global_rules.md',
    format: 'windsurf-rule',
    merge: 'single-file',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'Windsurf global rules are always on. Path-based activation belongs to project rules.',
  },
  {
    id: 'gt-opencode',
    agentId: 'opencode',
    agentName: 'OpenCode',
    label: 'OpenCode Global AGENTS.md',
    description: 'Writes to the OpenCode user-level AGENTS.md.',
    pathMode: 'file',
    darwin: '~/.config/opencode/AGENTS.md',
    win32: '%APPDATA%/opencode/AGENTS.md',
    format: 'agents-md',
    merge: 'single-file',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'OpenCode reads the user-level AGENTS.md. Project AGENTS.md files still apply by proximity.',
  },
  {
    id: 'gt-cline',
    agentId: 'cline',
    agentName: 'Cline',
    label: 'Cline Global Rules Directory',
    description: 'One Markdown file per contract, written to the user-level Rules directory.',
    pathMode: 'dir',
    darwin: '~/Documents/Cline/Rules',
    win32: '~/Documents/Cline/Rules',
    format: 'plain-md',
    merge: 'per-contract',
    fileExt: '.md',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'Cline global Rules are always-on Markdown. Conditional activation is not modeled for this target.',
  },
  {
    id: 'gt-kiro',
    agentId: 'kiro',
    agentName: 'Kiro',
    label: 'Kiro Global Steering',
    description: 'One Markdown file per contract, written to the user-level steering directory.',
    pathMode: 'dir',
    darwin: '~/.kiro/steering',
    win32: '~/.kiro/steering',
    format: 'plain-md',
    merge: 'per-contract',
    fileExt: '.md',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'Kiro steering inclusion conditions are not precisely simulated. Files are written as always-on rules.',
  },
  {
    id: 'gt-qoder',
    agentId: 'qoder',
    agentName: 'Qoder',
    label: 'Qoder Global Rules Directory',
    description: 'One Markdown file per contract, written to the user-level rules directory.',
    pathMode: 'dir',
    darwin: '~/.qoder/rules',
    win32: '~/.qoder/rules',
    format: 'plain-md',
    merge: 'per-contract',
    fileExt: '.md',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    note: 'Qoder global rules directory. The path can be edited to match the local installation.',
  },
]

export const GLOBAL_TARGET_BY_ID: Record<string, GlobalTargetDef> = Object.fromEntries(
  GLOBAL_TARGET_DEFS.map((target) => [target.id, target]),
)

export interface AgentDef {
  id: string
  name: string
  supportsSkills: boolean
  supportsMcp: boolean
  darwin: { skillDir?: string; mcpFile?: string; mcpFormat?: 'json' | 'jsonc' | 'toml' }
  win32: { skillDir?: string; mcpFile?: string; mcpFormat?: 'json' | 'jsonc' | 'toml' }
}

export const AGENT_DEFS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    supportsSkills: true,
    supportsMcp: true,
    darwin: { skillDir: '~/.claude/skills', mcpFile: '~/.claude.json', mcpFormat: 'json' },
    win32: { skillDir: '~/.claude/skills', mcpFile: '~/.claude.json', mcpFormat: 'json' },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    supportsSkills: true,
    supportsMcp: true,
    darwin: { skillDir: '~/.codex/skills', mcpFile: '~/.codex/config.toml', mcpFormat: 'toml' },
    win32: { skillDir: '~/.codex/skills', mcpFile: '~/.codex/config.toml', mcpFormat: 'toml' },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    supportsSkills: true,
    supportsMcp: true,
    darwin: { skillDir: '~/.cursor/skills', mcpFile: '~/.cursor/mcp.json', mcpFormat: 'json' },
    win32: { skillDir: '~/.cursor/skills', mcpFile: '~/.cursor/mcp.json', mcpFormat: 'json' },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    supportsSkills: true,
    supportsMcp: true,
    darwin: {
      skillDir: '~/.codeium/windsurf/skills',
      mcpFile: '~/.codeium/windsurf/mcp_config.json',
      mcpFormat: 'json',
    },
    win32: {
      skillDir: '~/.codeium/windsurf/skills',
      mcpFile: '~/.codeium/windsurf/mcp_config.json',
      mcpFormat: 'json',
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    supportsSkills: true,
    supportsMcp: true,
    darwin: {
      skillDir: '~/.config/opencode/skills',
      mcpFile: '~/.config/opencode/opencode.json',
      mcpFormat: 'jsonc',
    },
    win32: {
      skillDir: '%APPDATA%/opencode/skills',
      mcpFile: '%APPDATA%/opencode/opencode.json',
      mcpFormat: 'jsonc',
    },
  },
  {
    id: 'cline',
    name: 'Cline',
    supportsSkills: true,
    supportsMcp: true,
    darwin: {
      skillDir: '~/Documents/Cline/Skills',
      mcpFile: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      mcpFormat: 'json',
    },
    win32: {
      skillDir: '~/Documents/Cline/Skills',
      mcpFile: '%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      mcpFormat: 'json',
    },
  },
  {
    id: 'kiro',
    name: 'Kiro',
    supportsSkills: true,
    supportsMcp: true,
    darwin: { skillDir: '~/.kiro/skills', mcpFile: '~/.kiro/settings/mcp.json', mcpFormat: 'json' },
    win32: { skillDir: '~/.kiro/skills', mcpFile: '~/.kiro/settings/mcp.json', mcpFormat: 'json' },
  },
  {
    id: 'qoder',
    name: 'Qoder',
    supportsSkills: true,
    supportsMcp: true,
    darwin: { skillDir: '~/.qoder/skills', mcpFile: '~/.qoder/mcp.json', mcpFormat: 'json' },
    win32: { skillDir: '~/.qoder/skills', mcpFile: '~/.qoder/mcp.json', mcpFormat: 'json' },
  },
]

export function platformPath(def: { darwin: string; win32: string }, platform: Platform): string {
  return platform === 'win32' ? def.win32 : def.darwin
}

export function defaultGlobalTargetPath(def: GlobalTargetDef, platform: Platform): string {
  return platformPath(def, platform)
}

export function globalTargetDefinitions(platform: Platform): GlobalTargetDetail[] {
  const now = new Date().toISOString()
  return GLOBAL_TARGET_DEFS.map((def) => {
    const path = platformPath(def, platform)
    return {
      id: def.id,
      agentId: def.agentId,
      agentName: def.agentName,
      label: def.label,
      description: def.description,
      pathMode: def.pathMode,
      defaultPath: path,
      path,
      format: def.format,
      merge: def.merge,
      ...(def.fileExt ? { fileExt: def.fileExt } : {}),
      supports: def.supports,
      ...(def.maxBytes ? { maxBytes: def.maxBytes } : {}),
      note: def.note,
      exists: false,
      detected: false,
      projectionCount: 0,
      staleCount: 0,
      driftedCount: 0,
      updatedAt: now,
    }
  })
}

export function agentDefinitions(platform: Platform): DispatchAgent[] {
  return AGENT_DEFS.map((def) => {
    const paths = platform === 'win32' ? def.win32 : def.darwin
    return {
      id: def.id,
      name: def.name,
      detected: false,
      supportsSkills: def.supportsSkills,
      supportsMcp: def.supportsMcp,
      ...(paths.skillDir ? { skillDir: paths.skillDir } : {}),
      ...(paths.mcpFile ? { mcpFile: paths.mcpFile } : {}),
    }
  })
}

export function agentConfigFormat(agentId: string, platform: Platform): 'json' | 'jsonc' | 'toml' {
  const def = AGENT_DEFS.find((agent) => agent.id === agentId)
  if (!def) return 'json'
  return (platform === 'win32' ? def.win32.mcpFormat : def.darwin.mcpFormat) ?? 'json'
}

const ACTIVATION_FEATURE: Partial<
  Record<ContractActivationMode, 'globs' | 'modelDecision' | 'manual'>
> = {
  glob: 'globs',
  model: 'modelDecision',
  manual: 'manual',
}

/** Data-driven capability check. Incompatible targets are skipped, never silently downgraded. */
export function targetCompatibility(
  model: Pick<ContractFileModel, 'activation' | 'imports'>,
  target: Pick<ContractTarget, 'id' | 'supports' | 'label'>,
): TargetCompatibility {
  const unsupportedFeatures: Array<'globs' | 'modelDecision' | 'manual' | 'imports'> = []
  const warnings: string[] = []
  let blocking = false

  const feature = ACTIVATION_FEATURE[model.activation.mode]
  if (feature && !target.supports[feature]) {
    blocking = true
    unsupportedFeatures.push(feature)
    warnings.push(`${target.label} cannot represent activation mode "${model.activation.mode}"; this contract will be skipped for that target.`)
  }
  if (model.imports.length && !target.supports.imports) {
    unsupportedFeatures.push('imports')
    warnings.push(`${target.label} does not support @import; import paths will be written as plain text.`)
  }

  return {
    targetId: target.id,
    compatible: !blocking,
    blocking,
    unsupportedFeatures,
    warnings,
  }
}

export function resolveProjectTargetPath(
  target: Pick<ContractTarget, 'pathTemplate'>,
  projectRoot: string,
  contractSlug: string,
): string {
  const relative = target.pathTemplate.replace('{slug}', safePathSegment(contractSlug, contractSlug))
  return `${projectRoot.replace(/[\\/]+$/, '')}/${relative}`
}

export function resolveGlobalProjectionPath(
  target: Pick<GlobalTargetDetail, 'path' | 'pathMode' | 'merge' | 'fileExt'>,
  contractSlug: string,
): string {
  const base = target.path.replace(/[\\/]+$/, '')
  if (target.pathMode === 'file' || target.merge === 'single-file') return target.path
  const ext = target.fileExt ?? '.md'
  return `${base}/${safePathSegment(contractSlug, contractSlug)}${ext}`
}
