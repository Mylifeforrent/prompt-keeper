import type {
  AgentContract,
  ContractActivation,
  ContractScope,
  ContractTarget,
  ProjectionStatus,
  PromptSyncPolicy,
  RepoConfig,
  ResolvedPreview,
  SkippedContractEntry,
} from '../types'
import { CONTRACT_TARGETS, TARGET_BY_ID } from '../data/contractTargets'
import type { IconName } from './icons'
import { normalizeFolder, repoFilePath } from './folders'

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'outline'

export const CONTRACT_SCOPE_META: Record<ContractScope, { label: string; short: string; desc: string }> = {
  user: { label: 'User', short: 'User', desc: 'Applies to every project on this machine and is written only to the user directory.' },
  project: { label: 'Project', short: 'Project', desc: 'Written to the current repository root and shared along with the repository.' },
  path: { label: 'Path', short: 'Path', desc: 'Applies only within the specified directory and its subdirectories; good for module-level standards.' },
}

export const ACTIVATION_META: Record<
  ContractActivation['mode'],
  { label: string; short: string; desc: string }
> = {
  always: { label: 'Always on', short: 'Always', desc: 'Enters the context in every session; good for hard constraints like builds, testing, and security.' },
  glob: { label: 'By path (glob)', short: 'glob', desc: 'Activates when working on files that match the glob; targets that do not support globs are skipped.' },
  model: { label: 'Model decision', short: 'Model', desc: 'Provide a description and let the Agent judge relevance before referencing it.' },
  manual: { label: 'Manual', short: 'Manual', desc: 'Never enters the context automatically; only applies when the user explicitly references it with @.' },
}

export const PROJECTION_META: Record<ProjectionStatus, { label: string; variant: BadgeVariant; icon: IconName }> = {
  synced: { label: 'Projected', variant: 'success', icon: 'check' },
  stale: { label: 'Stale', variant: 'warning', icon: 'refresh' },
  drifted: { label: 'Drifted', variant: 'danger', icon: 'alert' },
  missing: { label: 'Not projected', variant: 'outline', icon: 'plus' },
}

export const CONTRACT_SYNC_POLICY_META: Record<
  PromptSyncPolicy,
  { label: string; short: string; desc: string }
> = {
  inherit: {
    label: 'Follow repository policy',
    short: 'Follow policy',
    desc: 'Participates when the repository has Agent Instructions sync enabled; falls back to local only when it is off.',
  },
  sync: {
    label: 'Participate in sync',
    short: 'Sync',
    desc: 'Writes the contract to the repository so other machines can pull it; global instruction sync must be enabled.',
  },
  local: {
    label: 'Local only',
    short: 'Local',
    desc: 'Never enters Git and produces no pending pushes; good for personal context or rules that are not final yet.',
  },
}

export function contractSlug(contract: Pick<AgentContract, 'id' | 'title'>): string {
  const slug = contract.title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || contract.id
}

/** The directory reuses the library folder directly: instructions/<folder>/<slug>.contract.md */
export function contractFilePath(
  contract: Pick<AgentContract, 'id' | 'title'> & { folder?: string | null },
  contractsDir = 'instructions',
): string {
  return repoFilePath(contractsDir, contract.folder, `${contractSlug(contract)}.contract.md`)
}

export function projectionPath(contract: Pick<AgentContract, 'id' | 'title'>, targetId: string): string {
  const target = TARGET_BY_ID[targetId]
  if (!target) return ''
  return target.pathTemplate.replace('{slug}', contractSlug(contract))
}

export function contractVersionLabel(contract: Pick<AgentContract, 'versions'>): string {
  return `v${contract.versions[0]?.version ?? 1}`
}

export function contractSyncEnabled(
  repo: Pick<RepoConfig, 'connected' | 'policies'>,
  contract: Pick<AgentContract, 'syncPolicy'>,
): boolean {
  return repo.connected && repo.policies.contracts && contract.syncPolicy !== 'local'
}

