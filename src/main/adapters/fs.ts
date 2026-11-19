import { closeSync, constants, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../shared/domain/errors'

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function readBufferIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function withRetry<T>(action: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
  throw lastError
}

/**
 * Temp file in the same directory, fsync, then rename. A crash leaves either
 * the previous file or the complete new file, never a partial write.
 */
export async function writeAtomic(
  target: string,
  content: string | Buffer,
  options: { mode?: number; backup?: boolean } = {},
): Promise<{ previousContent: Buffer | null; previousHash?: string }> {
  await ensureDir(dirname(target))
  const previous = await readBufferIfExists(target)
  const temp = join(dirname(target), `.pk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temp, 'wx', options.mode ?? 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = null
    if (previous && options.mode === undefined) {
      const info = await stat(target).catch(() => null)
      if (info?.mode) await import('node:fs/promises').then((fs) => fs.chmod(temp, info.mode))
    }
    await withRetry(() => rename(temp, target))
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError('PERMISSION', `Cannot write ${target}: the operating system denied permission.`, {
        kind: 'unknown',
        path: target,
      })
    }
    if (code === 'EBUSY') {
      throw new AppError('LOCKED', `${target} is locked by another process. Close it and retry.`, {
        kind: 'unknown',
        path: target,
      })
    }
    throw error
  }
  return {
    previousContent: previous,
    previousHash: previous ? createHashOf(previous) : undefined,
  }
}

function createHashOf(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function removeIfExists(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

export async function listFilesRecursive(
  root: string,
  options: { rejectSymlinks?: boolean; maxFiles?: number } = {},
): Promise<Array<{ path: string; size: number; isExecutable: boolean }>> {
  const out: Array<{ path: string; size: number; isExecutable: boolean }> = []
  const maxFiles = options.maxFiles ?? 5000
  async function walk(dir: string, prefix: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        if (options.rejectSymlinks !== false) {
          throw new AppError('VALIDATION', `Symlinks are not imported: ${relative}.`)
        }
        continue
      }
      if (entry.isDirectory()) {
        await walk(full, relative)
      } else if (entry.isFile()) {
        if (out.length >= maxFiles) {
          throw new AppError('VALIDATION', `The import contains more than ${maxFiles} files.`)
        }
        const info = await stat(full)
        out.push({
          path: relative,
          size: info.size,
          isExecutable: (info.mode & 0o111) !== 0,
        })
      }
    }
  }
  await walk(root, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function copyFileEnsured(source: string, target: string): Promise<void> {
  await ensureDir(dirname(target))
  await copyFile(source, target)
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, content, 'utf8')
}

export async function directorySize(path: string): Promise<number> {
  let total = 0
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size
    }
  }
  if (!(await pathExists(path))) return 0
  await walk(path)
  return total
}

/** Synchronous variant used when materialization must complete before the caller returns. */
export function writeAtomicSync(
  target: string,
  content: string | Buffer,
  options: { mode?: number } = {},
): void {
  mkdirSync(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.pk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  const fd = openSync(temp, 'wx', options.mode ?? 0o600)
  try {
    if (typeof content === 'string') writeSync(fd, content)
    else writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temp, target)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // Best effort cleanup.
    }
    throw error
  }
}
