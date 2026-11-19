import type {
  IpcErrorPayload,
  OperationCompletedEvent,
  OperationRef,
  OperationResult,
  OperationType,
} from '../shared/contracts'
import { AppError, isAppError } from '../shared/domain/errors'
import { newId, nowIso } from '../shared/domain/ids'
import type { Db } from './db/database'
import type { EventBus } from './events'

export interface OperationSignal {
  cancelled: boolean
}

export interface OperationContext {
  operationId: string
  signal: OperationSignal
  progress(phase: string, completed: number, total: number, message?: string): void
}

export interface OperationOptions {
  repoId?: string
  assetId?: string
  targetPath?: string
  cancellable?: boolean
  sync?: boolean
}

interface ActiveOperation {
  ref: OperationRef
  signal: OperationSignal
  cancellable: boolean
}

export class OperationManager {
  private active = new Map<string, ActiveOperation>()

  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  start<T extends OperationResult>(
    type: OperationType,
    run: (ctx: OperationContext) => Promise<T>,
    options: OperationOptions = {},
  ): OperationRef {
    const operationId = newId('op')
    const startedAt = nowIso()
    const ref: OperationRef = { phase: 'started', operationId, type, startedAt }
    const signal: OperationSignal = { cancelled: false }
    this.active.set(operationId, { ref, signal, cancellable: options.cancellable ?? false })

    this.db
      .prepare(
        'INSERT INTO operations (id, type, state, repo_id, asset_id, target_path, detail_json, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        operationId,
        type,
        'started',
        options.repoId ?? null,
        options.assetId ?? null,
        options.targetPath ?? null,
        JSON.stringify({}),
        startedAt,
      )

    const ctx: OperationContext = {
      operationId,
      signal,
      progress: (phase, completed, total, message) => {
        const event = {
          operationId,
          type,
          phase,
          completed,
          total,
          ...(message ? { message } : {}),
          cancellable: options.cancellable ?? false,
          at: nowIso(),
        }
        if (options.sync && options.repoId) {
          this.events.syncProgress({
            ...event,
            repoId: options.repoId,
            direction:
              type === 'sync_fetch' ? 'fetch' : type === 'sync_pull' ? 'pull' : type === 'sync_push' ? 'push' : undefined,
          })
        } else {
          this.events.operationProgress(event)
        }
      },
    }

    void this.execute(operationId, type, run, ctx, options)
    return ref
  }

  private async execute<T extends OperationResult>(
    operationId: string,
    type: OperationType,
    run: (ctx: OperationContext) => Promise<T>,
    ctx: OperationContext,
    options: OperationOptions,
  ): Promise<void> {
    try {
      const result = await run(ctx)
      const at = nowIso()
      this.db
        .prepare('UPDATE operations SET state = ?, finished_at = ?, detail_json = ? WHERE id = ?')
        .run('committed', at, JSON.stringify({ result }), operationId)
      const event: OperationCompletedEvent = {
        operationId,
        type,
        state: 'committed',
        result,
        at,
      }
      this.events.operationCompleted(event)
    } catch (error) {
      const at = nowIso()
      const payload = this.toPayload(error)
      const state = ctx.signal.cancelled ? 'cancelled' : 'failed'
      this.db
        .prepare('UPDATE operations SET state = ?, finished_at = ?, detail_json = ? WHERE id = ?')
        .run(state, at, JSON.stringify({ error: payload }), operationId)
      const event: OperationCompletedEvent = {
        operationId,
        type,
        state,
        error: payload,
        at,
      }
      this.events.operationCompleted(event)
    } finally {
      this.active.delete(operationId)
      if (options.repoId) {
        this.events.domainChanged('sync', 'synced', [], operationId)
      }
    }
  }

  private toPayload(error: unknown): IpcErrorPayload {
    if (isAppError(error)) {
      return {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        retryable: error.retryable,
        ...(error.traceId ? { traceId: error.traceId } : {}),
      }
    }
    return {
      code: 'INTERNAL',
      message: error instanceof Error ? error.message : 'Unexpected internal error.',
      retryable: false,
    }
  }

  activeRefs(): OperationRef[] {
    return [...this.active.values()].map((entry) => entry.ref)
  }

  cancel(operationId: string): boolean {
    const entry = this.active.get(operationId)
    if (!entry || !entry.cancellable) return false
    entry.signal.cancelled = true
    return true
  }

  isActive(): boolean {
    return this.active.size > 0
  }

  checkNotCancelled(ctx: OperationContext): void {
    if (ctx.signal.cancelled) {
      throw new AppError('INTERNAL', 'The operation was cancelled.', { kind: 'unknown' })
    }
  }
}
