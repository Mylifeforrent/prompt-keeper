import type {
  AiHistoryQuery,
  AiProviderInfo,
  AiProviderSaveInput,
  AiStreamEvent,
  AiStreamHandle,
  AiTestInput,
  AiTestRun,
  CancelResult,
  IpcErrorPayload,
  Page,
} from '../../shared/contracts'
import { AppError, isAppError, validationError } from '../../shared/domain/errors'
import { newId, nowIso } from '../../shared/domain/ids'
import { renderTemplate } from '../../shared/domain/variables'
import { redact } from '../logging/logger'
import { setting, setSetting, type AppContext } from '../context'
import type { AiService } from './types'

const DISCLOSURE_SETTING_KEY = 'ai.disclosureAcceptedAt'
const REQUEST_TIMEOUT_MS = 120_000
const RESPONSE_PREVIEW_LENGTH = 500
const RESPONSE_BUFFER_LIMIT = 200_000

interface AiProviderRow {
  id: string
  name: string
  base_url: string
  model: string
  is_default: number
  key_updated_at: string | null
}

interface AiRunRow {
  id: string
  provider_id: string
  model: string
  prompt_id: string | null
  started_at: string
  duration_ms: number
  status: AiTestRun['status']
  response_preview: string
  error_code: string | null
}

interface SseUsageRaw {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
  usage?: SseUsageRaw
  error?: { message?: unknown }
}

interface ActiveStream {
  controller: AbortController
  startedMs: number
  startedAt: string
  providerId: string
  model: string
  promptId: string | null
  userCancelled: boolean
  timedOut: boolean
}

export function listAiProviders(ctx: AppContext): AiProviderInfo[] {
  const rows = ctx.db
    .prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, created_at')
    .all() as AiProviderRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasKey: ctx.secrets.has('ai_key', row.id, 'api_key'),
    ...(row.key_updated_at ? { keyUpdatedAt: row.key_updated_at } : {}),
    isDefault: !!row.is_default,
  }))
}

function requireText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) {
    throw validationError(`The ${field} field is required.`, [
      { path: field, message: 'This field is required.' },
    ])
  }
  if (text.length > maxLength) {
    throw validationError(`The ${field} field is too long.`, [
      { path: field, message: `Use ${maxLength} characters or fewer.` },
    ])
  }
  return text
}

/** OpenAI-compatible base URLs must be https and must not carry embedded credentials. */
function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    throw validationError('The base URL is required.', [
      { path: 'baseUrl', message: 'Enter an https base URL such as https://api.openai.com/v1.' },
    ])
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw validationError('The base URL is not a valid URL.', [
      { path: 'baseUrl', message: 'Enter a valid https URL.' },
    ])
  }
  if (url.protocol !== 'https:') {
    throw validationError('The base URL must use https.', [
      { path: 'baseUrl', message: 'Only https endpoints are supported.' },
    ])
  }
  if (url.username || url.password) {
    throw validationError('The base URL must not contain credentials.', [
      { path: 'baseUrl', message: 'Remove the username and password from the URL.' },
    ])
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

function mapUsage(raw: SseUsageRaw | undefined): AiStreamEvent['usage'] | undefined {
  if (!raw) return undefined
  const inputTokens = raw.input_tokens ?? raw.prompt_tokens
  const outputTokens = raw.output_tokens ?? raw.completion_tokens
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function providerResponseError(status: number, body: string): AppError {
  let providerMessage = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') providerMessage = parsed.error.message
  } catch {
    providerMessage = ''
  }
  const detail = redact(providerMessage || body).replace(/\s+/g, ' ').trim().slice(0, 300)
  const suffix = detail ? ` ${detail}` : ''
  if (status === 401 || status === 403) {
    return new AppError('PERMISSION', `The provider rejected the API key (HTTP ${status}).${suffix}`)
  }
  if (status === 429 || status >= 500) {
    return new AppError('NETWORK', `The provider is unavailable (HTTP ${status}).${suffix}`, undefined, true)
  }
  return new AppError('VALIDATION', `The provider rejected the request (HTTP ${status}).${suffix}`)
}

function toErrorPayload(error: unknown): IpcErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      retryable: error.retryable,
      ...(error.traceId ? { traceId: error.traceId } : {}),
    }
  }
  const message =
    error instanceof Error
      ? redact(error.message).slice(0, 300)
      : 'The provider request failed. Check the base URL and network connection.'
  return { code: 'NETWORK', message, retryable: true }
}

