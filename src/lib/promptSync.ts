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
    label: 'Follow repository policy',
    short: 'Follow policy',
    desc: 'Participates when the repository has Prompt sync enabled; falls back to local only when it is off.',
  },
  sync: {
    label: 'Participate in sync',
    short: 'Sync',
    desc: 'Pushes this Prompt to the Git repository so other machines can pull it; requires global Prompt sync to be enabled.',
  },
  local: {
    label: 'Local only',
    short: 'Local',
    desc: 'Never enters Git and never appears in pending pushes; good for personal notes or Prompts with private context.',
  },
}

/** Whether the Prompt actually participates in repository sync; the global switch takes highest priority */
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
 * One Markdown file per Prompt; the directory reuses the library folder directly:
 * prompts/<folder>/<slug>.prompt.md
 * Reads well in Git diffs and can be browsed by directory without opening the app.
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

/** Parse .prompt.md; returns null when the structure is incomplete, used to validate manual merges */
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

/** High-confidence credential patterns; used only to block before pushing, not for general content review */
export function containsLikelySecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => {
    re.lastIndex = 0
    return re.test(text)
  })
}

/** Replace suspected credentials in Prompts with template variables; real values are never persisted */
export function maskSecretsInPrompt(text: string): string {
  let next = text
  for (const re of SECRET_PATTERNS) {
    next = next.replace(re, '{{api_key}}')
  }
  return next
}
