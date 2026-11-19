import type { HealthIssue, McpFieldValue, McpFileModel, McpFileFieldValue, McpTransport } from '../contracts'
import { normalizeFolder, repoFilePath, safePathSegment } from './folders'

const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i
const PLACEHOLDER_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value)
}

export function placeholderName(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
}

export function mcpSlug(model: Pick<McpFileModel, 'id' | 'title'>): string {
  const slug = model.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || model.id
}

export function mcpRepoPath(
  model: Pick<McpFileModel, 'id' | 'title' | 'folder'>,
  mcpDir = 'mcp',
): string {
  return repoFilePath(mcpDir, model.folder, `${safePathSegment(mcpSlug(model), model.id)}.json`)
}

/** Repository MCP files contain only `${VAR}` placeholders for credential-like fields. */
export function serializeMcpFile(model: McpFileModel): string {
  const env: Record<string, string> = {}
  for (const [key, field] of Object.entries(model.env)) {
    env[key] = field.secret ? (isPlaceholder(field.value) ? field.value : `\${${placeholderName(key)}}`) : field.value
  }
  const headers: Record<string, string> = {}
  for (const [key, field] of Object.entries(model.headers)) {
    headers[key] = field.secret
      ? isPlaceholder(field.value)
        ? field.value
        : `\${${placeholderName(key)}}`
      : field.value
  }

  const payload: Record<string, unknown> = {
    id: model.id,
    title: model.title,
    description: model.description,
    folder: normalizeFolder(model.folder),
    tags: model.tags,
    transport: model.transport,
    ...(model.transport === 'stdio'
      ? { command: model.command ?? '', args: model.args }
      : { url: model.url ?? '' }),
    ...(Object.keys(env).length ? { env } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(model.requiredEnv.length ? { requiredEnv: model.requiredEnv } : {}),
    enabled: model.enabled,
    ...(model.notes ? { notes: model.notes } : {}),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export interface ParsedMcpFile {
  model: McpFileModel | null
  error?: string
}

function readFieldMap(value: unknown): Record<string, McpFileFieldValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, McpFileFieldValue> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    const secret = isPlaceholder(raw) || isSecretKey(key)
    out[key] = { value: raw, secret }
  }
  return out
}

export function parseMcpFile(text: string, sourcePath?: string): ParsedMcpFile {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { model: null, error: 'MCP file must be a JSON object.' }
    }
    payload = parsed as Record<string, unknown>
  } catch (error) {
    return { model: null, error: `Invalid JSON: ${(error as Error).message}` }
  }

  const transportRaw = payload.transport
  const transport: McpTransport = transportRaw === 'http' ? 'http' : 'stdio'
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!title) return { model: null, error: 'MCP file is missing a title.' }
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''

  return {
    model: {
      id,
      title,
      description: typeof payload.description === 'string' ? payload.description : '',
      folder: normalizeFolder(
        typeof payload.folder === 'string' ? payload.folder : folderFromMcpPath(sourcePath),
      ),
      tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [],
      transport,
      command: typeof payload.command === 'string' ? payload.command : undefined,
      args: Array.isArray(payload.args) ? payload.args.filter((a): a is string => typeof a === 'string') : [],
      url: typeof payload.url === 'string' ? payload.url : undefined,
      env: readFieldMap(payload.env),
      headers: readFieldMap(payload.headers),
      requiredEnv: Array.isArray(payload.requiredEnv)
        ? payload.requiredEnv.filter((e): e is string => typeof e === 'string')
        : [],
      enabled: payload.enabled !== false,
      notes: typeof payload.notes === 'string' ? payload.notes : '',
    },
  }
}

export function folderFromMcpPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length >= 3) return normalizeFolder(parts.slice(1, -1).join('/'))
  return ''
}

/** Static-only health checks: never spawns the command or opens the URL. */
export function checkMcpHealth(model: {
  transport: McpTransport
  command?: string
  url?: string
  env: Record<string, McpFieldValue>
  headers: Record<string, McpFieldValue>
  requiredEnv: string[]
}): HealthIssue[] {
  const issues: HealthIssue[] = []
  if (model.transport === 'stdio') {
    if (!model.command?.trim()) {
      issues.push({ level: 'error', field: 'command', message: 'A stdio server needs a command to start.' })
    }
    if (model.command && /\s/.test(model.command.trim()) && !model.command.startsWith('"')) {
      issues.push({
        level: 'warning',
        field: 'command',
        message: 'The command contains spaces. Split arguments into the args list instead.',
      })
    }
  } else {
    const url = model.url?.trim() ?? ''
    if (!url) {
      issues.push({ level: 'error', field: 'url', message: 'An HTTP server needs a URL.' })
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          issues.push({ level: 'error', field: 'url', message: 'The URL must use http or https.' })
        } else if (parsed.protocol === 'http:') {
          issues.push({ level: 'warning', field: 'url', message: 'The URL is not HTTPS; credentials may travel in plaintext.' })
        }
      } catch {
        issues.push({ level: 'error', field: 'url', message: 'The URL is not valid.' })
      }
    }
  }

  for (const key of model.requiredEnv) {
    const field = model.env[key]
    if (!field || (!field.hasValue && !field.redacted && !field.value)) {
      issues.push({
        level: 'error',
        field: `env.${key}`,
        message: `Required environment variable ${key} has no value.`,
      })
    }
  }

  for (const [key, field] of Object.entries(model.env)) {
    if (field.value && !field.redacted && !field.hasValue) {
      issues.push({ level: 'warning', field: `env.${key}`, message: 'The value is empty.' })
    }
  }
  for (const key of Object.keys(model.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) {
      issues.push({ level: 'error', field: `headers.${key}`, message: 'The header name is not valid.' })
    }
  }
  return issues
}

export function healthStatus(issues: HealthIssue[]): 'ok' | 'warning' | 'error' {
  if (issues.some((issue) => issue.level === 'error')) return 'error'
  if (issues.length) return 'warning'
  return 'ok'
}

/** Redacted view for logs, audit, errors, and previews. */
export function redactMcpFields(
  env: Record<string, McpFileFieldValue>,
  headers: Record<string, McpFileFieldValue>,
): { env: Record<string, string>; headers: Record<string, string> } {
  const redact = (source: Record<string, McpFileFieldValue>) =>
    Object.fromEntries(
      Object.entries(source).map(([key, field]) => [
        key,
        field.secret || isSecretKey(key) ? (field.value ? '[REDACTED]' : '') : field.value,
      ]),
    )
  return { env: redact(env), headers: redact(headers) }
}