export function createAiService(ctx: AppContext): AiService {
  const activeStreams = new Map<string, ActiveStream>()

  function getProvider(providerId: string): AiProviderRow {
    const row = ctx.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as
      | AiProviderRow
      | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This AI provider no longer exists.')
    return row
  }

  function recordRun(input: {
    providerId: string
    model: string
    promptId: string | null
    startedAt: string
    durationMs: number
    status: AiTestRun['status']
    responseText: string
    errorCode?: string
  }): void {
    try {
      ctx.db
        .prepare(
          `INSERT INTO ai_runs
             (id, provider_id, model, prompt_id, started_at, duration_ms, status, response_preview, error_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId('air'),
          input.providerId,
          input.model,
          input.promptId,
          input.startedAt,
          input.durationMs,
          input.status,
          input.responseText.slice(0, RESPONSE_PREVIEW_LENGTH),
          input.errorCode ?? null,
        )
    } catch (error) {
      ctx.logger.warn('ai', 'AI run history could not be recorded', {
        message: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  async function requestStream(params: {
    streamId: string
    entry: ActiveStream
    url: string
    apiKey: string
    model: string
    systemPrompt: string
    userPrompt: string
  }): Promise<{ text: string; usage?: AiStreamEvent['usage'] }> {
    const { streamId, entry, url, apiKey, model, systemPrompt, userPrompt } = params
    const throwIfAborted = (): void => {
      if (entry.userCancelled || entry.timedOut) {
        const error = new Error('The request was aborted.')
        error.name = 'AbortError'
        throw error
      }
    }
    throwIfAborted()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: entry.controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw providerResponseError(response.status, body)
    }
    if (!response.body) {
      throw new AppError('NETWORK', 'The provider returned an empty response.', undefined, true)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let usage: AiStreamEvent['usage'] | undefined
    let finished = false

    const handleLine = (rawLine: string): void => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (!line || line.startsWith(':') || !line.startsWith('data:')) return
      const data = line.slice(5).trim()
      if (!data) return
      if (data === '[DONE]') {
        finished = true
        return
      }
      let chunk: ChatCompletionChunk
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk
      } catch {
        return
      }
      if (chunk.error) {
        const message =
          typeof chunk.error.message === 'string'
            ? redact(chunk.error.message).slice(0, 300)
            : 'The provider reported an error during the stream.'
        throw new AppError('NETWORK', message, undefined, true)
      }
      const delta = chunk.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        text = (text + delta).slice(0, RESPONSE_BUFFER_LIMIT)
        ctx.events.aiStream({ streamId, type: 'delta', delta, at: nowIso() })
      }
      const mapped = mapUsage(chunk.usage)
      if (mapped) usage = mapped
    }

    try {
      while (!finished) {
        throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          handleLine(buffer.slice(0, index))
          buffer = buffer.slice(index + 1)
          if (finished) break
          index = buffer.indexOf('\n')
        }
      }
      buffer += decoder.decode()
      if (!finished && buffer) handleLine(buffer)
    } finally {
      await reader.cancel().catch(() => undefined)
    }

    return { text, ...(usage ? { usage } : {}) }
  }

  async function runStream(params: {
    streamId: string
    entry: ActiveStream
    url: string
    apiKey: string
    model: string
    systemPrompt: string
    userPrompt: string
  }): Promise<void> {
    const { streamId, entry } = params
    let timer: ReturnType<typeof setTimeout> | null = null
    let responseText = ''
    let status: AiTestRun['status'] = 'failed'
    let errorPayload: IpcErrorPayload | undefined
    let usage: AiStreamEvent['usage'] | undefined

    try {
      timer = setTimeout(() => {
        entry.timedOut = true
        entry.controller.abort()
      }, REQUEST_TIMEOUT_MS)
      timer.unref()

      const result = await requestStream(params)
      responseText = result.text
      usage = result.usage
      status = entry.userCancelled ? 'cancelled' : 'completed'
    } catch (error) {
      if (entry.userCancelled) {
        status = 'cancelled'
      } else if (entry.timedOut || isAbortError(error)) {
        status = 'failed'
        errorPayload = {
          code: 'NETWORK',
          message: 'The provider did not respond in time.',
          retryable: true,
        }
      } else {
        status = 'failed'
        errorPayload = toErrorPayload(error)
      }
    } finally {
      if (timer) clearTimeout(timer)
      activeStreams.delete(streamId)
    }

    recordRun({
      providerId: entry.providerId,
      model: entry.model,
      promptId: entry.promptId,
      startedAt: entry.startedAt,
      durationMs: Math.max(0, Date.now() - entry.startedMs),
      status,
      responseText,
      ...(errorPayload ? { errorCode: errorPayload.code } : {}),
    })

    if (status === 'completed') {
      ctx.events.aiStream({
        streamId,
        type: 'done',
        ...(usage ? { usage } : {}),
        at: nowIso(),
      })
    } else if (status === 'cancelled') {
      // Cancellation is not an error: close the stream so the renderer stops.
      ctx.events.aiStream({ streamId, type: 'done', at: nowIso() })
    } else {
      ctx.events.aiStream({
        streamId,
        type: 'error',
        error:
          errorPayload ?? {
            code: 'INTERNAL',
            message: 'The AI test failed before a response was produced.',
            retryable: false,
          },
        at: nowIso(),
      })
    }

    // Metadata only: prompts, variables, responses, and keys are never logged.
    ctx.logger.info('ai', 'AI test finished', {
      providerId: entry.providerId,
      model: entry.model,
      durationMs: Math.max(0, Date.now() - entry.startedMs),
      status,
    })
  }

  return {
    async providers(): Promise<AiProviderInfo[]> {
      return listAiProviders(ctx)
    },

    async providerSave(input: AiProviderSaveInput): Promise<AiProviderInfo> {
      const name = requireText(input?.name, 'name', 120)
      const baseUrl = normalizeBaseUrl(input?.baseUrl)
      const model = requireText(input?.model, 'model', 200)
      if (input?.id !== undefined && typeof input.id !== 'string') {
        throw validationError('The provider ID is invalid.', [
          { path: 'id', message: 'Provide a string provider ID or omit the field.' },
        ])
      }
      const requestedId = typeof input?.id === 'string' ? input.id.trim() : ''
      const requestedKey = input?.apiKey
      if (requestedKey !== undefined && requestedKey !== null && typeof requestedKey !== 'string') {
        throw validationError('The API key must be text.', [
          { path: 'apiKey', message: 'Provide a string, null, or omit the field.' },
        ])
      }
      const apiKeyValue = typeof requestedKey === 'string' ? requestedKey.trim() : ''
      const keyAction: 'none' | 'set' | 'clear' =
        requestedKey === null ? 'clear' : apiKeyValue ? 'set' : 'none'
      if (keyAction === 'clear' && input?.confirmClearKey !== true) {
        throw validationError('Clearing the API key requires confirmation.', [
          { path: 'confirmClearKey', message: 'Set confirmClearKey to true to remove the stored key.' },
        ])
      }
      if (keyAction === 'set' && !ctx.secrets.available()) {
        throw new AppError(
          'UNSUPPORTED',
          ctx.secrets.reason() ?? 'Operating-system secret encryption is unavailable.',
          { kind: 'unsupported', feature: 'safeStorage', reason: 'unavailable' },
        )
      }

      const at = nowIso()
      let providerId = requestedId
      const tx = ctx.db.transaction(() => {
        if (requestedId) {
          const existing = ctx.db.prepare('SELECT id FROM ai_providers WHERE id = ?').get(requestedId) as
            | { id: string }
            | undefined
          if (!existing) throw new AppError('NOT_FOUND', 'This AI provider no longer exists.')
          ctx.db
            .prepare('UPDATE ai_providers SET name = ?, base_url = ?, model = ?, updated_at = ? WHERE id = ?')
            .run(name, baseUrl, model, at, requestedId)
        } else {
          providerId = newId('aip')
          const countRow = ctx.db.prepare('SELECT COUNT(*) AS count FROM ai_providers').get() as {
            count: number
          }
          const makeDefault =
            input?.isDefault === true || (input?.isDefault === undefined && countRow.count === 0)
          ctx.db
            .prepare(
              'INSERT INTO ai_providers (id, name, base_url, model, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(providerId, name, baseUrl, model, makeDefault ? 1 : 0, at, at)
        }

        if (input?.isDefault === true) {
          ctx.db.prepare('UPDATE ai_providers SET is_default = 0').run()
          ctx.db.prepare('UPDATE ai_providers SET is_default = 1 WHERE id = ?').run(providerId)
        } else if (input?.isDefault === false) {
          ctx.db.prepare('UPDATE ai_providers SET is_default = 0 WHERE id = ?').run(providerId)
        }

        if (keyAction === 'set') {
          ctx.secrets.set('ai_key', providerId, 'api_key', apiKeyValue)
          ctx.db.prepare('UPDATE ai_providers SET key_updated_at = ? WHERE id = ?').run(at, providerId)
        } else if (keyAction === 'clear') {
          ctx.secrets.delete('ai_key', providerId, 'api_key')
          ctx.db.prepare('UPDATE ai_providers SET key_updated_at = NULL WHERE id = ?').run(providerId)
        }
      })
      tx()

      const saved = getProvider(providerId)
      ctx.events.domainChanged('ai', 'updated', [saved.id])
      return {
        id: saved.id,
        name: saved.name,
        baseUrl: saved.base_url,
        model: saved.model,
        hasKey: ctx.secrets.has('ai_key', saved.id, 'api_key'),
        ...(saved.key_updated_at ? { keyUpdatedAt: saved.key_updated_at } : {}),
        isDefault: !!saved.is_default,
      }
    },

    async test(input: AiTestInput): Promise<AiStreamHandle> {
      const providerId = requireText(input?.providerId, 'providerId', 100)
      const provider = getProvider(providerId)

      const disclosure = setting<unknown>(ctx, DISCLOSURE_SETTING_KEY, undefined)
      if (typeof disclosure !== 'string' || !disclosure) {
        if (input?.acknowledgeDataDisclosure !== true) {
          throw new AppError(
            'VALIDATION',
            'Acknowledge where prompt content is sent before running an AI test.',
            { kind: 'data-disclosure-required', providerId },
          )
        }
        setSetting(ctx, DISCLOSURE_SETTING_KEY, nowIso())
      }

      if (!ctx.secrets.available()) {
        throw new AppError(
          'UNSUPPORTED',
          ctx.secrets.reason() ?? 'Operating-system secret encryption is unavailable.',
          { kind: 'unsupported', feature: 'safeStorage', reason: 'unavailable' },
        )
      }
      const apiKey = ctx.secrets.get('ai_key', providerId, 'api_key')
      if (!apiKey) {
        throw validationError('This provider has no API key yet.', [
          { path: 'providerId', message: 'Add an API key in Settings before testing.' },
        ])
      }

      const values: Record<string, string> = {}
      if (input?.values && typeof input.values === 'object' && !Array.isArray(input.values)) {
        for (const [key, value] of Object.entries(input.values)) {
          if (typeof value === 'string') values[key] = value
        }
      }

      const systemPrompt = typeof input?.systemPrompt === 'string' ? input.systemPrompt : ''
      const userPrompt = typeof input?.userPrompt === 'string' ? input.userPrompt : ''
      if (!systemPrompt.trim() && !userPrompt.trim()) {
        throw validationError('Enter a prompt to test.', [
          { path: 'userPrompt', message: 'The system prompt and user prompt are both empty.' },
        ])
      }

      const renderedSystem = renderTemplate(systemPrompt, values)
      const renderedUser = renderTemplate(userPrompt, values)

      const model =
        typeof input.model === 'string' && input.model.trim()
          ? input.model.trim().slice(0, 200)
          : provider.model
      const promptId =
        typeof input.promptId === 'string' && input.promptId ? input.promptId : null
      const startedAt = nowIso()
      const startedMs = Date.now()
      const streamId = newId('ais')
      const controller = new AbortController()
      const entry: ActiveStream = {
        controller,
        startedMs,
        startedAt,
        providerId,
        model,
        promptId,
        userCancelled: false,
        timedOut: false,
      }
      activeStreams.set(streamId, entry)

      void runStream({
        streamId,
        entry,
        url: `${provider.base_url}/chat/completions`,
        apiKey,
        model,
        systemPrompt: renderedSystem.text,
        userPrompt: renderedUser.text,
      }).catch((error: unknown) => {
        ctx.logger.warn('ai', 'AI stream handler failed unexpectedly', {
          message: error instanceof Error ? redact(error.message).slice(0, 300) : 'unknown',
        })
      })

      return { streamId, startedAt }
    },

    async cancel(input: { streamId: string }): Promise<CancelResult> {
      const streamId = typeof input?.streamId === 'string' ? input.streamId : ''
      const entry = streamId ? activeStreams.get(streamId) : undefined
      if (!entry) return { cancelled: false }
      entry.userCancelled = true
      entry.controller.abort()
      return { cancelled: true }
    },

    async history(query: AiHistoryQuery): Promise<Page<AiTestRun>> {
      const limit = Math.min(Math.max(query?.limit ?? 50, 1), 200)
      const offset = Math.max(query?.offset ?? 0, 0)
      const where: string[] = []
      const params: unknown[] = []
      if (typeof query?.providerId === 'string' && query.providerId) {
        where.push('provider_id = ?')
        params.push(query.providerId)
      }
      const statuses: AiTestRun['status'][] = ['completed', 'cancelled', 'failed']
      if (query?.status && statuses.includes(query.status)) {
        where.push('status = ?')
        params.push(query.status)
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = (
        ctx.db.prepare(`SELECT COUNT(*) AS count FROM ai_runs ${clause}`).get(...params) as {
          count: number
        }
      ).count
      const rows = ctx.db
        .prepare(`SELECT * FROM ai_runs ${clause} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as AiRunRow[]
      return {
        items: rows.map((row) => ({
          id: row.id,
          providerId: row.provider_id,
          model: row.model,
          promptId: row.prompt_id,
          startedAt: row.started_at,
          durationMs: row.duration_ms,
          status: row.status,
          responsePreview: row.response_preview,
          ...(row.error_code ? { errorCode: row.error_code as AiTestRun['errorCode'] } : {}),
        })),
        total,
        limit,
        offset,
      }
    },
  }
}
