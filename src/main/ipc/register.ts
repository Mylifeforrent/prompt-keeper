import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcErrorPayload, IpcResult } from '../../shared/contracts'
import { CHANNEL_NAMES, CHANNELS } from '../../shared/channels'
import { AppError, isAppError } from '../../shared/domain/errors'
import type { AppContext } from '../context'
import type { Services } from '../services/types'

type Payload = Record<string, unknown> | undefined

interface HandlerOptions {
  context: AppContext
  services: Services
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

function obj(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('VALIDATION', 'The request payload must be an object.')
  }
  return payload as Record<string, unknown>
}

function str(payload: Payload, key: string, optional = false): string {
  const value = obj(payload)[key]
  if (typeof value !== 'string') {
    if (optional && value === undefined) return ''
    throw new AppError('VALIDATION', `The "${key}" field is required.`)
  }
  return value
}

function input<T>(payload: Payload): T {
  return obj(payload) as T
}

/** Preload methods such as `prompts.get(id)` send a bare string; accept both shapes. */
function idArg(payload: unknown): string {
  if (typeof payload === 'string') return payload
  return str(obj(payload), 'id')
}

function numeric(payload: Payload, key: string): number | undefined {
  const value = obj(payload)[key]
  return typeof value === 'number' ? value : undefined
}

function errorPayload(error: unknown, ctx: AppContext): IpcErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      retryable: error.retryable,
      ...(error.traceId ? { traceId: error.traceId } : {}),
    }
  }
  const traceId = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const message = error instanceof Error ? error.message : 'Unexpected internal error.'
  ctx.logger.error('ipc', 'Unhandled channel error', { traceId, message })
  return { code: 'INTERNAL', message: 'An unexpected error occurred. Use the trace ID for support.', retryable: false, traceId }
}

function requestIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).requestId
  return typeof value === 'string' ? value : null
}

function idempotencyCheck(
  ctx: AppContext,
  channel: string,
  payload: Payload,
): IpcResult<unknown> | null {
  const requestId = requestIdOf(payload)
  if (!requestId) return null
  const payloadHash = JSON.stringify(payload ?? null)
  const row = ctx.db
    .prepare('SELECT channel, payload_hash, result_json FROM idempotency WHERE request_id = ?')
    .get(requestId) as { channel: string; payload_hash: string; result_json: string } | undefined
  if (!row) return null
  if (row.channel !== channel || row.payload_hash !== payloadHash) {
    throw new AppError('VALIDATION', 'This request ID was already used with a different request.')
  }
  return JSON.parse(row.result_json) as IpcResult<unknown>
}

