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
  user: { label: '用户级', short: '用户', desc: '对本机所有项目生效，只写入用户目录。' },
  project: { label: '项目级', short: '项目', desc: '写入当前仓库根目录，跟随仓库共享。' },
  path: { label: '路径级', short: '路径', desc: '只在指定目录及其子目录内生效，适合模块级规范。' },
}

export const ACTIVATION_META: Record<
  ContractActivation['mode'],
  { label: string; short: string; desc: string }
> = {
  always: { label: '始终生效', short: '常驻', desc: '每次会话都进入上下文，适合构建、测试、安全等硬约束。' },
  glob: { label: '按路径生效', short: 'glob', desc: '当处理匹配 glob 的文件时激活；不支持 glob 的目标会跳过。' },
  model: { label: '模型判断', short: '模型判断', desc: '提供描述，由 Agent 判断相关性后决定是否引用。' },
  manual: { label: '手动引用', short: '手动', desc: '不自动进入上下文，只在用户显式 @ 引用时生效。' },
}

export const PROJECTION_META: Record<ProjectionStatus, { label: string; variant: BadgeVariant; icon: IconName }> = {
  synced: { label: '已投影', variant: 'success', icon: 'check' },
  stale: { label: '待更新', variant: 'warning', icon: 'refresh' },
  drifted: { label: '漂移', variant: 'danger', icon: 'alert' },
  missing: { label: '未投影', variant: 'outline', icon: 'plus' },
}

export const CONTRACT_SYNC_POLICY_META: Record<
  PromptSyncPolicy,
  { label: string; short: string; desc: string }
> = {
  inherit: {
    label: '跟随仓库策略',
    short: '跟随策略',
    desc: '仓库启用 Agent 指令同步时参与；关闭时自动退回仅本机。',
  },
  sync: {
    label: '参与同步',
    short: '参与同步',
    desc: '把契约写入仓库并允许其他机器拉取；需要全局指令同步已开启。',
  },
  local: {
    label: '仅本机',
    short: '仅本机',
    desc: '不进入 Git，也不产生待推送；适合个人上下文或未定稿规则。',
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

/** 目录直接复用库内文件夹：instructions/<folder>/<slug>.contract.md */
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
      return activation.globs.length ? `按路径：${activation.globs.join('，')}` : '按路径（未配置 glob）'
    case 'model':
      return '由模型判断相关性'
    case 'manual':
      return '手动 @ 引用'
    default:
      return '始终生效'
  }
}

export function scopeSummary(contract: Pick<AgentContract, 'scope' | 'path'>): string {
  if (contract.scope === 'path') return `路径级：${contract.path || '未指定目录'}`
  return CONTRACT_SCOPE_META[contract.scope].label
}

/* ---------------- 文件序列化 ---------------- */

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

