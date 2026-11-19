import type { Platform } from '../shared/domain/targets'
import type { SecretStore } from './adapters/secrets'
import type { BlobStore } from './adapters/blobStore'
import type { Db } from './db/database'
import type { EventBus } from './events'
import type { Logger } from './logging/logger'
import type { OperationManager } from './operations'
import type { AppPaths } from './paths'
import type { AssetStore } from './services/assetStore'
import type { AuditService } from './services/auditService'

export interface AppContext {
  db: Db
  paths: AppPaths
  blobs: BlobStore
  assets: AssetStore
  secrets: SecretStore
  events: EventBus
  operations: OperationManager
  audit: AuditService
  logger: Logger
  platform: Platform
  appVersion: string
  buildId: string
  safeStorageAvailable: boolean
  safeStorageReason?: string
}

export function setting<T>(ctx: AppContext, key: string, fallback: T): T {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    | { value_json: string }
    | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setSetting(ctx: AppContext, key: string, value: unknown): void {
  ctx.db
    .prepare(
      'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
    )
    .run(key, JSON.stringify(value), new Date().toISOString())
}
