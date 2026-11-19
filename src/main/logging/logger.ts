import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REDACTION_RULES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
]

export function redact(value: string): string {
  let out = value
  for (const rule of REDACTION_RULES) out = out.replace(rule, '[REDACTED]')
  return out
}

export interface LogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  component: string
  message: string
  detail?: Record<string, unknown>
}

export class Logger {
  private file: string

  constructor(private readonly logDir: string) {
    mkdirSync(logDir, { recursive: true })
    this.file = join(logDir, `main-${new Date().toISOString().slice(0, 10)}.log`)
  }

  private write(level: LogEntry['level'], component: string, message: string, detail?: Record<string, unknown>) {
    const entry: LogEntry = {
      at: new Date().toISOString(),
      level,
      component,
      message: redact(message),
      ...(detail ? { detail: JSON.parse(redact(JSON.stringify(detail))) as Record<string, unknown> } : {}),
    }
    try {
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Logging must never fail the operation.
    }
    if (level === 'error') console.error(`[${component}] ${entry.message}`)
    else if (level === 'warn') console.warn(`[${component}] ${entry.message}`)
    else console.log(`[${component}] ${entry.message}`)
  }

  info(component: string, message: string, detail?: Record<string, unknown>): void {
    this.write('info', component, message, detail)
  }

  warn(component: string, message: string, detail?: Record<string, unknown>): void {
    this.write('warn', component, message, detail)
  }

  error(component: string, message: string, detail?: Record<string, unknown>): void {
    this.write('error', component, message, detail)
  }

  recent(maxBytes = 200_000): string {
    try {
      const files = readdirSync(this.logDir)
        .filter((name) => name.endsWith('.log'))
        .sort()
        .slice(-3)
      return files
        .map((name) => readFileSync(join(this.logDir, name), 'utf8'))
        .join('\n')
        .slice(-maxBytes)
    } catch {
      return ''
    }
  }
}
