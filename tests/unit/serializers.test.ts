import { describe, expect, it } from 'vitest'
import {
  parseContractFile,
  serializeContractFile,
} from '../../src/shared/domain/contractFile'
import {
  parseMcpFile,
  serializeMcpFile,
  checkMcpHealth,
} from '../../src/shared/domain/mcpFile'
import { parsePromptFile, serializePromptFile } from '../../src/shared/domain/promptFile'
import type { ContractFileModel, McpFileModel, PromptFileModel } from '../../src/shared/contracts'

const prompt: PromptFileModel = {
  id: 'ast_prompt',
  title: 'Code review',
  description: 'Checklist for reviews',
  folder: 'engineering',
  tags: ['review', 'quality'],
  variables: [{ name: 'language', type: 'text', example: 'TypeScript', required: true }],
  syncPolicy: 'inherit',
  systemPrompt: 'You review {{language}} code.',
  userPrompt: 'Review:\n{{code}}',
}

describe('prompt file format', () => {
  it('round-trips through YAML frontmatter', () => {
    const text = serializePromptFile(prompt)
    const parsed = parsePromptFile(text)
    expect(parsed.error).toBeUndefined()
    expect(parsed.model).toMatchObject({
      id: 'ast_prompt',
      title: 'Code review',
      folder: 'engineering',
      systemPrompt: 'You review {{language}} code.',
      userPrompt: 'Review:\n{{code}}',
    })
    expect(parsed.model?.variables.map((variable) => variable.name)).toEqual(['language', 'code'])
  })

  it('reports a missing section instead of guessing', () => {
    const text = '---\ntitle: X\n---\n\nbody only\n'
    const parsed = parsePromptFile(text)
    expect(parsed.model).toBeNull()
    expect(parsed.error).toContain('## System Prompt')
  })

  it('infers the folder from the repository path', () => {
    const text = serializePromptFile({ ...prompt, folder: '' })
    const parsed = parsePromptFile(text, 'prompts/support/reply.prompt.md')
    expect(parsed.model?.folder).toBe('support')
  })
})

const contract: ContractFileModel = {
  id: 'ast_contract',
  title: 'API conventions',
  description: 'Rules for API code',
  folder: 'engineering/api',
  scope: 'path',
  pathPrefix: 'src/api',
  activation: { mode: 'glob', globs: ['src/api/**/*.ts'] },
  priority: 80,
  imports: ['docs/style.md'],
  targetIds: ['claude', 'cursor'],
  tags: ['api'],
  syncPolicy: 'sync',
  body: 'Use consistent error envelopes.',
}

describe('contract file format', () => {
  it('round-trips structured metadata and body', () => {
    const parsed = parseContractFile(serializeContractFile(contract))
    expect(parsed.error).toBeUndefined()
    expect(parsed.model).toMatchObject({
      id: 'ast_contract',
      scope: 'path',
      pathPrefix: 'src/api',
      priority: 80,
      targetIds: ['claude', 'cursor'],
      body: 'Use consistent error envelopes.',
    })
    expect(parsed.model?.activation).toEqual({ mode: 'glob', globs: ['src/api/**/*.ts'] })
  })

  it('rejects a path scope without a prefix', () => {
    const parsed = parseContractFile('---\ntitle: X\nscope: path\n---\n\nbody\n')
    expect(parsed.model).toBeNull()
    expect(parsed.error).toContain('pathPrefix')
  })
})

const mcp: McpFileModel = {
  id: 'ast_mcp',
  title: 'GitHub server',
  description: 'Issues and PRs',
  folder: 'dev',
  tags: ['github'],
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    GITHUB_TOKEN: { value: 'secret-value-that-must-not-leak', secret: true },
    LOG_LEVEL: { value: 'info', secret: false },
  },
  headers: {},
  requiredEnv: ['GITHUB_TOKEN'],
  enabled: true,
  notes: '',
}

describe('MCP file format', () => {
  it('serializes secrets as placeholders only', () => {
    const text = serializeMcpFile(mcp)
    expect(text).not.toContain('secret-value-that-must-not-leak')
    expect(text).toContain('${GITHUB_TOKEN}')
    const parsed = parseMcpFile(text)
    expect(parsed.model?.env.GITHUB_TOKEN).toEqual({ value: '${GITHUB_TOKEN}', secret: true })
    expect(parsed.model?.env.LOG_LEVEL).toEqual({ value: 'info', secret: false })
  })

  it('reports malformed JSON', () => {
    const parsed = parseMcpFile('{not json}')
    expect(parsed.model).toBeNull()
    expect(parsed.error).toContain('Invalid JSON')
  })

  it('performs static-only health checks', () => {
    const issues = checkMcpHealth({
      transport: 'stdio',
      command: '',
      env: {},
      headers: {},
      requiredEnv: ['TOKEN'],
    })
    expect(issues.some((issue) => issue.field === 'command' && issue.level === 'error')).toBe(true)
    expect(issues.some((issue) => issue.field === 'env.TOKEN')).toBe(true)
  })
})