export function activationSummary(activation: ContractActivation): string {
  switch (activation.mode) {
    case 'glob':
      return activation.globs.length ? `By path: ${activation.globs.join(', ')}` : 'By path (no glob configured)'
    case 'model':
      return 'Model decides relevance'
    case 'manual':
      return 'Manual @ reference'
    default:
      return 'Always on'
  }
}

export function scopeSummary(contract: Pick<AgentContract, 'scope' | 'path'>): string {
  if (contract.scope === 'path') return `Path: ${contract.path || 'no directory specified'}`
  return CONTRACT_SCOPE_META[contract.scope].label
}

/* ---------------- File serialization ---------------- */

type ContractFileInput = Pick<
  AgentContract,
  | 'id'
  | 'title'
  | 'description'
  | 'body'
  | 'scope'
  | 'path'
  | 'activation'
  | 'priority'
  | 'imports'
  | 'targets'
  | 'tags'
> & { folder?: string | null }

export function serializeContractFile(contract: ContractFileInput): string {
  const lines = [
    '---',
    `id: ${JSON.stringify(contract.id)}`,
    `title: ${JSON.stringify(contract.title)}`,
    `description: ${JSON.stringify(contract.description ?? '')}`,
    `folder: ${JSON.stringify(normalizeFolder(contract.folder) ?? '')}`,
    `scope: ${JSON.stringify(contract.scope)}`,
    `path: ${JSON.stringify(contract.path ?? '')}`,
    `activation: ${JSON.stringify(contract.activation)}`,
    `priority: ${contract.priority}`,
    `imports: ${JSON.stringify(contract.imports)}`,
    `targets: ${JSON.stringify(contract.targets)}`,
    `tags: ${JSON.stringify(contract.tags)}`,
    '---',
    '',
    contract.body.trim(),
    '',
  ]
  return lines.join('\n')
}

export interface ParsedContractFile {
  id?: string
  title: string
  description: string
  folder: string | null
  body: string
  scope: ContractScope
  path?: string
  activation: ContractActivation
  priority: number
  imports: string[]
  targets: string[]
  tags: string[]
}

/** Turn the JSON in a version snapshot back into readable text for the generic version dialog */
export function formatContractSnapshot(raw?: string): string {
  if (!raw) return '(empty)'
  try {
    const parsed = JSON.parse(raw) as Partial<AgentContract>
    const meta = [
      parsed.folder ? `folder: ${parsed.folder}` : '',
      `scope: ${parsed.scope ?? 'project'}`,
      parsed.path ? `path: ${parsed.path}` : '',
      `priority: ${parsed.priority ?? 50}`,
      `activation: ${parsed.activation ? activationSummary(parsed.activation) : 'Always on'}`,
      `targets: ${(parsed.targets ?? []).join(', ') || '—'}`,
      parsed.imports?.length ? `imports: ${parsed.imports.join(', ')}` : '',
    ].filter(Boolean)
    return `${meta.join('\n')}\n\n${parsed.body ?? ''}`.trim()
  } catch {
    return raw
  }
}

function readString(fields: Map<string, string>, key: string): string {
  const raw = fields.get(key) ?? ''
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : raw
  } catch {
    return raw
  }
}

