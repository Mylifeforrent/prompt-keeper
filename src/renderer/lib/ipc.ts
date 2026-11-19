import type { IpcErrorCode, IpcErrorDetails, IpcResult } from '../../shared/contracts'
import type { PromptKeeperBridge } from '../../shared/bridge'

export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly details?: IpcErrorDetails,
    readonly retryable = false,
    readonly traceId?: string,
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

type Unwrapped<T> = T extends Promise<IpcResult<infer U>> ? Promise<U> : never

export type IpcClient = {
  [G in keyof Omit<PromptKeeperBridge, 'events'>]: {
    [M in keyof PromptKeeperBridge[G]]: PromptKeeperBridge[G][M] extends (
      ...args: infer A
    ) => infer R
      ? (...args: A) => Unwrapped<R>
      : never
  }
}

async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  let result: IpcResult<T>
  try {
    result = await promise
  } catch (error) {
    throw new IpcError(
      'INTERNAL',
      error instanceof Error ? error.message : 'The main process did not respond.',
      undefined,
      false,
    )
  }
  if (!result.ok) {
    const { code, message, details, retryable, traceId } = result.error
    throw new IpcError(code, message, details, retryable, traceId)
  }
  return result.data
}

function buildClient(): IpcClient {
  const client: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}
  const bridgeGroups = window.promptKeeper
  for (const group of Object.keys(bridgeGroups)) {
    if (group === 'events') continue
    const namespace = (bridgeGroups as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<IpcResult<unknown>>>>)[group]
    const wrapped: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const [method, fn] of Object.entries(namespace)) {
      wrapped[method] = (...args: unknown[]) => unwrap(fn(...args))
    }
    client[group] = wrapped
  }
  return client as unknown as IpcClient
}

let cached: IpcClient | null = null

/** The only renderer module that touches window.promptKeeper. */
export function getIpc(): IpcClient {
  if (!cached) cached = buildClient()
  return cached
}

export const ipc = new Proxy({} as IpcClient, {
  get(_target, property: string) {
    return getIpc()[property as keyof IpcClient]
  },
})

export function isIpcError(error: unknown): error is IpcError {
  return error instanceof IpcError
}

export function errorMessage(error: unknown): string {
  if (isIpcError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

export function errorDetails(error: unknown): IpcErrorDetails | undefined {
  return isIpcError(error) ? error.details : undefined
}

export const events = {
  onDomainChanged: (listener: Parameters<PromptKeeperBridge['events']['onDomainChanged']>[0]) =>
    window.promptKeeper.events.onDomainChanged(listener),
  onOperationProgress: (listener: Parameters<PromptKeeperBridge['events']['onOperationProgress']>[0]) =>
    window.promptKeeper.events.onOperationProgress(listener),
  onOperationCompleted: (listener: Parameters<PromptKeeperBridge['events']['onOperationCompleted']>[0]) =>
    window.promptKeeper.events.onOperationCompleted(listener),
  onSyncProgress: (listener: Parameters<PromptKeeperBridge['events']['onSyncProgress']>[0]) =>
    window.promptKeeper.events.onSyncProgress(listener),
  onUpdateAvailable: (listener: Parameters<PromptKeeperBridge['events']['onUpdateAvailable']>[0]) =>
    window.promptKeeper.events.onUpdateAvailable(listener),
  onAiStream: (listener: Parameters<PromptKeeperBridge['events']['onAiStream']>[0]) =>
    window.promptKeeper.events.onAiStream(listener),
}
