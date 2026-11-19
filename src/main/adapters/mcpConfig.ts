import { readFile } from 'node:fs/promises'
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { AppError } from '../../shared/domain/errors'
import { pathExists } from './fs'

/**
 * Read and merge helpers for Agent MCP configuration files.
 *
 * The adapter edits only the managed server entry, preserves unrelated keys, and
 * keeps comments for JSONC. TOML uses a line-based section editor because
 * `[mcp_servers.<name>]` sections must be replaced without reformatting the file.
 * It never spawns a configured command or opens a URL.
 */

export type McpConfigFormat = 'json' | 'jsonc' | 'toml'
export type McpConfigRootKey = 'mcpServers' | 'servers' | 'mcp' | 'mcp_servers'

export type McpMergeAction = 'create' | 'update' | 'noop'

export interface McpConfigReadResult {
  format: McpConfigFormat
  data: Record<string, unknown>
  servers: Record<string, unknown>
  rootKey: McpConfigRootKey
  warnings: string[]
}

export interface McpConfigMergeEntry {
  name: string
  config: Record<string, unknown>
}

export interface McpConfigMergeResult {
  text: string
  changed: boolean
  warnings: string[]
  actions: Record<string, McpMergeAction>
}

export interface McpConfigRemoveResult {
  text: string
  changed: boolean
  warnings: string[]
}

export interface McpConfigOptions {
  /** Force the root object key; needed when creating a config file for an Agent. */
  rootKey?: McpConfigRootKey
}

const JSON_ROOTS: McpConfigRootKey[] = ['mcpServers', 'servers', 'mcp']
const TOML_ROOT: McpConfigRootKey = 'mcp_servers'
const TOML_HEADER_RE = /^\s*\[\[?\s*([^\]]*?)\s*\]\]?\s*(?:#.*)?$/
const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function hasJsoncSyntax(text: string): boolean {
  return text.includes('//') || text.includes('/*') || /,\s*[}\]]/.test(text)
}

/** Format from the extension first, then a bounded content sniff. */
export function detectConfigFormat(path: string, text?: string): McpConfigFormat {
  const lower = path.toLowerCase()
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.jsonc')) return 'jsonc'
  if (lower.endsWith('.json')) {
    if (!text || !text.trim()) return 'json'
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      return hasJsoncSyntax(text) ? 'jsonc' : 'json'
    }
  }
  if (!text || !text.trim()) return 'json'
  try {
    JSON.parse(text)
    return 'json'
  } catch {
    // Fall through to TOML/JSONC detection.
  }
  if (/^\s*\[/.test(text) || /^\s*[A-Za-z0-9_"'-]+\s*=/m.test(text)) {
    try {
      parseToml(text)
      return 'toml'
    } catch {
      // Not TOML.
    }
  }
  return 'jsonc'
}

function parseStrictJson(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    // Never echo parser context: configuration files can contain secret values.
    throw new AppError('CORRUPT', 'The JSON configuration is not valid. Fix the syntax and retry.')
  }
  if (!isPlainObject(parsed)) {
    throw new AppError('CORRUPT', 'The configuration root must be a JSON object.')
  }
  return parsed
}

function parseJsoncText(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const errors: ParseError[] = []
  const parsed = parseJsonc(text, errors) as unknown
  if (errors.length) {
    throw new AppError(
      'CORRUPT',
      `The JSONC configuration is not valid: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`,
    )
  }
  if (!isPlainObject(parsed)) {
    throw new AppError('CORRUPT', 'The configuration root must be a JSON object.')
  }
  return parsed
}

function parseTomlObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = parseToml(text) as unknown
  } catch (error) {
    const known = error as { line?: unknown; column?: unknown }
    const location =
      typeof known.line === 'number'
        ? ` at line ${known.line}${typeof known.column === 'number' ? `, column ${known.column}` : ''}`
        : ''
    // Never echo the TOML error code block: it can contain secret values.
    throw new AppError('CORRUPT', `The TOML configuration is not valid${location}. Fix the syntax and retry.`)
  }
  if (!isPlainObject(parsed)) {
    throw new AppError('CORRUPT', 'The configuration root must be a TOML table.')
  }
  return parsed
}

