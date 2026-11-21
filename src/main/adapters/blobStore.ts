import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../shared/domain/errors'
import { ensureDir, pathExists } from './fs'
import { sha256Hex } from './hash'

/**
 * Streaming writer for content-addressed blobs. It hashes and counts chunks as
 * they arrive, then atomically moves the finished file into place.
 */
export interface BlobWriteStream {
  write(chunk: Buffer): void
  finish(): { hash: string; size: number }
  abort(): void
}

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

  /**
   * Streams content into the store without buffering it. The temporary file
   * lives under blobs/.tmp because the final hash is only known at the end.
   */
  beginWrite(): BlobWriteStream {
    const tempDir = join(this.root, '.tmp')
    mkdirSync(tempDir, { recursive: true })
    const temp = join(tempDir, `.${process.pid}-${randomUUID()}.tmp`)
    const fd = openSync(temp, 'wx', 0o600)
    const hash = createHash('sha256')
    let size = 0
    let finished = false

    const discardTemp = (): void => {
      try {
        unlinkSync(temp)
      } catch {
        // The rename may already have moved the file.
      }
    }

    return {
      write: (chunk: Buffer): void => {
        if (finished) throw new AppError('INTERNAL', 'The blob stream is already closed.')
        hash.update(chunk)
        writeSync(fd, chunk)
        size += chunk.length
      },
      finish: (): { hash: string; size: number } => {
        if (finished) throw new AppError('INTERNAL', 'The blob stream is already closed.')
        finished = true
        let digest: string
        try {
          fsyncSync(fd)
          closeSync(fd)
          digest = hash.digest('hex')
        } catch (error) {
          discardTemp()
          throw error
        }
        const target = this.pathFor(digest)
        try {
          if (existsSync(target)) {
            if (statSync(target).size !== size) {
              throw new AppError('CORRUPT', `The stored blob ${digest} failed verification.`)
            }
            discardTemp()
          } else {
            mkdirSync(dirname(target), { recursive: true })
            renameSync(temp, target)
          }
        } catch (error) {
          discardTemp()
          throw error
        }
        return { hash: digest, size }
      },
      abort: (): void => {
        if (finished) return
        finished = true
        try {
          closeSync(fd)
        } catch {
          // The descriptor may already be closed.
        }
        discardTemp()
      },
    }
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

  /**
   * Reads at most `maxBytes` from the start of a blob. Detail views and search
   * indexing use this so a large file does not have to be loaded in full.
   */
  readPrefixSync(hash: string, maxBytes: number): Buffer {
    const target = this.pathFor(hash)
    const length = Math.max(0, Math.min(statSync(target).size, maxBytes))
    if (length === 0) return Buffer.alloc(0)
    const buffer = Buffer.alloc(length)
    const fd = openSync(target, 'r')
    try {
      let offset = 0
      while (offset < length) {
        const read = readSync(fd, buffer, offset, length - offset, offset)
        if (read <= 0) break
        offset += read
      }
      return offset === length ? buffer : buffer.subarray(0, offset)
    } finally {
      closeSync(fd)
    }
  }

  existsSync(hash: string): boolean {
    return existsSync(this.pathFor(hash))
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
