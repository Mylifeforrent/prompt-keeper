import { describe, expect, it } from 'vitest'
import { hasBlockingFindings, scanFiles, scanText } from '../../src/shared/domain/scanner'

describe('credential scanner', () => {
  it('detects high-confidence patterns with masked previews', () => {
    const fake = 'sk-test_1234567890abcdefghijklmnop'
    const findings = scanText(`token: ${fake}`, { path: 'prompts/a.md' })
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('openai-key')
    expect(findings[0].confidence).toBe('high')
    expect(findings[0].preview).not.toBe(fake)
    expect(findings[0].preview).toContain('***')
    expect(findings[0].line).toBe(1)
    expect(hasBlockingFindings(findings)).toBe(true)
  })

  it('does not report placeholders as secrets', () => {
    expect(scanText('token: {{api_key}}')).toHaveLength(0)
    expect(scanText('token: ${GITHUB_TOKEN}')).toHaveLength(0)
  })

  it('scans multiple files with the requested replacement', () => {
    const findings = scanFiles(
      [
        { path: 'a.contract.md', content: 'aws AKIAABCDEFGHIJKLMNOP' },
        { path: 'b.json', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' },
      ],
      '${VAR}',
    )
    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.replacement === '${VAR}')).toBe(true)
    expect(new Set(findings.map((finding) => finding.path))).toEqual(
      new Set(['a.contract.md', 'b.json']),
    )
  })

  it('never returns the full secret value', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const findings = scanText(secret)
    for (const finding of findings) expect(finding.preview).not.toContain(secret)
  })
})