function pickJsonRoot(data: Record<string, unknown>, override?: McpConfigRootKey): McpConfigRootKey {
  if (override && data[override] !== undefined) return override
  for (const key of JSON_ROOTS) {
    if (isPlainObject(data[key])) return key
  }
  return override ?? 'mcpServers'
}

function readRoot(
  data: Record<string, unknown>,
  rootKey: McpConfigRootKey,
): { servers: Record<string, unknown>; warnings: string[] } {
  const raw = data[rootKey]
  if (raw === undefined) return { servers: {}, warnings: [] }
  if (!isPlainObject(raw)) {
    throw new AppError(
      'UNSUPPORTED',
      `The "${rootKey}" key must be a table of server entries; this configuration uses an unsupported structure.`,
      { kind: 'unsupported', feature: 'mcp-config-root', reason: `The "${rootKey}" key is not an object.` },
    )
  }
  return { servers: raw, warnings: [] }
}

export function readConfigText(
  text: string,
  format: McpConfigFormat,
  options: McpConfigOptions = {},
): McpConfigReadResult {
  const clean = stripBom(text)
  if (format === 'toml') {
    const data = parseTomlObject(clean)
    const root = readRoot(data, TOML_ROOT)
    return { format, data, servers: root.servers, rootKey: TOML_ROOT, warnings: root.warnings }
  }
  const data = format === 'json' ? parseStrictJson(clean) : parseJsoncText(clean)
  const rootKey = pickJsonRoot(data, options.rootKey)
  const root = readRoot(data, rootKey)
  return { format, data, servers: root.servers, rootKey, warnings: root.warnings }
}

/** Read a configuration file. Returns null when the file does not exist. */
export async function readConfig(
  path: string,
  hint?: McpConfigFormat,
  options: McpConfigOptions = {},
): Promise<McpConfigReadResult | null> {
  if (!(await pathExists(path))) return null
  const text = await readFile(path, 'utf8')
  const lower = path.toLowerCase()
  const hasKnownExtension =
    lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.toml')
  // Extension and content win for known extensions so a `.json` file with
  // comments is parsed and edited as JSONC without losing those comments.
  const format = hasKnownExtension ? detectConfigFormat(path, text) : hint ?? detectConfigFormat(path, text)
  return readConfigText(text, format, options)
}

