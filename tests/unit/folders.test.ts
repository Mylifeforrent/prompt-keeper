import { describe, expect, it } from 'vitest'
import {
  buildFolderTree,
  folderInScope,
  isPathInside,
  isSafeRelativePath,
  normalizeFolder,
  repoFilePath,
  slugify,
  validateFolder,
} from '../../src/shared/domain/folders'

describe('folders', () => {
  it('normalizes separators and empty segments', () => {
    expect(normalizeFolder(' engineering // code-quality/ ')).toBe('engineering/code-quality')
    expect(normalizeFolder(null)).toBe('')
  })

  it('rejects traversal and absolute folders', () => {
    expect(validateFolder('../secrets')).not.toBeNull()
    expect(validateFolder('/etc')).not.toBeNull()
    expect(validateFolder('a/../../b')).not.toBeNull()
    expect(validateFolder('engineering/api')).toBeNull()
  })

  it('checks relative path safety', () => {
    expect(isSafeRelativePath('src/lib/file.ts')).toBe(true)
    expect(isSafeRelativePath('src/../file.ts')).toBe(false)
    expect(isSafeRelativePath('C:/file.ts')).toBe(false)
  })

  it('checks containment lexically', () => {
    expect(isPathInside('/tmp/root', '/tmp/root/a/b')).toBe(true)
    expect(isPathInside('/tmp/root', '/tmp/root-other/a')).toBe(false)
  })

  it('builds a nested folder tree with totals', () => {
    const tree = buildFolderTree([
      { path: 'engineering', direct: 1, total: 1 },
      { path: 'engineering/api', direct: 2, total: 2 },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('engineering')
    expect(tree[0].totalCount).toBe(3)
    expect(tree[0].children[0].path).toBe('engineering/api')
  })

  it('applies folder scope and descendant inclusion', () => {
    expect(folderInScope('engineering/api', 'engineering')).toBe(true)
    expect(folderInScope('engineering/api', 'engineering', false)).toBe(false)
    expect(folderInScope('', '')).toBe(true)
  })

  it('creates repository paths and deterministic slugs', () => {
    expect(repoFilePath('prompts', 'engineering', 'review.prompt.md')).toBe(
      'prompts/engineering/review.prompt.md',
    )
    expect(slugify('Code Review Checklist', 'fallback')).toBe('code-review-checklist')
    expect(slugify('!!!', 'fallback')).toBe('fallback')
    expect(slugify('Überprüfung', 'fallback')).toBe('überprüfung')
  })
})
