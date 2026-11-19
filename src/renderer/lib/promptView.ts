import type {
  AssetSyncState,
  FolderNode,
  PromptDetail,
  PromptListItem,
  PromptQuery,
  PromptVariable,
} from '../../shared/contracts'
import { flattenFolderTree, normalizeFolder } from '../../shared/domain/folders'
import { promptRepoPath } from '../../shared/domain/promptFile'

export type PromptSort = NonNullable<PromptQuery['sort']>
export type PromptViewMode = 'cards' | 'table'

export type SyncBadgeVariant = 'outline' | 'secondary' | 'success' | 'warning' | 'danger' | 'info'

export interface SyncStateMeta {
  label: string
  shortLabel: string
  variant: SyncBadgeVariant
  dot: string
  description: string
}

/** Status dictionary shared by the list, detail header, and sync policy dialog. */
export const SYNC_STATE_META: Record<AssetSyncState, SyncStateMeta> = {
  'not-connected': {
    label: 'Not connected',
    shortLabel: 'Local',
    variant: 'outline',
    dot: 'bg-muted-foreground/50',
    description:
      'No repository is connected. This Prompt stays in the local library and no file is written anywhere else.',
  },
  'local-only': {
    label: 'Local only',
    shortLabel: 'Local',
    variant: 'secondary',
    dot: 'bg-muted-foreground/50',
    description:
      'Excluded from Git sync. Edits never create pending pushes, and repository updates never touch this Prompt.',
  },
  'in-sync': {
    label: 'Synced',
    shortLabel: 'Synced',
    variant: 'success',
    dot: 'bg-success',
    description: 'Local content matches the latest repository file. Nothing needs to be pushed.',
  },
  outgoing: {
    label: 'Local unpushed',
    shortLabel: 'Unpushed',
    variant: 'warning',
    dot: 'bg-warning',
    description:
      'Local edits are waiting in the Sync Center. Nothing is committed or pushed automatically.',
  },
  incoming: {
    label: 'Repository updated',
    shortLabel: 'Incoming',
    variant: 'info',
    dot: 'bg-info',
    description:
      'The repository has a newer version. Review it and pull from the Sync Center; local content is not overwritten automatically.',
  },
  conflict: {
    label: 'Conflict',
    shortLabel: 'Conflict',
    variant: 'danger',
    dot: 'bg-danger',
    description:
      'Both the local copy and the repository changed. Resolve the conflict in the Sync Center before syncing again.',
  },
  blocked: {
    label: 'Push blocked',
    shortLabel: 'Blocked',
    variant: 'danger',
    dot: 'bg-danger',
    description:
      'A security scan blocked the pending push. Replace suspected credentials with template variables, then retry from the Sync Center.',
  },
}

export function syncStateMeta(state: AssetSyncState): SyncStateMeta {
  return SYNC_STATE_META[state]
}

/** Folder label used in filters, breadcrumbs, and card group headers. */
export function promptFolderLabel(folder: string): string {
  return normalizeFolder(folder) || 'Unfiled'
}

export function promptFolderPath(folder: string): string {
  return `prompts/${normalizeFolder(folder)}`.replace(/\/+$/, '')
}

export function promptRepositoryPath(
  prompt: Pick<PromptDetail, 'id' | 'title' | 'folder'>,
): string {
  return promptRepoPath(prompt, 'prompts')
}

/** Folder paths are the only option list the editor needs; children are implied by the path. */
export function folderOptionsFromTree(nodes: FolderNode[]): string[] {
  return flattenFolderTree(nodes).map((node) => node.path)
}

/** The shell search and the workspace search are combined before the FTS query. */
export function combineSearch(shellQuery: string, localQuery: string): string {
  return [shellQuery.trim(), localQuery.trim()].filter(Boolean).join(' ')
}

export function promptPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function promptExcerpt(item: PromptListItem): string {
  const excerpt = item.excerpt.trim()
  return excerpt || 'No body preview yet.'
}

export function promptVariableToken(variable: PromptVariable): string {
  return variable.example
    ? `{{${variable.name}:${variable.example}}}`
    : `{{${variable.name}}}`
}

export function duplicatePromptTitle(title: string): string {
  const base = title.trim() || 'Untitled Prompt'
  return `${base} (copy)`
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function uniqueTags(items: PromptListItem[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(tag)
    }
  }
  return result.sort((a, b) => a.localeCompare(b))
}
