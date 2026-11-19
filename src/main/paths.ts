import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AppPaths {
  userData: string
  db: string
  dbFile: string
  blobs: string
  library: string
  repos: string
  backups: string
  logs: string
  operations: string
  journalFile: string
  temp: string
}

export function resolveAppPaths(userData: string): AppPaths {
  return {
    userData,
    db: join(userData, 'db'),
    dbFile: join(userData, 'db', 'prompt-keeper.sqlite'),
    blobs: join(userData, 'blobs'),
    library: join(userData, 'library'),
    repos: join(userData, 'repos'),
    backups: join(userData, 'backups'),
    logs: join(userData, 'logs'),
    operations: join(userData, 'operations'),
    journalFile: join(userData, 'operations', 'journal.jsonl'),
    temp: join(userData, 'temp'),
  }
}

export function appDataDir(): string {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
}

/** Expand only the documented tokens. Renderer input never passes arbitrary environment variables. */
export function expandUserPath(value: string): string {
  let path = value.trim()
  if (path === '~') path = homedir()
  else if (path.startsWith('~/') || path.startsWith('~\\')) path = join(homedir(), path.slice(2))
  path = path.replace(/%APPDATA%/gi, appDataDir())
  path = path.replace(/%USERPROFILE%/gi, homedir())
  return path
}

export function isAbsoluteUserPath(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.startsWith('~')) return true
  return /^([A-Za-z]:[\\/]|\/)/.test(trimmed)
}
