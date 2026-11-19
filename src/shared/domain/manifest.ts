import type { SkillFileEntry } from '../contracts'

export interface ManifestFile {
  path: string
  blobHash: string
  size: number
  mediaKind: 'text' | 'binary'
  isExecutable: boolean
}

/** Canonical JSON with files sorted by path; the hash is computed over this string. */
export function canonicalManifestJson(files: ManifestFile[]): string {
  const sorted = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      path: file.path,
      blobHash: file.blobHash,
      size: file.size,
      mediaKind: file.mediaKind,
      isExecutable: file.isExecutable,
    }))
  return JSON.stringify(sorted)
}

export function toSkillFiles(files: ManifestFile[]): SkillFileEntry[] {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      path: file.path,
      size: file.size,
      mediaKind: file.mediaKind,
      isExecutable: file.isExecutable,
    }))
}

export function manifestMatches(a: ManifestFile[], b: ManifestFile[]): boolean {
  return canonicalManifestJson(a) === canonicalManifestJson(b)
}

export function isTextFile(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|tgz|7z|rar|exe|dll|so|dylib|bin|woff2?|ttf|otf|mp[34]|webm|mov|wav|sqlite)$/i.test(
    path,
  )
}

export function isScriptFile(path: string, content?: string): boolean {
  if (/\.(sh|bash|zsh|fish|ps1|bat|cmd|py|rb|js|mjs|cjs|ts|pl|php|lua)$/i.test(path)) return true
  if (content && /^#!.*\b(?:sh|bash|zsh|python|node|ruby|perl)\b/.test(content)) return true
  return false
}
