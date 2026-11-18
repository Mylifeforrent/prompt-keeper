import type { HealthIssue, McpServer, McpTarget } from '../types'
import { repoFilePath, safePathSegment } from './folders'

const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD)/i
const PLACEHOLDER_RE = /<[^>]+>|xxx+|\.\.\.|your[-_]/i

/** 凭据字段脱敏：KEY/TOKEN/SECRET/PASSWORD 类值一律不回显 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

export function redactServerConfig(server: McpServer): Record<string, unknown> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(server.env ?? {})) env[k] = isSecretKey(k) ? '[REDACTED]' : v
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(server.headers ?? {})) headers[k] = isSecretKey(k) || k.toLowerCase() === 'authorization' ? '[REDACTED]' : v
  return {
    transport: server.transport,
    ...(server.transport === 'stdio'
      ? { command: server.command, args: server.args }
      : { url: server.url, headers }),
    env,
  }
}

export function serverConfigJson(server: McpServer): string {
  return JSON.stringify(redactServerConfig(server), null, 2)
}

/** 每个 MCP server 一个 JSON 文件：mcp/<folder>/<name>.json */
export function mcpFilePath(
  server: Pick<McpServer, 'id' | 'name'> & { folder?: string | null },
  mcpDir = 'mcp',
): string {
  return repoFilePath(mcpDir, server.folder, `${safePathSegment(server.name, server.id)}.json`)
}

/**
 * 写入仓库的 MCP 模板：凭据只保留 ${VAR} 占位，
 * 真实值只存在本机库 / 钥匙串，不进入 Git 历史。
 */
export function serializeMcpRepoFile(server: McpServer): string {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.env ?? {})) {
    env[key] = isSecretKey(key) ? `\${${key}}` : value
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    const secret = isSecretKey(key) || key.toLowerCase() === 'authorization'
    headers[key] = secret ? `\${${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}}` : value
  }
  return JSON.stringify(
    {
      name: server.name,
      description: server.description,
      transport: server.transport,
      ...(server.transport === 'stdio'
        ? { command: server.command, args: server.args ?? [] }
        : { url: server.url, headers }),
      env,
      ...(server.requiredEnv?.length ? { requiredEnv: server.requiredEnv } : {}),
    },
    null,
    2,
  )
}

export function parseMcpRepoFile(text: string): Partial<McpServer> | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const name = typeof parsed.name === 'string' ? parsed.name : ''
    if (!name) return null
    return {
      name,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      transport: parsed.transport === 'http' ? 'http' : 'stdio',
      command: typeof parsed.command === 'string' ? parsed.command : undefined,
      args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      env: parsed.env && typeof parsed.env === 'object' ? (parsed.env as Record<string, string>) : {},
      headers:
        parsed.headers && typeof parsed.headers === 'object'
          ? (parsed.headers as Record<string, string>)
          : {},
      requiredEnv: Array.isArray(parsed.requiredEnv) ? parsed.requiredEnv.map(String) : [],
    }
  } catch {
    return null
  }
}

/** 健康检查（原型为静态规则，真实产品检查 PATH / 网络） */
export function checkHealth(server: McpServer): HealthIssue[] {
  const issues: HealthIssue[] = []
  if (server.transport === 'stdio') {
    if (!server.command || !server.command.trim()) {
      issues.push({ level: 'error', field: 'command', message: '未配置启动命令，分发后 Agent 将无法拉起该服务' })
    }
  } else {
    if (!server.url || !/^https?:\/\/.+/.test(server.url)) {
      issues.push({ level: 'error', field: 'url', message: 'URL 缺失或不是合法的 http(s) 地址' })
    }
  }
  for (const key of server.requiredEnv ?? []) {
    const v = server.env?.[key]
    if (v === undefined || v.trim() === '') {
      issues.push({ level: 'error', field: `env.${key}`, message: `缺少必需环境变量 ${key}，服务启动后会因鉴权失败而不可用` })
    } else if (PLACEHOLDER_RE.test(v)) {
      issues.push({ level: 'warning', field: `env.${key}`, message: `${key} 看起来还是占位值，请替换为真实凭据` })
    }
  }
  for (const [k, v] of Object.entries(server.env ?? {})) {
    if (isSecretKey(k) && v && PLACEHOLDER_RE.test(v) && !(server.requiredEnv ?? []).includes(k)) {
      issues.push({ level: 'warning', field: `env.${k}`, message: `${k} 看起来是占位值` })
    }
  }
  return issues
}

export function healthBadge(issues: HealthIssue[]): 'ok' | 'warning' | 'error' {
  if (issues.some((i) => i.level === 'error')) return 'error'
  if (issues.some((i) => i.level === 'warning')) return 'warning'
  return 'ok'
}

/** 生成写入目标平台文件的投影配置（原型直接生成 JSON/TOML 文本） */
export function projectForTarget(servers: McpServer[], target: McpTarget): string {
  if (target.format === 'json') {
    const body: Record<string, unknown> = {}
    for (const s of servers) {
      body[s.name] = s.transport === 'stdio' ? { command: s.command, args: s.args, env: envForJson(s) } : { url: s.url }
    }
    return JSON.stringify({ mcpServers: body }, null, 2)
  }
  let out = ''
  for (const s of servers) {
    out += `[mcp_servers.${s.name}]\n`
    out += `command = "${s.command ?? ''}"\n`
    if (s.args?.length) out += `args = [${s.args.map((a) => `"${a}"`).join(', ')}]\n`
    for (const [k, v] of Object.entries(s.env ?? {})) out += `env_vars = { ${k} = "${isSecretKey(k) ? '***' : v}" }\n`
    out += '\n'
  }
  return out
}

function envForJson(s: McpServer): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(s.env ?? {})) env[k] = isSecretKey(k) ? '***' : v
  return env
}
