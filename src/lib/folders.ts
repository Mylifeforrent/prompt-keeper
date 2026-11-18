/**
 * 文件夹即仓库结构：
 * - 库内 folder 使用 `/` 表示层级（例如 编程/前端）
 * - 仓库路径由同一 folder 直接生成，保证不用平台也能在 Git 中按目录浏览
 * - 单层文件夹是特例，多级文件夹不需要额外配置
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
  if (folder === UNFILED_KEY) return '未分类'
  const normalized = normalizeFolder(folder)
  return normalized ?? '未分类'
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

/** 仓库目录段：保留中文，替换路径分隔符与文件系统保留字符 */
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
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
}

export interface FolderNode {
  name: string
  path: string
  count: number
  children: FolderNode[]
}

/** 构建多级文件夹树；count 表示该目录及其子目录下的资产总数 */
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
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)
  return roots
}

export function countUnfiled<T>(items: T[], getFolder: (item: T) => string | null | undefined): number {
  return items.filter((item) => !normalizeFolder(getFolder(item))).length
}

/**
 * 从仓库路径反推库内文件夹。
 * tailSegments：文件本身占用的段数（prompt/contract/mcp 为 1，skill 为 2：<skill>/SKILL.md）
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
