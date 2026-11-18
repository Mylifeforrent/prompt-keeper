/**
 * Folders are repo directories:
 * - A library folder uses `/` to express hierarchy (e.g. engineering/code-quality)
 * - The repository path is generated directly from the same folder, so directories can be browsed in Git without opening the app
 * - Single-level folders are a special case; nested folders need no extra configuration
 */

export const UNFILED_KEY = '__unfiled__'

export function normalizeFolder(value: string | null | undefined): string | null {
  const parts = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts.join('/') : null
}

export function folderLabel(folder: string | null | undefined): string {
  if (folder === UNFILED_KEY) return 'Uncategorized'
  const normalized = normalizeFolder(folder)
  return normalized ?? 'Uncategorized'
}

export function folderDepth(folder: string | null | undefined): number {
  const normalized = normalizeFolder(folder)
  return normalized ? normalized.split('/').length : 0
}

export function folderMatches(folder: string | null | undefined, selected: string): boolean {
  const normalized = normalizeFolder(folder)
  if (!selected) return true
  if (selected === UNFILED_KEY) return !normalized
  if (!normalized) return false
  return normalized === selected || normalized.startsWith(`${selected}/`)
}

/** Repo path segment: preserves the folder name, replacing path separators and filesystem-reserved characters */
export function safePathSegment(input: string, fallback = 'untitled'): string {
  const name = input
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return name || fallback
}

export function folderToRepoPath(folder: string | null | undefined): string {
  const normalized = normalizeFolder(folder)
  if (!normalized) return ''
  return normalized
    .split('/')
    .map((part) => safePathSegment(part, 'folder'))
    .join('/')
}

export function repoFilePath(root: string, folder: string | null | undefined, fileName: string): string {
  const base = root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const folderPath = folderToRepoPath(folder)
  return [base, folderPath, fileName].filter(Boolean).join('/')
}

export function folderOptions<T>(
  items: T[],
  getFolder: (item: T) => string | null | undefined,
): string[] {
  const set = new Set<string>()
  for (const item of items) {
    const normalized = normalizeFolder(getFolder(item))
    if (!normalized) continue
    const parts = normalized.split('/')
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      set.add(path)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en'))
}

export interface FolderNode {
  name: string
  path: string
  count: number
  children: FolderNode[]
}

/** Build the nested folder tree; count is the number of assets in that directory and its subdirectories */
export function buildFolderTree<T>(
  items: T[],
  getFolder: (item: T) => string | null | undefined,
): FolderNode[] {
  const roots: FolderNode[] = []
  const map = new Map<string, FolderNode>()

  for (const item of items) {
    const normalized = normalizeFolder(getFolder(item))
    if (!normalized) continue
    const parts = normalized.split('/')
    let parentPath = ''
    for (const part of parts) {
      const path = parentPath ? `${parentPath}/${part}` : part
      let node = map.get(path)
      if (!node) {
        node = { name: part, path, count: 0, children: [] }
        map.set(path, node)
        if (parentPath) map.get(parentPath)!.children.push(node)
        else roots.push(node)
      }
      node.count += 1
      parentPath = path
    }
  }

  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)
  return roots
}

export function countUnfiled<T>(items: T[], getFolder: (item: T) => string | null | undefined): number {
  return items.filter((item) => !normalizeFolder(getFolder(item))).length
}

/**
 * Derive the library folder from a repository path.
 * tailSegments: number of path segments occupied by the file itself (1 for prompt/contract/mcp, 2 for skill: <skill>/SKILL.md)
 */
export function folderFromRepoPath(
  repoPath: string,
  rootDir: string,
  tailSegments = 1,
): string | null {
  const normalizedPath = repoPath.replace(/\\/g, '/').replace(/^\.?\//, '')
  const normalizedRoot = rootDir.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
  const prefix = normalizedRoot ? `${normalizedRoot}/` : ''
  const relative = normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath
  const parts = relative.split('/').filter(Boolean)
  const folderParts = parts.slice(0, Math.max(0, parts.length - tailSegments))
  return folderParts.length ? folderParts.join('/') : null
}

export function folderBreadcrumb(folder: string | null | undefined): { label: string; path: string }[] {
  const normalized = normalizeFolder(folder)
  if (!normalized) return []
  const parts = normalized.split('/')
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join('/'),
  }))
}