function readArray(fields: Map<string, string>, key: string): string[] {
  const raw = fields.get(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
  } catch {
    return raw
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return []
}

/** Parse .contract.md; returns null when the structure is incomplete, used to validate manual merges */
export function parseContractFile(text: string): ParsedContractFile | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!frontmatter) return null

  const fields = new Map<string, string>()
  for (const line of frontmatter[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }

  const title = readString(fields, 'title').trim()
  const body = normalized.slice(frontmatter[0].length).trim()
  if (!title || !body) return null

  let activation: ContractActivation = { mode: 'always', globs: [] }
  const rawActivation = fields.get('activation')
  if (rawActivation) {
    try {
      const parsed = JSON.parse(rawActivation) as Partial<ContractActivation>
      const mode = parsed.mode
      if (mode === 'always' || mode === 'glob' || mode === 'model' || mode === 'manual') {
        activation = {
          mode,
          globs: Array.isArray(parsed.globs) ? parsed.globs.map(String) : [],
          description: typeof parsed.description === 'string' ? parsed.description : undefined,
        }
      }
    } catch {
      activation = { mode: 'always', globs: [] }
    }
  }

  const rawScope = readString(fields, 'scope')
  const scope: ContractScope = rawScope === 'user' || rawScope === 'path' ? rawScope : 'project'
  const rawPriority = Number(fields.get('priority') ?? 50)

  return {
    id: readString(fields, 'id') || undefined,
    title,
    description: readString(fields, 'description'),
    folder: normalizeFolder(readString(fields, 'folder')),
    body,
    scope,
    path: readString(fields, 'path') || undefined,
    activation,
    priority: Number.isFinite(rawPriority) ? rawPriority : 50,
    imports: readArray(fields, 'imports'),
    targets: readArray(fields, 'targets'),
    tags: readArray(fields, 'tags'),
  }
}

/* ---------------- glob matching ---------------- */

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]*)\}/)
  if (!match || match.index === undefined) return [pattern]
  const before = pattern.slice(0, match.index)
  const after = pattern.slice(match.index + match[0].length)
  return match[1].split(',').flatMap((part) => expandBraces(`${before}${part}${after}`))
}

