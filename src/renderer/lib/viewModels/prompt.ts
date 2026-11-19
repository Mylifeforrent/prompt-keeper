import type {
  FolderNode,
  PromptDetail,
  PromptListItem,
  PromptQuery,
  PromptVariable,
} from '../../../shared/contracts'
import { flattenFolderTree, normalizeFolder } from '../../../shared/domain/folders'
import { promptRepoPath } from '../../../shared/domain/promptFile'

export type PromptSort = NonNullable<PromptQuery['sort']>
export type PromptViewMode = 'cards' | 'table'

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
