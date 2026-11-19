import { describe, expect, it } from 'vitest'
import {
  compileContract,
  parseManagedFile,
  resolveContracts,
  upsertManagedBlocks,
} from '../../src/shared/domain/compiler'
import type { ContractFileModel } from '../../src/shared/contracts'

const base: ContractFileModel = {
  id: 'c1',
  title: 'Baseline',
  description: 'Baseline rules',
  folder: '',
  scope: 'project',
  pathPrefix: null,
  activation: { mode: 'always', globs: [] },
  priority: 50,
  imports: [],
  targetIds: ['agents-md', 'cursor'],
  tags: [],
  syncPolicy: 'inherit',
  body: 'Rule one.',
}

const target = {
  id: 'agents-md',
  label: 'AGENTS.md',
  format: 'agents-md' as const,
  merge: 'single-file' as const,
  supports: { globs: false, modelDecision: false, manual: false, imports: false },
  maxBytes: 32768,
}

describe('managed blocks', () => {
  it('preserves outside content and replaces only the selected block', () => {
    const existing = '# Project notes\n\n<!-- pk:begin c1 -->\nold\n<!-- pk:end c1 -->\n\nfooter\n'
    const result = upsertManagedBlocks(
      existing,
      [{ id: 'c1', text: '<!-- pk:begin c1 -->\nnew\n<!-- pk:end c1 -->' }],
      [],
    )
    expect(result.error).toBeUndefined()
    expect(result.text).toContain('# Project notes')
    expect(result.text).toContain('footer')
    expect(result.text).toContain('new')
    expect(result.text).not.toContain('old')
  })

  it('appends missing blocks without touching other blocks', () => {
    const existing = '<!-- pk:begin c2 -->\nsecond\n<!-- pk:end c2 -->\n'
    const result = upsertManagedBlocks(
      existing,
      [
        { id: 'c1', text: '<!-- pk:begin c1 -->\nfirst\n<!-- pk:end c1 -->' },
        { id: 'c2', text: '<!-- pk:begin c2 -->\nsecond\n<!-- pk:end c2 -->' },
      ],
      [],
      ['c1', 'c2'],
    )
    expect(result.text).toContain('first')
    expect(result.text).toContain('second')
    expect(result.text).not.toContain('undefined')
  })

  it('reports duplicate and unclosed markers', () => {
    expect(parseManagedFile('<!-- pk:begin a -->\nx\n<!-- pk:end a -->\n<!-- pk:begin a -->\ny\n<!-- pk:end a -->').ok).toBe(false)
    expect(parseManagedFile('<!-- pk:begin a -->\nx').ok).toBe(false)
    expect(parseManagedFile('<!-- pk:end a -->').ok).toBe(false)
  })
})

describe('contract compilation', () => {
  it('renders Cursor frontmatter from the activation mode', () => {
    const content = compileContract(
      { ...base, activation: { mode: 'glob', globs: ['src/**/*.ts'] } },
      {
        id: 'cursor',
        label: 'Cursor',
        format: 'cursor-mdc',
        merge: 'per-contract',
        supports: { globs: true, modelDecision: true, manual: true, imports: false },
      },
      'instructions/c1.contract.md',
    )
    expect(content).toContain('alwaysApply: false')
    expect(content).toContain('globs:')
    expect(content).toContain('Rule one.')
  })

  it('skips unsupported activation modes instead of downgrading', () => {
    const preview = resolveContracts({
      contracts: [
        {
          model: { ...base, activation: { mode: 'glob', globs: ['**/*.ts'] } },
          sourcePath: 'instructions/c1.contract.md',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      target,
      scope: 'project',
      samplePath: 'src/a.ts',
    })
    expect(preview.included).toHaveLength(0)
    expect(preview.skipped[0].code).toBe('activation-unsupported')
  })

  it('keeps manual activation out of automatic context', () => {
    const preview = resolveContracts({
      contracts: [
        {
          model: { ...base, activation: { mode: 'manual', globs: [] } },
          sourcePath: 'instructions/c1.contract.md',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      target: {
        ...target,
        id: 'cursor',
        label: 'Cursor',
        format: 'cursor-mdc',
        merge: 'per-contract',
        supports: { globs: true, modelDecision: true, manual: true, imports: false },
      },
      scope: 'project',
    })
    expect(preview.included).toHaveLength(0)
    expect(preview.skipped[0].code).toBe('manual-only')
  })

  it('orders by priority and flags budget overflow', () => {
    const preview = resolveContracts({
      contracts: [
        {
          model: { ...base, id: 'low', priority: 10 },
          sourcePath: 'a',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          model: { ...base, id: 'high', priority: 90 },
          sourcePath: 'b',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      target: { ...target, maxBytes: 10 },
      scope: 'project',
    })
    expect(preview.included.map((entry) => entry.contractId)).toEqual(['high', 'low'])
    expect(preview.budgetExceeded).toBe(true)
  })
})