function globToRegExpSource(glob: string): string {
  const normalized = normalizePath(glob)
  let source = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (ch === '?') {
      source += '[^/]'
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return source
}

/** Simplified glob: supports ** / * / ? / {a,b}; does not emulate every edge case of each tool */
export function pathMatchesGlob(filePath: string, glob: string): boolean {
  const path = normalizePath(filePath)
  return expandBraces(glob).some((pattern) => {
    try {
      return new RegExp(`^${globToRegExpSource(pattern)}$`).test(path)
    } catch {
      return false
    }
  })
}

export function contractPathApplies(
  contract: Pick<AgentContract, 'scope' | 'path'>,
  filePath: string,
): { ok: boolean; reason: string } {
  if (contract.scope !== 'path') return { ok: true, reason: '' }
  const prefix = normalizePath(contract.path ?? '')
  if (!prefix) return { ok: true, reason: '' }
  const path = normalizePath(filePath)
  if (path === prefix || path.startsWith(`${prefix}/`)) return { ok: true, reason: '' }
  return { ok: false, reason: `Only applies to ${prefix}/; the current path does not match` }
}

function activationSupport(
  target: ContractTarget,
  mode: ContractActivation['mode'],
): { ok: boolean; reason: string } {
  if (mode === 'always') return { ok: true, reason: '' }
  if (mode === 'glob' && !target.supports.globs) {
    return { ok: false, reason: `${target.label} does not support path-based activation (glob)` }
  }
  if (mode === 'model' && !target.supports.modelDecision) {
    return { ok: false, reason: `${target.label} does not support model-decision activation` }
  }
  if (mode === 'manual' && !target.supports.manual) {
    return { ok: false, reason: `${target.label} does not support manual activation` }
  }
  return { ok: true, reason: '' }
}

export function contractTargetSupports(
  contract: Pick<AgentContract, 'activation'>,
  target: ContractTarget,
): boolean {
  return activationSupport(target, contract.activation.mode).ok
}

function specificity(contract: Pick<AgentContract, 'scope' | 'path'>): number {
  if (contract.scope === 'user') return 0
  if (contract.scope === 'project') return 1
  return 2 + normalizePath(contract.path ?? '').split('/').filter(Boolean).length
}

/* ---------------- Resolution preview ---------------- */

export function resolveContracts(
  contracts: AgentContract[],
  targetId: string,
  filePath: string,
): ResolvedPreview {
  const target = TARGET_BY_ID[targetId]
  const skipped: SkippedContractEntry[] = []
  if (!target) {
    return { targetId, filePath, included: [], skipped, totalBytes: 0, warnings: ['Unknown target'] }
  }

  const targeting = contracts.filter((c) => c.targets.includes(targetId))
  const candidates: { contract: AgentContract; reason: string }[] = []

  for (const contract of targeting) {
    const pathScope = contractPathApplies(contract, filePath)
    if (!pathScope.ok) {
      skipped.push({ contractId: contract.id, title: contract.title, reason: pathScope.reason })
      continue
    }
    const support = activationSupport(target, contract.activation.mode)
    if (!support.ok) {
      skipped.push({ contractId: contract.id, title: contract.title, reason: support.reason })
      continue
    }

    const scopeLabel = CONTRACT_SCOPE_META[contract.scope].label
    if (contract.activation.mode === 'glob') {
      if (contract.activation.globs.length === 0) {
        skipped.push({ contractId: contract.id, title: contract.title, reason: 'No glob configured; cannot determine the applicable path' })
        continue
      }
      const matched = contract.activation.globs.find((g) => pathMatchesGlob(filePath, g))
      if (!matched) {
        skipped.push({
          contractId: contract.id,
          title: contract.title,
          reason: `No glob match: ${contract.activation.globs.join(', ')}`,
        })
        continue
      }
      candidates.push({ contract, reason: `${scopeLabel} · matched ${matched}` })
      continue
    }
    if (contract.activation.mode === 'model') {
      skipped.push({
        contractId: contract.id,
        title: contract.title,
        reason:
          'Conditional activation: the model decides relevance, so it does not enter the always-on context (it is still deployed as a standalone file)',
      })
      continue
    }
    if (contract.activation.mode === 'manual') {
      skipped.push({
        contractId: contract.id,
        title: contract.title,
        reason:
          'Conditional activation: requires a manual @ reference, so it does not enter the always-on context (it is still deployed as a standalone file)',
      })
      continue
    }
    candidates.push({ contract, reason: `${scopeLabel} · Always on` })
  }

  candidates.sort((a, b) => {
    const sa = specificity(a.contract)
    const sb = specificity(b.contract)
    if (target.precedence === 'concat') {
      if (sa !== sb) return sa - sb
    } else if (sa !== sb) {
      return sb - sa
    }
    if (a.contract.priority !== b.contract.priority) return b.contract.priority - a.contract.priority
    return a.contract.title.localeCompare(b.contract.title, 'en')
  })

  const included = candidates.map(({ contract, reason }) => ({
    contractId: contract.id,
    title: contract.title,
    sourcePath: contractFilePath(contract),
    reason,
    bytes: byteLength(contract.body),
  }))

  const totalBytes = included.reduce((sum, c) => sum + c.bytes, 0)
  const warnings: string[] = []

  if (target.maxBytes && totalBytes > target.maxBytes) {
    warnings.push(
      `Total content is ${totalBytes} bytes, exceeding the recommended limit of ${target.maxBytes} bytes; content over the limit may be truncated by the tool.`,
    )
  }
  if (included.length > 5) {
    warnings.push(
      `${included.length} always-on contracts are active; consider merging duplicate content. Always-on instructions consume context budget in every session.`,
    )
  }

  const duplicateLines = countDuplicateLines(candidates.map((c) => c.contract.body))
  if (duplicateLines > 0) {
    warnings.push(`Detected ${duplicateLines} lines of duplicated content, possibly from copy-paste; merging does not deduplicate automatically.`)
  }

  const unsupportedImports = candidates.filter(
    (c) => c.contract.imports.length > 0 && !target.supports.imports,
  )
  if (unsupportedImports.length > 0) {
    warnings.push(
      `${unsupportedImports.map((c) => c.contract.title).join(', ')} configure @import, but ${target.label} does not support imports; the import lines will be ignored.`,
    )
  }

  return { targetId, filePath, included, skipped, totalBytes, maxBytes: target.maxBytes, warnings }
}

function countDuplicateLines(bodies: string[]): number {
  const counts = new Map<string, number>()
  for (const body of bodies) {
    const seen = new Set<string>()
    for (const line of body.split('\n')) {
      const normalized = line.trim()
      if (normalized.length < 16 || normalized.startsWith('#') || seen.has(normalized)) continue
      seen.add(normalized)
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }
  return [...counts.values()].filter((n) => n > 1).length
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/* ---------------- Target file compilation (emulates each tool's dialect) ---------------- */

const GENERATED_HEADER =
  '<!-- Generated by Prompt Keeper. Source of truth: instructions/**/*.contract.md. Manual edits will be reported as drift. -->'

export function compileContractFile(target: ContractTarget, contract: AgentContract): string {
  const body = contract.body.trim()
  const globs = contract.activation.globs.join(', ')

  if (target.format === 'copilot-path') {
    return [
      '---',
      `applyTo: "${globs || '**'}"`,
      '---',
      '',
      GENERATED_HEADER,
      '',
      body,
      '',
    ].join('\n')
  }

  if (target.format === 'cursor-mdc') {
    const alwaysApply = contract.activation.mode === 'always'
    const lines = ['---']
    if (contract.description || contract.activation.mode === 'model') {
      lines.push(`description: ${JSON.stringify(contract.activation.description || contract.description)}`)
    }
    if (globs) lines.push(`globs: ${JSON.stringify(globs)}`)
    lines.push(`alwaysApply: ${alwaysApply}`)
    lines.push('---', '', GENERATED_HEADER, '', body, '')
    return lines.join('\n')
  }

  if (target.format === 'windsurf-rule') {
    const trigger =
      contract.activation.mode === 'always'
        ? 'always_on'
        : contract.activation.mode === 'glob'
          ? 'glob'
          : contract.activation.mode === 'model'
            ? 'model_decision'
            : 'manual'
    const lines = ['---', `trigger: ${trigger}`]
    if (globs) lines.push(`globs: ${JSON.stringify(globs)}`)
    if (contract.activation.description || contract.description) {
      lines.push(`description: ${JSON.stringify(contract.activation.description || contract.description)}`)
    }
    lines.push('---', '', GENERATED_HEADER, '', body, '')
    return lines.join('\n')
  }

  return body
}

/** Single-file targets: merge contracts matching the current path into one file; per-contract targets return a per-file preview */
export function compileTargetFile(
  contracts: AgentContract[],
  targetId: string,
  filePath: string,
): { path: string; content: string }[] {
  const target = TARGET_BY_ID[targetId]
  if (!target) return []
  const preview = resolveContracts(contracts, targetId, filePath)
  const included = preview.included
    .map((entry) => contracts.find((c) => c.id === entry.contractId))
    .filter((c): c is AgentContract => !!c)

  if (target.merge === 'per-contract') {
    return included.map((contract) => ({
      path: projectionPath(contract, targetId),
      content: compileContractFile(target, contract),
    }))
  }

  const blocks = included.map((contract) => {
    const imports =
      target.supports.imports && contract.imports.length
        ? `${contract.imports.map((p) => `@${p}`).join('\n')}\n\n`
        : ''
    return [
      `<!-- pk:begin ${contract.id} -->`,
      `## ${contract.title}`,
      '',
      `${imports}${contract.body.trim()}`,
      `<!-- pk:end ${contract.id} -->`,
    ].join('\n')
  })

  const header = `${GENERATED_HEADER}\n\n<!-- Current path: ${filePath} -->\n\n`
  return [
    {
      path: target.pathTemplate,
      content: blocks.length
        ? `${header}${blocks.join('\n\n')}\n`
        : `${header}<!-- No contracts match the current path. -->\n`,
    },
  ]
}

export function targetSummary(targetId: string): string {
  const target = TARGET_BY_ID[targetId]
  if (!target) return targetId
  const parts = [target.agentName, target.merge === 'single-file' ? 'single-file merge' : 'one file per contract']
  if (target.precedence === 'concat') parts.push('concatenated in order')
  if (target.precedence === 'nearest') parts.push('nearest first')
  if (target.precedence === 'override') parts.push('nearest overrides')
  return parts.join(' · ')
}

export const CONTRACT_TARGET_OPTIONS = CONTRACT_TARGETS.map((t) => ({
  id: t.id,
  label: t.label,
  agentName: t.agentName,
  target: t,
}))
