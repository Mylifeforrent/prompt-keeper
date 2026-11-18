import type { Prompt, PromptSyncPolicy, PromptVariable, RepoConfig } from '../types'
import { mergeVariableDefs } from './variables'
import { normalizeFolder, repoFilePath } from './folders'

export const SYSTEM_HEADING = '## System Prompt'
export const USER_HEADING = '## User Prompt'

export const PROMPT_SYNC_POLICY_META: Record<
  PromptSyncPolicy,
  { label: string; short: string; desc: string }
> = {
  inherit: {
    label: '跟随仓库策略',
    short: '跟随策略',
    desc: '仓库启用 Prompt 同步时参与；仓库关闭时自动退回仅本机。',
  },
  sync: {
    label: '参与同步',
    short: '参与同步',
    desc: '把这一条推送到 Git 仓库，并在其他机器上可拉取；需要全局 Prompt 同步已开启。',
  },
  local: {
    label: '仅本机',
    short: '仅本机',
    desc: '不进入 Git，也不出现在待推送中；适合个人速记、含私密上下文的 Prompt。',
  },
}

/** Prompt 是否实际参与仓库同步；全局开关拥有最高优先级 */
export function promptEffectiveSync(
  repo: Pick<RepoConfig, 'connected' | 'policies'>,
  prompt: Pick<Prompt, 'syncPolicy'>,
): boolean {
  return repo.connected && repo.policies.prompts && prompt.syncPolicy !== 'local'
}

export function promptSlug(prompt: Pick<Prompt, 'id' | 'title'>): string {
  const slug = prompt.title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || prompt.id
}

/**
 * 每个 Prompt 一个 Markdown 文件，目录直接复用库内文件夹：
 * prompts/<folder>/<slug>.prompt.md
 * Git diff 可读，也能在不打开平台时按目录浏览。
 */
export function promptFilePath(
  prompt: Pick<Prompt, 'id' | 'title'> & { folder?: string | null },
  promptsDir = 'prompts',
): string {
  return repoFilePath(promptsDir, prompt.folder, `${promptSlug(prompt)}.prompt.md`)
}

type PromptFileInput = Pick<
  Prompt,
  'id' | 'title' | 'description' | 'folder' | 'tags' | 'variables' | 'systemPrompt' | 'userPrompt'
>

export function serializePromptFile(prompt: PromptFileInput): string {
  const lines = [
    '---',
    `id: ${JSON.stringify(prompt.id)}`,
    `title: ${JSON.stringify(prompt.title)}`,
    `description: ${JSON.stringify(prompt.description ?? '')}`,
    `folder: ${JSON.stringify(normalizeFolder(prompt.folder) ?? '')}`,
    `tags: ${JSON.stringify(prompt.tags)}`,
    `variables: ${JSON.stringify(prompt.variables)}`,
    '---',
    '',
    SYSTEM_HEADING,
    '',
    prompt.systemPrompt.trim(),
    '',
    USER_HEADING,
    '',
    prompt.userPrompt.trim(),
    '',
  ]
  return lines.join('\n')
}

export interface ParsedPromptFile {
  id?: string
  title: string
  description: string
  folder: string | null
  tags: string[]
  variables: PromptVariable[]
  systemPrompt: string
  userPrompt: string
}

/** 解析 .prompt.md；结构不完整时返回 null，用于手动合并校验 */
export function parsePromptFile(text: string): ParsedPromptFile | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!frontmatter) return null

  const fields = new Map<string, string>()
  for (const line of frontmatter[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }

  const readString = (key: string): string => {
    const raw = fields.get(key) ?? ''
    if (!raw) return ''
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : raw
    } catch {
      return raw
    }
  }

  const title = readString('title').trim()
  if (!title) return null

  let tags: string[] = []
  const rawTags = fields.get('tags')
  if (rawTags) {
    try {
      const parsed = JSON.parse(rawTags)
      if (Array.isArray(parsed)) tags = parsed.map(String)
    } catch {
      tags = rawTags
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
  }

  let variables: PromptVariable[] = []
  const rawVariables = fields.get('variables')
  if (rawVariables) {
    try {
      const parsed = JSON.parse(rawVariables)
      if (Array.isArray(parsed)) {
        variables = parsed.filter(
          (v): v is PromptVariable =>
            !!v && typeof v === 'object' && typeof (v as PromptVariable).name === 'string',
        )
      }
    } catch {
      variables = []
    }
  }

  const body = normalized.slice(frontmatter[0].length)
  const systemMatch = body.match(/##\s+System Prompt\s*\n([\s\S]*?)(?=\n##\s+User Prompt|$)/)
  const userMatch = body.match(/##\s+User Prompt\s*\n([\s\S]*)$/)
  if (!systemMatch && !userMatch) return null

  const systemPrompt = systemMatch ? systemMatch[1].trim() : ''
  const userPrompt = userMatch ? userMatch[1].trim() : ''

  return {
    id: readString('id') || undefined,
    title,
    description: readString('description'),
    folder: normalizeFolder(readString('folder')),
    tags,
    variables: mergeVariableDefs([systemPrompt, userPrompt], variables),
    systemPrompt,
    userPrompt,
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
]

/** 高置信度凭据模式；只用于推送前阻断，不做泛化内容审查 */
export function containsLikelySecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

/** 把 Prompt 中的疑似凭据替换为模板变量，真实值不落盘 */
export function maskSecretsInPrompt(text: string): string {
  let next = text
  for (const re of SECRET_PATTERNS) {
    next = next.replace(re, '{{api_key}}')
  }
  return next
}
