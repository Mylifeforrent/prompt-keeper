import type { ContractTarget } from '../types'

/**
 * 目标注册表：厂商差异只描述为「文件 + 格式 + 激活能力 + 合并规则」，
 * 不按厂商拆工作区。新增工具时只加一条数据，不改 UI。
 */
export const CONTRACT_TARGETS: ContractTarget[] = [
  {
    id: 'agents-md',
    agentId: 'agents',
    agentName: 'AGENTS.md 生态',
    label: 'AGENTS.md',
    format: 'agents-md',
    pathTemplate: 'AGENTS.md',
    merge: 'single-file',
    precedence: 'nearest',
    supports: { globs: false, modelDecision: false, manual: false, imports: false },
    maxBytes: 32768,
    note: 'Codex / Copilot / Cursor / Windsurf / opencode 等读取；Codex 默认合并上限 32 KiB，嵌套文件就近优先。',
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
    note: '从仓库根到当前目录拼接；支持 @import，最多 4 跳；无 CLAUDE.md 时回退 AGENTS.md。',
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
    note: '仓库级常驻指令；路径级规则请使用 .github/instructions/*.instructions.md。',
  },
  {
    id: 'copilot-path',
    agentId: 'copilot-path',
    agentName: 'GitHub Copilot（路径级）',
    label: '.instructions.md',
    format: 'copilot-path',
    pathTemplate: '.github/instructions/{slug}.instructions.md',
    merge: 'per-contract',
    precedence: 'concat',
    supports: { globs: true, modelDecision: false, manual: false, imports: false },
    note: 'frontmatter 使用 applyTo glob；匹配路径与仓库级指令会同时提供给 Copilot。',
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
    note: 'frontmatter 支持 description / globs / alwaysApply；四条激活路径（常驻 / 按文件 / 模型判断 / 手动）。',
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
    note: 'trigger 四态：always_on / glob / model_decision / manual；global_rules.md 另行管理。',
  },
]

export const TARGET_BY_ID: Record<string, ContractTarget> = Object.fromEntries(
  CONTRACT_TARGETS.map((t) => [t.id, t]),
)

export function contractTarget(targetId: string): ContractTarget | undefined {
  return TARGET_BY_ID[targetId]
}

/** 单文件目标按文件去重，用于解释「一条文件承载多条契约」 */
export function isSingleFileTarget(targetId: string): boolean {
  return TARGET_BY_ID[targetId]?.merge === 'single-file'
}
