import type {
  AgentMcpState,
  HealthIssue,
  McpApplyTarget,
  McpDetail,
  McpFieldValue,
  McpSource,
  McpTransport,
} from '../../../shared/contracts'
import { repoFilePath, safePathSegment, slugify } from '../../../shared/domain/folders'
import type { ViewBadgeVariant } from './skill'

export const PLAINTEXT_AT_REST_NOTICE =
  'Applying writes real secret values into the target Agent configuration file. Those values stay on this machine but are stored in plaintext at rest in that file.'

export const STATIC_HEALTH_NOTICE =
  'Health checks validate configuration statically. Prompt Keeper never launches the server command and never contacts the remote URL.'

export const SECRET_STORAGE_NOTICE =
  'Credential-like env and header values are encrypted locally. Stored values are always shown as [REDACTED]; the renderer never receives them.'

export function mcpRepoPath(
  input: { title: string; slug?: string; folder?: string },
  mcpDir = 'mcp',
): string {
  const slug = input.slug?.trim() || slugify(input.title, 'server')
  return repoFilePath(mcpDir, input.folder ?? '', `${safePathSegment(slug, 'server')}.json`)
}

export function transportMeta(transport: McpTransport): {
  label: string
  variant: ViewBadgeVariant
} {
  return transport === 'stdio'
    ? { label: 'stdio', variant: 'secondary' }
    : { label: 'http', variant: 'info' }
}

export function mcpSourceMeta(source: McpSource): {
  label: string
  variant: ViewBadgeVariant
} {
  switch (source) {
    case 'market':
      return { label: 'From store', variant: 'primary' }
    case 'import':
      return { label: 'Imported', variant: 'warning' }
    default:
      return { label: 'Manual', variant: 'outline' }
  }
}

export function healthStatusMeta(status: 'ok' | 'warning' | 'error'): {
  label: string
  variant: ViewBadgeVariant
} {
  switch (status) {
    case 'error':
      return { label: 'Health error', variant: 'danger' }
    case 'warning':
      return { label: 'Health warning', variant: 'warning' }
    default:
      return { label: 'Health ok', variant: 'success' }
  }
}

export function healthIssueCounts(issues: HealthIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
  }
}

/** A redacted field shows the placeholder; every other field renders its plain value. */
export function fieldDisplayValue(field: McpFieldValue): string {
  if (field.redacted) return '[REDACTED]'
  return field.value
}

function fieldMap(values: Record<string, McpFieldValue>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(values)) out[key] = fieldDisplayValue(field)
  return out
}

/** Redacted configuration preview used by the detail pane and the apply wizard. */
export function mcpConfigPreview(server: McpDetail): string {
  const payload: Record<string, unknown> = {
    title: server.title,
    description: server.description,
    folder: server.folder,
    transport: server.transport,
    ...(server.transport === 'stdio'
      ? { command: server.command ?? '', args: server.args }
      : { url: server.url ?? '' }),
    env: fieldMap(server.env),
    ...(Object.keys(server.headers).length ? { headers: fieldMap(server.headers) } : {}),
    requiredEnv: server.requiredEnv,
    enabled: server.enabled,
  }
  return JSON.stringify(payload, null, 2)
}

export function mcpApplyEntryPreview(entry: Record<string, unknown>): string {
  return JSON.stringify(entry, null, 2)
}

export function applyActionMeta(action: 'create' | 'update' | 'noop'): {
  label: string
  variant: ViewBadgeVariant
} {
  switch (action) {
    case 'create':
      return { label: 'Create', variant: 'success' }
    case 'update':
      return { label: 'Update', variant: 'warning' }
    default:
      return { label: 'No change', variant: 'outline' }
  }
}

export function agentServerMeta(
  servers: AgentMcpState['servers'],
  serverName: string,
): AgentMcpState['servers'][number] | undefined {
  return servers.find((entry) => entry.name === serverName)
}

export function serverMatchNames(server: McpDetail): string[] {
  return [server.slug, server.title].filter((value, index, all) => !!value && all.indexOf(value) === index)
}

export function agentFormatLabel(format: AgentMcpState['format']): string {
  switch (format) {
    case 'jsonc':
      return 'JSONC'
    case 'toml':
      return 'TOML'
    default:
      return 'JSON'
  }
}

export function targetHasDrift(target: McpApplyTarget): boolean {
  return target.entries.some((entry) => entry.drift)
}
