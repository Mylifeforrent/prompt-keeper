import type { IpcErrorCode, IpcErrorDetails } from '../contracts'

const RETRYABLE: Record<IpcErrorCode, boolean> = {
  VALIDATION: false,
  NOT_FOUND: false,
  CONFLICT: false,
  REVISION_CONFLICT: false,
  PERMISSION: false,
  LOCKED: true,
  GIT_NOT_FOUND: false,
  GIT_AUTH: false,
  GIT_CONFLICT: false,
  NETWORK: true,
  SECURITY_BLOCK: false,
  UNSUPPORTED: false,
  CORRUPT: false,
  INTERNAL: false,
}

export class AppError extends Error {
  readonly code: IpcErrorCode
  readonly details?: IpcErrorDetails
  readonly retryable: boolean
  readonly traceId?: string

  constructor(
    code: IpcErrorCode,
    message: string,
    details?: IpcErrorDetails,
    retryable = RETRYABLE[code],
    traceId?: string,
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
    this.retryable = retryable
    this.traceId = traceId
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function validationError(message: string, fields?: Array<{ path: string; message: string }>): AppError {
  return new AppError('VALIDATION', message, fields ? { kind: 'validation', fields } : undefined)
}

export function notFound(message: string): AppError {
  return new AppError('NOT_FOUND', message)
}

export function conflict(message: string, details?: IpcErrorDetails): AppError {
  return new AppError('CONFLICT', message, details)
}

export function unsupported(message: string, reason: string, targetId?: string): AppError {
  return new AppError('UNSUPPORTED', message, { kind: 'unsupported', reason, targetId })
}
