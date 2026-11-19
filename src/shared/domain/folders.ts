import type { FolderNode } from '../contracts'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Canonical folder form: no leading/trailing slash, `/` separators, root is ''. */
export function normalizeFolder(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

export function isSafeRelativePath(value: string): boolean {
  const path = value.replace(/\\/g, '/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((segment) => !!segment && segment !== '.' && segment !== '..')
}

export function isSafeFileName(value: string): boolean {
  const name = value.trim()
  if (!name || name === '.' || name === '..') return false
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return false
  if (name.endsWith('.') || name.endsWith(' ')) return false
  return !WINDOWS_RESERVED.test(name.replace(/\.[^.]+$/, ''))
}

export function validateFolder(folder: string): string | null {
  if (folder === '') return null
  if (!isSafeRelativePath(folder)) return 'Folder must be a relative path without "." or ".." segments.'
  for (const segment of folder.split('/')) {
    if (!isSafeFileName(segment)) return `Folder segment "${segment}" is not a valid directory name.`
  }
  return null
}

export function folderParent(folder: string): string {
  const idx = folder.lastIndexOf('/')
  return idx === -1 ? '' : folder.slice(0, idx)
}

export function folderName(folder: string): string {
  if (!folder) return 'Root'
  return folder.slice(folder.lastIndexOf('/') + 1)
}

/** '' (all) includes every folder; otherwise the folder itself and its descendants. */
export function folderInScope(folder: string, selected: string, includeDescendants = true): boolean {
  if (selected === '') return true
  if (folder === selected) return true
  return includeDescendants && folder.startsWith(`${selected}/`)
}

export function isFolderDescendant(folder: string, parent: string): boolean {
  return parent === '' ? true : folder === parent || folder.startsWith(`${parent}/`)
}

/** Lexical containment check; callers resolving real files must also canonicalize with realpath. */
export function isPathInside(root: string, candidate: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = normalize(root)
  const target = normalize(candidate)
  if (!base) return false
  return target === base || target.startsWith(`${base}/`)
}

export function slugify(title: string, fallback: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return slug || fallback
}

export function safePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (!cleaned || !isSafeFileName(cleaned)) return safePathSegment(fallback, 'asset')
  return cleaned
}

export function repoFilePath(root: string, folder: string, fileName: string): string {
  const normalized = normalizeFolder(folder)
  return normalized ? `${root}/${normalized}/${fileName}` : `${root}/${fileName}`
}

export interface FolderCount {
  path: string
  direct: number
  total: number
}

/** Build a nested tree from explicit folder counts. Root-folder assets are excluded from the tree. */
export function buildFolderTree(counts: FolderCount[]): FolderNode[] {
  const totals = new Map<string, { direct: number; total: number }>()
  for (const count of counts) {
    const parts = count.path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/')
      const current = totals.get(path) ?? { direct: 0, total: 0 }
      current.total += count.total
      if (i === parts.length) current.direct += count.direct
      totals.set(path, current)
    }
  }

  const nodes = new Map<string, FolderNode>()
  for (const [path, value] of totals) {
    nodes.set(path, {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      directCount: value.direct,
      totalCount: value.total,
      children: [],
    })
  }
  const roots: FolderNode[] = []
  for (const [path, node] of nodes) {
    const parent = folderParent(path)
    const parentNode = parent ? nodes.get(parent) : undefined
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}

export function flattenFolderTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenFolderTree(node.children)])
}