/** Stable JSON used for hashing and equality checks. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return 'null'
}

function serializeSection(name: string, config: Record<string, unknown>): string {
  const lines = [`[mcp_servers.${tomlKey(name)}]`]
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue
    lines.push(`${tomlKey(key)} = ${tomlValue(value, 0)}`)
  }
  return lines.join('\n')
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)
}

function tomlValue(value: unknown, depth: number): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => tomlValue(item, depth + 1)).join(', ')}]`
  }
  if (isPlainObject(value)) {
    if (depth >= 2) {
      throw new AppError(
        'UNSUPPORTED',
        'The configuration has a nested structure that the TOML section editor cannot represent.',
        {
          kind: 'unsupported',
          feature: 'mcp-config-toml',
          reason: 'Nested tables deeper than two levels are not supported.',
        },
      )
    }
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => `${tomlKey(key)} = ${tomlValue(entryValue, depth + 1)}`)
    return entries.length ? `{ ${entries.join(', ')} }` : '{}'
  }
  throw new AppError('UNSUPPORTED', 'The configuration contains a value that TOML cannot represent.', {
    kind: 'unsupported',
    feature: 'mcp-config-toml',
    reason: 'Null values are not supported by the TOML section editor.',
  })
}

function splitDotted(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        current += char + (value[index + 1] ?? '')
        index++
        continue
      }
      if (char === quote) {
        quote = null
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '.') {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current.trim())
  return parts
}

function headerParts(line: string): string[] | null {
  const match = line.match(TOML_HEADER_RE)
  return match ? splitDotted(match[1]) : null
}

function isArrayHeader(line: string): boolean {
  return /^\s*\[\[/.test(line)
}

function findTomlSection(
  lines: string[],
  name: string,
): { start: number; end: number; nested: boolean } | null {
  for (let index = 0; index < lines.length; index++) {
    const parts = headerParts(lines[index])
    if (!parts || parts.length !== 2 || parts[0] !== TOML_ROOT || parts[1] !== name) continue
    let end = lines.length
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      if (headerParts(lines[cursor])) {
        end = cursor
        break
      }
    }
    // Any `[mcp_servers.<name>.*]` sub-table or `[[mcp_servers.<name>]]` array
    // belongs to this server, so refuse before a line-based edit destroys it.
    let nested = isArrayHeader(lines[index])
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const nestedParts = headerParts(lines[cursor])
      if (!nestedParts) continue
      if (
        nestedParts[0] !== TOML_ROOT ||
        nestedParts[1] !== name
      ) {
        continue
      }
      if (isArrayHeader(lines[cursor]) || nestedParts.length > 2) {
        nested = true
        break
      }
    }
    return { start: index, end, nested }
  }
  return null
}

function assertNoInlineTomlRoot(lines: string[]): void {
  for (const line of lines) {
    if (/^\s*\[/.test(line)) continue
    if (/^\s*mcp_servers\s*=/.test(line) || /^\s*mcp_servers\s*\./.test(line)) {
      throw new AppError(
        'UNSUPPORTED',
        'This TOML file defines MCP servers as inline or dotted keys. Edit the file manually or switch it to table sections.',
        {
          kind: 'unsupported',
          feature: 'mcp-config-toml',
          reason: 'The mcp_servers table is declared outside a section header.',
        },
      )
    }
  }
}

function removeTomlSection(text: string, name: string): McpConfigRemoveResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  assertNoInlineTomlRoot(lines)
  const section = findTomlSection(lines, name)
  if (!section) return { text, changed: false, warnings: [] }
  if (section.nested) {
    throw new AppError(
      'UNSUPPORTED',
      `The "[mcp_servers.${name}]" section contains nested tables; remove it manually.`,
      {
        kind: 'unsupported',
        feature: 'mcp-config-toml',
        reason: 'Nested TOML sub-tables are not edited by the app.',
      },
    )
  }
  lines.splice(section.start, section.end - section.start)
  const next = lines.join(eol)
  parseTomlObject(next)
  return { text: next, changed: true, warnings: [] }
}

function mergeToml(text: string, entries: McpConfigMergeEntry[]): McpConfigMergeResult {
  const initial = parseTomlObject(text)
  const existingRoot = initial[TOML_ROOT]
  if (existingRoot !== undefined && !isPlainObject(existingRoot)) {
    throw new AppError('UNSUPPORTED', 'The "mcp_servers" key must be a table of server entries.', {
      kind: 'unsupported',
      feature: 'mcp-config-toml',
      reason: 'The mcp_servers key is not a table.',
    })
  }
  const existingServers = isPlainObject(existingRoot) ? existingRoot : {}
  const actions: Record<string, McpMergeAction> = {}
  const warnings: string[] = []
  let currentText = text
  for (const entry of entries) {
    const existing = existingServers[entry.name]
    actions[entry.name] =
      existing === undefined
        ? 'create'
        : stableStringify(existing) === stableStringify(entry.config)
          ? 'noop'
          : 'update'
    if (actions[entry.name] === 'noop') continue

    const removed = removeTomlSection(currentText, entry.name)
    currentText = removed.text
    const eol = currentText.includes('\r\n') ? '\r\n' : '\n'
    const section = serializeSection(entry.name, entry.config)
    const trimmed = currentText.replace(/\s+$/, '')
    currentText = trimmed
      ? `${trimmed}${eol}${eol}${section.split('\n').join(eol)}${eol}`
      : `${section.split('\n').join(eol)}${eol}`
  }
  const changed = Object.values(actions).some((action) => action !== 'noop')
  if (changed) {
    const validated = parseTomlObject(currentText)
    const root = validated[TOML_ROOT]
    for (const entry of entries) {
      if (actions[entry.name] === 'noop') continue
      const written = isPlainObject(root) ? root[entry.name] : undefined
      if (written === undefined) {
        throw new AppError('INTERNAL', 'The TOML edit did not produce the expected server section.')
      }
    }
  }
  return { text: currentText, changed, warnings, actions }
}

function mergeJson(
  text: string,
  format: 'json' | 'jsonc',
  entries: McpConfigMergeEntry[],
  options: McpConfigOptions,
): McpConfigMergeResult {
  const warnings: string[] = []
  const actions: Record<string, McpMergeAction> = {}
  if (format === 'json') {
    const data = parseStrictJson(text)
    const rootKey = pickJsonRoot(data, options.rootKey)
    const rawRoot = data[rootKey]
    if (rawRoot !== undefined && !isPlainObject(rawRoot)) {
      throw new AppError('UNSUPPORTED', `The "${rootKey}" key must be a table of server entries.`, {
        kind: 'unsupported',
        feature: 'mcp-config-json',
        reason: `The "${rootKey}" key is not an object.`,
      })
    }
    const servers: Record<string, unknown> = isPlainObject(rawRoot) ? rawRoot : {}
    for (const entry of entries) {
      const existing = servers[entry.name]
      actions[entry.name] =
        existing === undefined
          ? 'create'
          : stableStringify(existing) === stableStringify(entry.config)
            ? 'noop'
            : 'update'
      servers[entry.name] = entry.config
    }
    data[rootKey] = servers
    const changed = Object.values(actions).some((action) => action !== 'noop')
    const nextText = changed ? `${JSON.stringify(data, null, 2)}\n` : text
    return { text: nextText, changed, warnings, actions }
  }

  const initial = parseJsoncText(text)
  const rootKey = pickJsonRoot(initial, options.rootKey)
  const rawRoot = initial[rootKey]
  if (rawRoot !== undefined && !isPlainObject(rawRoot)) {
    throw new AppError('UNSUPPORTED', `The "${rootKey}" key must be a table of server entries.`, {
      kind: 'unsupported',
      feature: 'mcp-config-jsonc',
      reason: `The "${rootKey}" key is not an object.`,
    })
  }
  const servers: Record<string, unknown> = isPlainObject(rawRoot) ? rawRoot : {}
  let currentText = text.trim() ? text : '{}\n'
  for (const entry of entries) {
    const existing = servers[entry.name]
    actions[entry.name] =
      existing === undefined
        ? 'create'
        : stableStringify(existing) === stableStringify(entry.config)
          ? 'noop'
          : 'update'
    if (actions[entry.name] === 'noop') continue
    const edits = modify(currentText, [rootKey, entry.name], entry.config, {
      formattingOptions: FORMATTING,
    })
    currentText = applyEdits(currentText, edits)
  }
  const changed = Object.values(actions).some((action) => action !== 'noop')
  return { text: changed ? currentText : text, changed, warnings, actions }
}

/** Compute the merged text without writing it. Used by the preview phase. */
export function previewApply(
  existingText: string | null,
  format: McpConfigFormat,
  entries: McpConfigMergeEntry[],
  options: McpConfigOptions = {},
): McpConfigMergeResult {
  return writeMerge(existingText, format, entries, options)
}

