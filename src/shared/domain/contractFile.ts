import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  ContractActivation,
  ContractActivationMode,
  ContractFileModel,
  ContractScope,
  SyncPolicy,
} from '../contracts'
import { normalizeFolder, repoFilePath, slugify } from './folders'

export function contractSlug(model: Pick<ContractFileModel, 'id' | 'title'>): string {
  return slugify(model.title, model.id)
}

export function contractRepoPath(
  model: Pick<ContractFileModel, 'id' | 'title' | 'folder'>,
  contractsDir = 'instructions',
): string {
  return repoFilePath(contractsDir, model.folder, `${contractSlug(model)}.contract.md`)
}

const ACTIVATION_MODES: ContractActivationMode[] = ['always', 'glob', 'model', 'manual']
const SCOPES: ContractScope[] = ['user', 'project', 'path']

export function normalizeActivation(value: unknown): ContractActivation {
  if (!value || typeof value !== 'object') return { mode: 'always', globs: [] }
  const raw = value as Partial<ContractActivation>
  const mode = ACTIVATION_MODES.includes(raw.mode as ContractActivationMode)
    ? (raw.mode as ContractActivationMode)
    : 'always'
  const globs = Array.isArray(raw.globs)
    ? raw.globs.filter((item): item is string => typeof item === 'string')
    : []
  const description = typeof raw.description === 'string' ? raw.description : undefined
  return { mode, globs, ...(description ? { description } : {}) }
}

export function serializeContractFile(model: ContractFileModel): string {
  const frontmatter = {
    id: model.id,
    title: model.title,
    description: model.description,
    folder: normalizeFolder(model.folder),
    scope: model.scope,
    pathPrefix: model.pathPrefix ?? '',
    activation: model.activation,
    priority: model.priority,
    imports: model.imports,
    targetIds: model.targetIds,
    tags: model.tags,
    syncPolicy: model.syncPolicy,
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return ['---', yaml, '---', '', model.body.trim(), ''].join('\n')
}

export interface ParsedContractFile {
  model: ContractFileModel | null
  error?: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function parseContractFile(text: string, sourcePath?: string): ParsedContractFile {
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

  const scopeRaw = asString(frontmatter.scope)
  const scope: ContractScope = SCOPES.includes(scopeRaw as ContractScope)
    ? (scopeRaw as ContractScope)
    : 'project'
  if (scope === 'path' && !asString(frontmatter.pathPrefix)) {
    return { model: null, error: 'Scope "path" requires a non-empty pathPrefix.' }
  }

  const syncPolicyRaw = asString(frontmatter.syncPolicy)
  const syncPolicy: SyncPolicy =
    syncPolicyRaw === 'sync' || syncPolicyRaw === 'local' ? syncPolicyRaw : 'inherit'

  const pathPrefix = asString(frontmatter.pathPrefix)
  const body = normalized.slice(match[0].length).trim()
  if (!body) return { model: null, error: 'Contract body is empty.' }

  return {
    model: {
      id: asString(frontmatter.id).trim(),
      title,
      description: asString(frontmatter.description),
      folder: normalizeFolder(asString(frontmatter.folder) || folderFromContractPath(sourcePath)),
      scope,
      pathPrefix: pathPrefix || null,
      activation: normalizeActivation(frontmatter.activation),
      priority: typeof frontmatter.priority === 'number' ? frontmatter.priority : 50,
      imports: asStringArray(frontmatter.imports),
      targetIds: asStringArray(frontmatter.targetIds ?? frontmatter.targets),
      tags: asStringArray(frontmatter.tags),
      syncPolicy,
      body,
    },
  }
}

export function folderFromContractPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length >= 3) return normalizeFolder(parts.slice(1, -1).join('/'))
  return ''
}
