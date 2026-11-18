import type { ContractTarget } from '../types'

/**
 * Target registry: vendor differences are described only as "file + format + activation capability + merge rules",
 * and the workspace is not split per vendor. Adding a new tool means adding one data entry, not changing the UI.
 */
export const CONTRACT_TARGETS: ContractTarget[] = [
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
    note: 'Read by Codex / Copilot / Cursor / Windsurf / opencode and others; Codex merges up to 32 KiB by default, and nested files take precedence by proximity.',
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
    note: 'Concatenated from the repo root down to the current directory; supports @import up to 4 hops; falls back to AGENTS.md when no CLAUDE.md exists.',
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
    note: 'Repository-level always-on instructions; for path-level rules use .github/instructions/*.instructions.md.',
  },
  {
    id: 'copilot-path',
    agentId: 'copilot-path',
    agentName: 'GitHub Copilot (path-level)',
    label: '.instructions.md',
    format: 'copilot-path',
    pathTemplate: '.github/instructions/{slug}.instructions.md',
    merge: 'per-contract',
    precedence: 'concat',
    supports: { globs: true, modelDecision: false, manual: false, imports: false },
    note: 'Frontmatter uses applyTo globs; matching paths and repository-level instructions are both provided to Copilot.',
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
    note: 'Frontmatter supports description / globs / alwaysApply; four activation paths (always on / by file / model decision / manual).',
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
    note: 'Four trigger states: always_on / glob / model_decision / manual; global_rules.md is managed separately.',
  },
]

export const TARGET_BY_ID: Record<string, ContractTarget> = Object.fromEntries(
  CONTRACT_TARGETS.map((t) => [t.id, t]),
)

export function contractTarget(targetId: string): ContractTarget | undefined {
  return TARGET_BY_ID[targetId]
}

/** Single-file targets are deduplicated per file, which explains "one file carries multiple contracts" */
export function isSingleFileTarget(targetId: string): boolean {
  return TARGET_BY_ID[targetId]?.merge === 'single-file'
}