function storeIdempotency(
  ctx: AppContext,
  channel: string,
  payload: Payload,
  result: IpcResult<unknown>,
): void {
  const requestId = requestIdOf(payload)
  if (!requestId) return
  ctx.db
    .prepare(
      'INSERT OR REPLACE INTO idempotency (request_id, channel, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(requestId, channel, JSON.stringify(payload ?? null), JSON.stringify(result), new Date().toISOString())
}

export function registerIpc(options: HandlerOptions): void {
  const { services } = options

  const handlers: Record<string, (payload: Payload) => Promise<unknown> | unknown> = {
    [CHANNELS.app.bootstrap]: () => services.app.bootstrap(),
    [CHANNELS.app.theme]: (p) => services.app.theme(input(p)),
    [CHANNELS.app.openExternal]: (p) => services.app.openExternal(input(p)),
    [CHANNELS.app.revealPath]: (p) => services.app.revealPath(input(p)),
    [CHANNELS.projects.list]: () => services.app.projectsList(),
    [CHANNELS.projects.register]: (p) => services.app.projectsRegister(input(p)),
    [CHANNELS.projects.remove]: (p) => services.app.projectsRemove(input(p)),

    [CHANNELS.prompts.list]: (p) => services.prompts.list(input(p)),
    [CHANNELS.prompts.get]: (p) => services.prompts.get(idArg(p)),
    [CHANNELS.prompts.versions]: (p) => services.prompts.versions(idArg(p)),
    [CHANNELS.prompts.create]: (p) => services.prompts.create(input(p)),
    [CHANNELS.prompts.update]: (p) => services.prompts.update(input(p)),
    [CHANNELS.prompts.delete]: (p) => services.prompts.delete(input(p)),
    [CHANNELS.prompts.restore]: (p) => services.prompts.restore({ id: str(p, 'id') }),
    [CHANNELS.prompts.restoreVersion]: (p) => services.prompts.restoreVersion(input(p)),
    [CHANNELS.prompts.copyRender]: (p) => services.prompts.copyRender(input(p)),
    [CHANNELS.prompts.setSyncPolicy]: (p) => services.prompts.setSyncPolicy(input(p)),
    [CHANNELS.prompts.setFavorite]: (p) => services.prompts.setFavorite(input(p)),
    [CHANNELS.prompts.setPinned]: (p) => services.prompts.setPinned(input(p)),
    [CHANNELS.prompts.folders]: (p) => services.prompts.folders(input(p)),
    [CHANNELS.prompts.storeList]: (p) => services.prompts.storeList(input(p)),

    [CHANNELS.targets.list]: () => services.contracts.targets(),

    [CHANNELS.contracts.list]: (p) => services.contracts.list(input(p)),
    [CHANNELS.contracts.get]: (p) => services.contracts.get(idArg(p)),
    [CHANNELS.contracts.versions]: (p) => services.contracts.versions(idArg(p)),
    [CHANNELS.contracts.create]: (p) => services.contracts.create(input(p)),
    [CHANNELS.contracts.update]: (p) => services.contracts.update(input(p)),
    [CHANNELS.contracts.delete]: (p) => services.contracts.delete(input(p)),
    [CHANNELS.contracts.restore]: (p) => services.contracts.restore({ id: str(p, 'id') }),
    [CHANNELS.contracts.restoreVersion]: (p) => services.contracts.restoreVersion(input(p)),
    [CHANNELS.contracts.resolve]: (p) => services.contracts.resolve(input(p)),
    [CHANNELS.contracts.compile]: (p) => services.contracts.compile(input(p)),
    [CHANNELS.contracts.setSyncPolicy]: (p) => services.contracts.setSyncPolicy(input(p)),

    [CHANNELS.projections.list]: (p) => services.projections.list(input(p)),
    [CHANNELS.projections.project]: (p) => services.projections.project(input(p)),
    [CHANNELS.projections.reproject]: (p) =>
      services.projections.reproject({ projectionId: str(p, 'projectionId') }),
    [CHANNELS.projections.remove]: (p) =>
      services.projections.remove(input(p) as { projectionId: string; confirm: true }),
    [CHANNELS.projections.rollback]: (p) =>
      services.projections.rollback({ projectionId: str(p, 'projectionId') }),
    [CHANNELS.projections.overwriteDrift]: (p) => services.projections.overwriteDrift(input(p)),
    [CHANNELS.globalProjections.list]: (p) => services.projections.globalList(input(p)),
    [CHANNELS.globalProjections.project]: (p) => services.projections.globalProject(input(p)),
    [CHANNELS.globalProjections.reproject]: (p) =>
      services.projections.globalReproject({ projectionId: str(p, 'projectionId') }),
    [CHANNELS.globalProjections.remove]: (p) =>
      services.projections.globalRemove(input(p) as { projectionId: string; confirm: true }),
    [CHANNELS.globalProjections.rollback]: (p) =>
      services.projections.globalRollback({ projectionId: str(p, 'projectionId') }),
    [CHANNELS.globalProjections.overwriteDrift]: (p) =>
      services.projections.globalOverwriteDrift(input(p)),
    [CHANNELS.globalTargets.list]: () => services.projections.globalTargets(),
    [CHANNELS.globalTargets.updatePath]: (p) => services.projections.updateGlobalPath(input(p)),
    [CHANNELS.globalTargets.restoreDefault]: (p) =>
      services.projections.restoreGlobalDefault({ targetId: str(p, 'targetId') }),

    [CHANNELS.skills.list]: (p) => services.skills.list(input(p)),
    [CHANNELS.skills.get]: (p) => services.skills.get(idArg(p)),
    [CHANNELS.skills.versions]: (p) => services.skills.versions(idArg(p)),
    [CHANNELS.skills.files]: (p) => services.skills.files(input(p)),
    [CHANNELS.skills.create]: (p) => services.skills.create(input(p)),
    [CHANNELS.skills.update]: (p) => services.skills.update(input(p)),
    [CHANNELS.skills.delete]: (p) => services.skills.delete(input(p)),
    [CHANNELS.skills.restore]: (p) => services.skills.restore({ id: str(p, 'id') }),
    [CHANNELS.skills.restoreVersion]: (p) => services.skills.restoreVersion(input(p)),
    [CHANNELS.skills.import]: (p) => services.skills.import(input(p)),
    [CHANNELS.skills.storeList]: (p) => services.skills.storeList(input(p)),

    [CHANNELS.mcp.list]: (p) => services.mcp.list(input(p)),
    [CHANNELS.mcp.get]: (p) => services.mcp.get(idArg(p)),
    [CHANNELS.mcp.versions]: (p) => services.mcp.versions(idArg(p)),
    [CHANNELS.mcp.create]: (p) => services.mcp.create(input(p)),
    [CHANNELS.mcp.update]: (p) => services.mcp.update(input(p)),
    [CHANNELS.mcp.delete]: (p) => services.mcp.delete(input(p)),
    [CHANNELS.mcp.restore]: (p) => services.mcp.restore({ id: str(p, 'id') }),
    [CHANNELS.mcp.restoreVersion]: (p) => services.mcp.restoreVersion(input(p)),
    [CHANNELS.mcp.health]: (p) => services.mcp.health({ id: str(p, 'id') }),
    [CHANNELS.mcp.setEnabled]: (p) =>
      services.mcp.setEnabled(input(p) as { id: string; enabled: boolean }),
    [CHANNELS.mcp.setFavorite]: (p) => services.mcp.setFavorite(input(p)),
    [CHANNELS.mcp.agentState]: (p) => services.mcp.agentState(input(p)),
    [CHANNELS.mcp.importExternal]: (p) => services.mcp.importExternal(input(p)),
    [CHANNELS.mcp.apply]: (p) => services.mcp.apply(input(p)),
    [CHANNELS.mcp.remove]: (p) => services.mcp.remove(input(p)),
    [CHANNELS.mcp.storeList]: (p) => services.mcp.storeList(input(p)),

    [CHANNELS.sync.repoGet]: () => services.sync.repoGet(),
    [CHANNELS.sync.repoConnect]: (p) => services.sync.repoConnect(input(p)),
    [CHANNELS.sync.repoDisconnect]: (p) => services.sync.repoDisconnect(input(p)),
    [CHANNELS.sync.repoUpdate]: (p) => services.sync.repoUpdate(input(p)),
    [CHANNELS.sync.fetch]: (p) => services.sync.fetch(input(p)),
    [CHANNELS.sync.changes]: (p) => services.sync.changes(input(p)),
    [CHANNELS.sync.changeDetail]: (p) => services.sync.changeDetail({ changeId: str(p, 'changeId') }),
    [CHANNELS.sync.review]: (p) => services.sync.review(input(p)),
    [CHANNELS.sync.pull]: (p) => services.sync.pull(input(p)),
    [CHANNELS.sync.push]: (p) => services.sync.push(input(p)),
    [CHANNELS.sync.conflictResolve]: (p) => services.sync.conflictResolve(input(p)),
    [CHANNELS.sync.history]: (p) => services.sync.history(input(p)),
    [CHANNELS.sync.cancel]: (p) => services.sync.cancel({ operationId: str(p, 'operationId') }),

    [CHANNELS.dispatch.matrix]: (p) => services.dispatch.matrix(input(p)),
    [CHANNELS.dispatch.detail]: (p) => services.dispatch.detail({ assetId: str(p, 'assetId') }),
    [CHANNELS.dispatch.install]: (p) => services.dispatch.install(input(p)),
    [CHANNELS.dispatch.remove]: (p) => services.dispatch.remove(input(p)),
    [CHANNELS.dispatch.rollback]: (p) => services.dispatch.rollback(input(p)),
    [CHANNELS.dispatch.syncStale]: (p) => services.dispatch.syncStale(input(p)),

    [CHANNELS.search.query]: (p) => services.search.query(input(p)),
    [CHANNELS.search.rebuild]: (p) => services.search.rebuild(input(p)),

    [CHANNELS.settings.get]: () => services.settings.get(),
    [CHANNELS.settings.update]: (p) => services.settings.update(input(p)),
    [CHANNELS.settings.backup]: (p) => services.settings.backup(input(p)),
    [CHANNELS.settings.restore]: (p) => services.settings.restore(input(p)),
    [CHANNELS.settings.reset]: (p) => services.settings.reset(input(p)),
    [CHANNELS.settings.diagnostics]: (p) => services.settings.diagnostics(input(p)),

    [CHANNELS.updates.check]: () => services.updates.check(),
    [CHANNELS.updates.download]: (p) => services.updates.download(input(p)),
    [CHANNELS.updates.install]: (p) => services.updates.install(input(p)),
    [CHANNELS.updates.status]: () => services.updates.status(),

    [CHANNELS.ai.providers]: () => services.ai.providers(),
    [CHANNELS.ai.providerSave]: (p) => services.ai.providerSave(input(p)),
    [CHANNELS.ai.test]: (p) => services.ai.test(input(p)),
    [CHANNELS.ai.cancel]: (p) => services.ai.cancel(input(p)),
    [CHANNELS.ai.history]: (p) => services.ai.history(input(p)),
  }

  for (const name of CHANNEL_NAMES) {
    const handler = handlers[name]
    if (!handler) throw new Error(`Missing IPC handler for channel ${name}`)
    ipcMain.handle(name, async (event, payload: unknown): Promise<IpcResult<unknown>> => {
      if (!options.isTrustedSender(event)) {
        return {
          ok: false,
          error: {
            code: 'PERMISSION',
            message: 'The request did not come from the application window.',
            retryable: false,
          },
        }
      }
      try {
        const raw = JSON.stringify(payload ?? null)
        if (raw.length > MAX_PAYLOAD_BYTES) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION',
              message: 'The request is too large.',
              details: { kind: 'limit-exceeded', limitBytes: MAX_PAYLOAD_BYTES },
              retryable: false,
            },
          }
        }
        const cached = idempotencyCheck(options.context, name, payload as Payload)
        if (cached) return cached
        const data = await handler(payload as Payload)
        const result: IpcResult<unknown> = { ok: true, data: data ?? null }
        storeIdempotency(options.context, name, payload as Payload, result)
        return result
      } catch (error) {
        const result: IpcResult<unknown> = { ok: false, error: errorPayload(error, options.context) }
        if (result.error.code !== 'INTERNAL') {
          storeIdempotency(options.context, name, payload as Payload, result)
        }
        return result
      }
    })
  }
}

export { numeric }
