import { safeStorage } from 'electron'
import type { Db } from '../db/database'
import { AppError } from '../../shared/domain/errors'
import { newId, nowIso } from '../../shared/domain/ids'

export type SecretOwnerType = 'mcp_env' | 'mcp_header' | 'ai_key' | 'git_token'

export interface SecretStore {
  available(): boolean
  reason(): string | undefined
  set(ownerType: SecretOwnerType, ownerId: string, key: string, value: string): void
  get(ownerType: SecretOwnerType, ownerId: string, key: string): string | null
  has(ownerType: SecretOwnerType, ownerId: string, key: string): boolean
  listKeys(ownerType: SecretOwnerType, ownerId: string): string[]
  delete(ownerType: SecretOwnerType, ownerId: string, key: string): void
  deleteOwner(ownerType: SecretOwnerType, ownerId: string): void
}

/** OS-backed encryption through Electron safeStorage. Never falls back to plaintext. */
export class ElectronSecretStore implements SecretStore {
  constructor(private readonly db: Db) {}

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  reason(): string | undefined {
    if (this.available()) return undefined
    return 'Operating-system secret encryption is unavailable. Secrets cannot be stored until the OS keychain or DPAPI is accessible.'
  }

  private requireAvailable(): void {
    if (!this.available()) {
      throw new AppError('UNSUPPORTED', this.reason() ?? 'Secret encryption is unavailable.', {
        kind: 'unsupported',
        feature: 'safeStorage',
        reason: this.reason() ?? 'unavailable',
      })
    }
  }

  set(ownerType: SecretOwnerType, ownerId: string, key: string, value: string): void {
    this.requireAvailable()
    const ciphertext = safeStorage.encryptString(value)
    const at = nowIso()
    const existing = this.db
      .prepare('SELECT id FROM secrets WHERE owner_type = ? AND owner_id = ? AND key = ?')
      .get(ownerType, ownerId, key) as { id: string } | undefined
    if (existing) {
      this.db
        .prepare('UPDATE secrets SET ciphertext = ?, updated_at = ? WHERE id = ?')
        .run(ciphertext, at, existing.id)
    } else {
      this.db
        .prepare(
          'INSERT INTO secrets (id, owner_type, owner_id, key, ciphertext, key_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(newId('sec'), ownerType, ownerId, key, ciphertext, at, at)
    }
  }

  get(ownerType: SecretOwnerType, ownerId: string, key: string): string | null {
    this.requireAvailable()
    const row = this.db
      .prepare('SELECT ciphertext FROM secrets WHERE owner_type = ? AND owner_id = ? AND key = ?')
      .get(ownerType, ownerId, key) as { ciphertext: Buffer } | undefined
    if (!row) return null
    return safeStorage.decryptString(Buffer.from(row.ciphertext))
  }

  has(ownerType: SecretOwnerType, ownerId: string, key: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM secrets WHERE owner_type = ? AND owner_id = ? AND key = ?')
      .get(ownerType, ownerId, key)
  }

  listKeys(ownerType: SecretOwnerType, ownerId: string): string[] {
    return this.db
      .prepare('SELECT key FROM secrets WHERE owner_type = ? AND owner_id = ? ORDER BY key')
      .all(ownerType, ownerId)
      .map((row) => (row as { key: string }).key)
  }

  delete(ownerType: SecretOwnerType, ownerId: string, key: string): void {
    this.db
      .prepare('DELETE FROM secrets WHERE owner_type = ? AND owner_id = ? AND key = ?')
      .run(ownerType, ownerId, key)
  }

  deleteOwner(ownerType: SecretOwnerType, ownerId: string): void {
    this.db.prepare('DELETE FROM secrets WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId)
  }
}
