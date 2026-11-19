import type {
  DispatchStatus,
  SkillFileEntry,
  SkillSource,
  SyncRisk,
} from '../../../shared/contracts'
import { repoFilePath, safePathSegment, slugify } from '../../../shared/domain/folders'
import type { BadgeTone } from './assetStatus'

export type ViewBadgeVariant = BadgeTone

export const SKILL_ENTRY_FILE = 'SKILL.md'

export const SCRIPT_ACK_NOTICE =
  'Skill scripts are stored and listed but are never executed by Prompt Keeper.'

const SCRIPT_EXTENSIONS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'cmd',
  'bat',
  'py',
  'rb',
  'pl',
  'js',
  'mjs',
  'cjs',
  'ts',
  'exe',
  'bin',
])


export function skillDirectoryPath(
  input: { title: string; slug?: string; folder?: string },
  skillsDir = 'skills',
): string {
  const slug = input.slug?.trim() || slugify(input.title, 'untitled')
  return repoFilePath(skillsDir, input.folder ?? '', safePathSegment(slug, 'untitled'))
}

/** Canonical repository entry file: skills/<folder>/<slug>/SKILL.md */
export function skillRepoPath(
  input: { title: string; slug?: string; folder?: string },
  skillsDir = 'skills',
): string {
  return `${skillDirectoryPath(input, skillsDir)}/${SKILL_ENTRY_FILE}`
}

export function skillSourceMeta(source: SkillSource): {
  label: string
  variant: ViewBadgeVariant
} {
  switch (source) {
    case 'official':
      return { label: 'Official', variant: 'primary' }
    case 'community':
      return { label: 'Community', variant: 'info' }
    case 'import':
      return { label: 'Imported', variant: 'warning' }
    case 'scan':
      return { label: 'Scanned', variant: 'secondary' }
    default:
      return { label: 'Local', variant: 'outline' }
  }
}


export function dispatchStatusMeta(status: DispatchStatus): {
  label: string
  variant: ViewBadgeVariant
} {
  switch (status) {
    case 'synced':
      return { label: 'Synced', variant: 'success' }
    case 'stale':
      return { label: 'Stale', variant: 'warning' }
    case 'drifted':
      return { label: 'Drifted', variant: 'danger' }
    case 'missing':
      return { label: 'Not installed', variant: 'outline' }
    case 'unsupported':
      return { label: 'Unsupported', variant: 'secondary' }
    default:
      return { label: status, variant: 'outline' }
  }
}

export function installSummaryTotal(summary: {
  synced: number
  stale: number
  drifted: number
  missing: number
  unsupported: number
}): number {
  return summary.synced + summary.stale + summary.drifted + summary.missing + summary.unsupported
}

export function installSummaryParts(summary: {
  synced: number
  stale: number
  drifted: number
  missing: number
  unsupported: number
}): string[] {
  const parts: string[] = []
  if (summary.synced) parts.push(`${summary.synced} synced`)
  if (summary.stale) parts.push(`${summary.stale} stale`)
  if (summary.drifted) parts.push(`${summary.drifted} drifted`)
  if (summary.missing) parts.push(`${summary.missing} not installed`)
  if (summary.unsupported) parts.push(`${summary.unsupported} unsupported`)
  return parts
}

export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function isScriptFile(file: SkillFileEntry): boolean {
  if (file.isExecutable) return true
  if (file.path.split('/').some((segment) => segment.toLowerCase() === 'scripts')) return true
  return SCRIPT_EXTENSIONS.has(fileExtension(file.path))
}

export function skillHasScripts(files: SkillFileEntry[]): boolean {
  return files.some(isScriptFile)
}

export function riskMeta(risk: SyncRisk): { label: string; variant: ViewBadgeVariant } {
  switch (risk) {
    case 'scripts':
      return { label: 'Contains scripts', variant: 'warning' }
    case 'secrets':
      return { label: 'Possible credentials', variant: 'danger' }
    case 'network':
      return { label: 'Network access', variant: 'info' }
    default:
      return { label: risk, variant: 'outline' }
  }
}

export function sortSkillFiles(files: SkillFileEntry[]): SkillFileEntry[] {
  return [...files].sort((a, b) => {
    if (a.path === SKILL_ENTRY_FILE) return -1
    if (b.path === SKILL_ENTRY_FILE) return 1
    return a.path.localeCompare(b.path, 'en')
  })
}

export function categoryOptions(items: Array<{ category: string }>): string[] {
  const set = new Set<string>()
  for (const item of items) {
    const value = item.category.trim()
    if (value) set.add(value)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en'))
}