/** 把版本快照里的 JSON 还原为可读文本，供通用版本弹窗展示 */
export function formatContractSnapshot(raw?: string): string {
  if (!raw) return '（空）'
  try {
    const parsed = JSON.parse(raw) as Partial<AgentContract>
    const meta = [
      parsed.folder ? `folder: ${parsed.folder}` : '',
      `scope: ${parsed.scope ?? 'project'}`,
      parsed.path ? `path: ${parsed.path}` : '',
      `priority: ${parsed.priority ?? 50}`,
      `activation: ${parsed.activation ? activationSummary(parsed.activation) : '始终生效'}`,
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

/** 解析 .contract.md；结构不完整时返回 null，用于手动合并校验 */
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

/* ---------------- glob 匹配 ---------------- */

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

/** 简化 glob：支持 ** / * / ? / {a,b}；不模拟各工具的全部边界行为 */
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
  return { ok: false, reason: `仅对 ${prefix}/ 生效，当前路径不匹配` }
}

function activationSupport(
  target: ContractTarget,
  mode: ContractActivation['mode'],
): { ok: boolean; reason: string } {
  if (mode === 'always') return { ok: true, reason: '' }
  if (mode === 'glob' && !target.supports.globs) {
    return { ok: false, reason: `${target.label} 不支持按路径激活（glob）` }
  }
  if (mode === 'model' && !target.supports.modelDecision) {
    return { ok: false, reason: `${target.label} 不支持模型判断激活` }
  }
  if (mode === 'manual' && !target.supports.manual) {
    return { ok: false, reason: `${target.label} 不支持手动引用激活` }
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

/* ---------------- 生效预览 ---------------- */

export function resolveContracts(
  contracts: AgentContract[],
  targetId: string,
  filePath: string,
): ResolvedPreview {
  const target = TARGET_BY_ID[targetId]
  const skipped: SkippedContractEntry[] = []
  if (!target) {
    return { targetId, filePath, included: [], skipped, totalBytes: 0, warnings: ['未知目标'] }
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
        skipped.push({ contractId: contract.id, title: contract.title, reason: '未配置 glob，无法判断生效路径' })
        continue
      }
      const matched = contract.activation.globs.find((g) => pathMatchesGlob(filePath, g))
      if (!matched) {
        skipped.push({
          contractId: contract.id,
          title: contract.title,
          reason: `未命中 glob：${contract.activation.globs.join('，')}`,
        })
        continue
      }
      candidates.push({ contract, reason: `${scopeLabel} · 命中 ${matched}` })
      continue
    }
    if (contract.activation.mode === 'model') {
      skipped.push({
        contractId: contract.id,
        title: contract.title,
        reason: '条件激活：由模型判断相关性，不进入常驻上下文（仍会部署为独立文件）',
      })
      continue
    }
    if (contract.activation.mode === 'manual') {
      skipped.push({
        contractId: contract.id,
        title: contract.title,
        reason: '条件激活：需手动 @ 引用，不进入常驻上下文（仍会部署为独立文件）',
      })
      continue
    }
    candidates.push({ contract, reason: `${scopeLabel} · 始终生效` })
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
    return a.contract.title.localeCompare(b.contract.title, 'zh')
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
      `正文合计 ${totalBytes} 字节，超过 ${target.maxBytes} 字节建议上限；超限内容可能被工具截断。`,
    )
  }
  if (included.length > 5) {
    warnings.push(`当前有 ${included.length} 条常驻契约，建议合并重复内容；常驻指令会占用每次会话的上下文预算。`)
  }

  const duplicateLines = countDuplicateLines(candidates.map((c) => c.contract.body))
  if (duplicateLines > 0) {
    warnings.push(`检测到 ${duplicateLines} 行重复内容，可能来自复制粘贴；合并时不会自动去重。`)
  }

  const unsupportedImports = candidates.filter(
    (c) => c.contract.imports.length > 0 && !target.supports.imports,
  )
  if (unsupportedImports.length > 0) {
    warnings.push(
      `${unsupportedImports.map((c) => c.contract.title).join('、')} 配置了 @import，但 ${target.label} 不支持 import；导入行会被忽略。`,
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

/* ---------------- 目标文件编译（模拟各工具方言） ---------------- */

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

/** 单文件目标：把当前路径命中的契约合并为一个文件；per-contract 目标返回逐文件预览 */
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

  const header = `${GENERATED_HEADER}\n\n<!-- 当前路径：${filePath} -->\n\n`
  return [
    {
      path: target.pathTemplate,
      content: blocks.length
        ? `${header}${blocks.join('\n\n')}\n`
        : `${header}<!-- 当前路径没有命中的契约。 -->\n`,
    },
  ]
}

export function targetSummary(targetId: string): string {
  const target = TARGET_BY_ID[targetId]
  if (!target) return targetId
  const parts = [target.agentName, target.merge === 'single-file' ? '单文件合并' : '一契约一文件']
  if (target.precedence === 'concat') parts.push('顺序拼接')
  if (target.precedence === 'nearest') parts.push('就近优先')
  if (target.precedence === 'override') parts.push('就近覆盖')
  return parts.join(' · ')
}

export const CONTRACT_TARGET_OPTIONS = CONTRACT_TARGETS.map((t) => ({
  id: t.id,
  label: t.label,
  agentName: t.agentName,
  target: t,
}))
