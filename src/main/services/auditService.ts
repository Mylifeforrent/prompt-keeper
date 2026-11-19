import type { AuditEvent, AuditEventType, Page, SyncHistoryQuery } from '../../shared/contracts'
import { newId, nowIso } from '../../shared/domain/ids'
import type { Db } from '../db/database'

export interface AuditInput {
  type: AuditEventType
  result?: 'success' | 'warning' | 'error'
  title: string
  detail?: Record<string, unknown>
  assetId?: string
  targetId?: string
  repoId?: string
  operationId?: string
}

export class AuditService {
  constructor(private readonly db: Db) {}

  log(input: AuditInput): AuditEvent {
    const event: AuditEvent = {
      id: newId('evt'),
      at: nowIso(),
      type: input.type,
      result: input.result ?? 'success',
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.repoId ? { repoId: input.repoId } : {}),
      ...(input.operationId ? { operationId: input.operationId } : {}),
    }
    this.db
      .prepare(
        'INSERT INTO audit_events (id, at, type, result, title, detail_json, asset_id, target_id, repo_id, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        event.id,
        event.at,
        event.type,
        event.result,
        event.title,
        JSON.stringify(event.detail ?? {}),
        event.assetId ?? null,
        event.targetId ?? null,
        event.repoId ?? null,
        event.operationId ?? null,
      )
    return event
  }

  list(query: SyncHistoryQuery): Page<AuditEvent> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const offset = Math.max(query.offset ?? 0, 0)
    const where: string[] = []
    const params: unknown[] = []
    if (query.type) {
      where.push('type = ?')
      params.push(query.type)
    }
    if (query.result) {
      where.push('result = ?')
      params.push(query.result)
    }
    if (query.from) {
      where.push('at >= ?')
      params.push(query.from)
    }
    if (query.to) {
      where.push('at <= ?')
      params.push(query.to)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM audit_events ${clause}`).get(...params) as {
        count: number
      }
    ).count
    const rows = this.db
      .prepare(`SELECT * FROM audit_events ${clause} ORDER BY at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Array<Record<string, unknown>>
    return {
      items: rows.map((row) => ({
        id: row.id as string,
        at: row.at as string,
        type: row.type as AuditEvent['type'],
        result: row.result as AuditEvent['result'],
        title: row.title as string,
        detail: JSON.parse((row.detail_json as string) || '{}') as Record<string, unknown>,
        ...(row.asset_id ? { assetId: row.asset_id as string } : {}),
        ...(row.target_id ? { targetId: row.target_id as string } : {}),
        ...(row.repo_id ? { repoId: row.repo_id as string } : {}),
        ...(row.operation_id ? { operationId: row.operation_id as string } : {}),
      })),
      total,
      limit,
      offset,
    }
  }

  count(type?: AuditEventType): number {
    const row = type
      ? (this.db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE type = ?').get(type) as {
          count: number
        })
      : (this.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number })
    return row.count
  }

  countsByType(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT type, COUNT(*) AS count FROM audit_events GROUP BY type')
      .all() as Array<{ type: string; count: number }>
    return Object.fromEntries(rows.map((row) => [row.type, row.count]))
  }
}
