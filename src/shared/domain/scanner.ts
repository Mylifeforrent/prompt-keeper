import type { ScanFinding } from '../contracts'

interface ScanRule {
  id: string
  pattern: RegExp
  confidence: 'high' | 'medium'
  label: string
}

const RULES: ScanRule[] = [
  { id: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high', label: 'OpenAI-style API key' },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high', label: 'Anthropic API key' },
  { id: 'github-pat', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, confidence: 'high', label: 'GitHub personal access token' },
  { id: 'github-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, confidence: 'high', label: 'GitHub fine-grained token' },
  { id: 'gitlab-pat', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high', label: 'GitLab personal access token' },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 'high', label: 'AWS access key' },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 'high', label: 'Slack token' },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 'high', label: 'Google API key' },
  { id: 'stripe-key', pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/g, confidence: 'high', label: 'Stripe live secret key' },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    confidence: 'high',
    label: 'Private key block',
  },
  {
    id: 'bearer-header',
    pattern: /\bAuthorization\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    confidence: 'high',
    label: 'Bearer token in an authorization header',
  },
]

const ENTROPY_CANDIDATE = /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{32,})["']?/gi

function shannonEntropy(value: string): number {
  const frequencies = new Map<string, number>()
  for (const char of value) frequencies.set(char, (frequencies.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of frequencies.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** Masked preview only; the full match never leaves this module. */
function maskedPreview(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-2)}`
}

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

export interface ScanOptions {
  path?: string
  replacement?: '{{variable}}' | '${VAR}'
  includeMedium?: boolean
}

export function scanText(text: string, options: ScanOptions = {}): ScanFinding[] {
  const findings: ScanFinding[] = []
  const replacement = options.replacement ?? '{{variable}}'
  const seen = new Set<string>()

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const value = match[0]
      const key = `${rule.id}:${match.index}`
      if (seen.has(key)) continue
      seen.add(key)
      const location = locationOf(text, match.index)
      findings.push({
        ruleId: rule.id,
        confidence: rule.confidence,
        path: options.path,
        line: location.line,
        column: location.column,
        preview: maskedPreview(value),
        replacement,
      })
    }
  }

  if (options.includeMedium) {
    const pattern = new RegExp(ENTROPY_CANDIDATE.source, 'gi')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const candidate = match[1]
      if (shannonEntropy(candidate) < 4.2) continue
      const key = `high-entropy:${match.index}`
      if (seen.has(key)) continue
      seen.add(key)
      const location = locationOf(text, match.index)
      findings.push({
        ruleId: 'high-entropy-secret',
        confidence: 'medium',
        path: options.path,
        line: location.line,
        column: location.column,
        preview: maskedPreview(candidate),
        replacement,
      })
    }
  }

  return findings.sort(
    (a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
  )
}

export function hasBlockingFindings(findings: ScanFinding[]): boolean {
  return findings.some((finding) => finding.confidence === 'high')
}

export function scanFiles(
  files: Array<{ path: string; content: string }>,
  replacement: '{{variable}}' | '${VAR}',
): ScanFinding[] {
  return files.flatMap((file) => scanText(file.content, { path: file.path, replacement }))
}

export const SCANNER_RULE_IDS = RULES.map((rule) => rule.id)
