import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../shared/domain/errors'
import { ensureDir, pathExists } from './fs'
import { sha256Hex } from './hash'

/**
 * Content-addressed store: blobs/<aa>/<bb>/<sha256>. Writes are atomic and
 * reads verify the hash before content is trusted.
 */
export class BlobStore {
  constructor(private readonly root: string) {}

  private pathFor(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new AppError('CORRUPT', 'The blob hash is not a SHA-256 value.')
    }
    return join(this.root, hash.slice(0, 2), hash.slice(2, 4), hash)
  }

  async write(content: Buffer): Promise<{ hash: string; size: number }> {
    const hash = sha256Hex(content)
    const target = this.pathFor(hash)
    if (await pathExists(target)) {
      const existing = await readFile(target)
      if (existing.length !== content.length || sha256Hex(existing) !== hash) {
        throw new AppError('CORRUPT', `The stored blob ${hash} failed verification.`)
      }
      return { hash, size: content.length }
    }
    await ensureDir(join(this.root, hash.slice(0, 2), hash.slice(2, 4)))
    const temp = join(this.root, hash.slice(0, 2), hash.slice(2, 4), `.${hash}.${process.pid}.tmp`)
    const handle = await (await import('node:fs/promises')).open(temp, 'wx')
    try {
      await handle.writeFile(content)
      await handle.sync()
      await handle.close()
      await rename(temp, target)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(temp).catch(() => undefined)
      throw error
    }
    return { hash, size: content.length }
  }

  /** Synchronous write kept for revision transactions that must stay atomic. */
  writeSync(content: Buffer): { hash: string; size: number } {
    const hash = sha256Hex(content)
    const target = this.pathFor(hash)
    if (existsSync(target)) return { hash, size: content.length }
    const dir = join(this.root, hash.slice(0, 2), hash.slice(2, 4))
    mkdirSync(dir, { recursive: true })
    const temp = join(dir, `.${hash}.${process.pid}.tmp`)
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(temp, target)
    } catch (error) {
      unlinkSync(temp)
      throw error
    }
    return { hash, size: content.length }
  }

  async read(hash: string): Promise<Buffer> {
    let content: Buffer
    try {
      content = readFileSync(this.pathFor(hash))
    } catch {
      throw new AppError('CORRUPT', 'A required content blob is missing. Restore it from a version or pull it again.', {
        kind: 'unknown',
        hash,
      })
    }
    if (sha256Hex(content) !== hash) {
      throw new AppError('CORRUPT', 'A content blob failed its integrity check.', {
        kind: 'unknown',
        hash,
      })
    }
    return content
  }

  readSync(hash: string): Buffer {
    return readFileSync(this.pathFor(hash))
  }

  async exists(hash: string): Promise<boolean> {
    return pathExists(this.pathFor(hash))
  }

  async verify(hash: string): Promise<boolean> {
    try {
      await this.read(hash)
      return true
    } catch {
      return false
    }
  }

  async deleteHash(hash: string): Promise<void> {
    await unlink(this.pathFor(hash)).catch(() => undefined)
  }
}
