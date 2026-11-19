import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { PromptFileModel, PromptVariable, SyncPolicy } from '../contracts'
import { normalizeFolder, repoFilePath, slugify } from './folders'
import { mergeVariableDefs } from './variables'

export const SYSTEM_HEADING = '## System Prompt'
export const USER_HEADING = '## User Prompt'

export function promptSlug(model: Pick<PromptFileModel, 'id' | 'title'>): string {
  return slugify(model.title, model.id)
}

export function promptRepoPath(
  model: Pick<PromptFileModel, 'id' | 'title' | 'folder'>,
  promptsDir = 'prompts',
): string {
  return repoFilePath(promptsDir, model.folder, `${promptSlug(model)}.prompt.md`)
}

export function serializePromptFile(model: PromptFileModel): string {
  const frontmatter = {
    id: model.id,
    title: model.title,
    description: model.description,
    folder: normalizeFolder(model.folder),
    tags: model.tags,
    syncPolicy: model.syncPolicy,
    variables: model.variables,
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return [
    '---',
    yaml,
    '---',
    '',
    SYSTEM_HEADING,
    '',
    model.systemPrompt.trim(),
    '',
    USER_HEADING,
    '',
    model.userPrompt.trim(),
    '',
  ].join('\n')
}

export interface ParsedPromptFile {
  model: PromptFileModel | null
  error?: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asVariables(value: unknown): PromptVariable[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is PromptVariable =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as PromptVariable).name === 'string' &&
      typeof (item as PromptVariable).type === 'string',
  )
}

export function parsePromptFile(text: string, sourcePath?: string): ParsedPromptFile {
  const normalized = text.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { model: null, error: 'Missing YAML frontmatter.' }

  let frontmatter: Record<string, unknown>
  try {
    const parsed = parseYaml(match[1])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { model: null, error: 'Frontmatter must be a YAML mapping.' }
    }
    frontmatter = parsed as Record<string, unknown>
  } catch (error) {
    return { model: null, error: `Invalid YAML frontmatter: ${(error as Error).message}` }
  }

  const title = asString(frontmatter.title).trim()
  if (!title) return { model: null, error: 'Frontmatter is missing a title.' }

  const body = normalized.slice(match[0].length)
  const systemIndex = body.indexOf(SYSTEM_HEADING)
  const userIndex = body.indexOf(USER_HEADING)
  if (systemIndex === -1 && userIndex === -1) {
    return { model: null, error: `Body must contain "${SYSTEM_HEADING}" or "${USER_HEADING}".` }
  }

  let systemPrompt = ''
  let userPrompt = ''
  if (systemIndex !== -1) {
    const start = systemIndex + SYSTEM_HEADING.length
    const end = userIndex !== -1 && userIndex > systemIndex ? userIndex : body.length
    systemPrompt = body.slice(start, end).trim()
  }
  if (userIndex !== -1) {
    userPrompt = body.slice(userIndex + USER_HEADING.length).trim()
  }

  const folderSource = asString(frontmatter.folder) || folderFromPath(sourcePath)
  const variables = asVariables(frontmatter.variables)
  const syncPolicyRaw = asString(frontmatter.syncPolicy)
  const syncPolicy: SyncPolicy =
    syncPolicyRaw === 'sync' || syncPolicyRaw === 'local' ? syncPolicyRaw : 'inherit'

  return {
    model: {
      id: asString(frontmatter.id).trim(),
      title,
      description: asString(frontmatter.description),
      folder: normalizeFolder(folderSource),
      tags: asStringArray(frontmatter.tags),
      variables: mergeVariableDefs([systemPrompt, userPrompt], variables),
      syncPolicy,
      systemPrompt,
      userPrompt,
    },
  }
}

/** Infer the folder from `prompts/<folder>/<slug>.prompt.md` when frontmatter omits it. */
export function folderFromPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length >= 3) return normalizeFolder(parts.slice(1, -1).join('/'))
  return ''
}