/** Produce the merged text for an atomic write. Edits only named entries. */
export function writeMerge(
  existingText: string | null,
  format: McpConfigFormat,
  entries: McpConfigMergeEntry[],
  options: McpConfigOptions = {},
): McpConfigMergeResult {
  const text = stripBom(existingText ?? '')
  if (format === 'toml') return mergeToml(text, entries)
  return mergeJson(text, format, entries, options)
}

/** Remove only the named entry. Returns the unchanged text when it is absent. */
export function removeEntry(
  existingText: string | null,
  format: McpConfigFormat,
  name: string,
  options: McpConfigOptions = {},
): McpConfigRemoveResult {
  const text = stripBom(existingText ?? '')
  if (format === 'toml') return removeTomlSection(text, name)

  if (format === 'json') {
    const data = parseStrictJson(text)
    const rootKey = pickJsonRoot(data, options.rootKey)
    const rawRoot = data[rootKey]
    if (!isPlainObject(rawRoot) || !(name in rawRoot)) {
      return { text, changed: false, warnings: [] }
    }
    delete rawRoot[name]
    return { text: `${JSON.stringify(data, null, 2)}\n`, changed: true, warnings: [] }
  }

  const data = parseJsoncText(text)
  const rootKey = pickJsonRoot(data, options.rootKey)
  const rawRoot = data[rootKey]
  if (!isPlainObject(rawRoot) || !(name in rawRoot)) {
    return { text, changed: false, warnings: [] }
  }
  const edits = modify(text, [rootKey, name], undefined, { formattingOptions: FORMATTING })
  return { text: applyEdits(text, edits), changed: true, warnings: [] }
}
