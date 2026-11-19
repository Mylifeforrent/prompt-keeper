import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlobStore } from '../../src/main/adapters/blobStore'
import { openDatabase, type Db } from '../../src/main/db/database'
import { resolveAppPaths, type AppPaths } from '../../src/main/paths'
import { AssetStore } from '../../src/main/services/assetStore'
import { AppError } from '../../src/shared/domain/errors'

describe('asset store', () => {
  let dir: string
  let paths: AppPaths
  let db: Db
  let assets: AssetStore
  let blobs: BlobStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pk-assets-'))
    paths = resolveAppPaths(dir)
    db = openDatabase(paths)
    blobs = new BlobStore(paths.blobs)
    assets = new AssetStore(db, blobs, paths)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates version 1, stores blobs, materializes, and indexes', () => {
    const created = assets.createAsset({
      kind: 'prompt',
      title: 'Code Review',
      folder: 'engineering',
      description: 'Review helper',
      tags: ['review'],
      files: [{ path: 'code-review.prompt.md', content: '## System Prompt\n\nBody\n' }],
    })

    expect(created.asset.slug).toBe('code-review')
    expect(created.revision.version).toBe(1)
    expect(assets.currentRevision(created.asset.id).manifestHash).toMatch(/^[a-f0-9]{64}$/)

    const libraryFile = readFileSync(
      join(paths.library, 'prompt', created.asset.id, 'code-review.prompt.md'),
      'utf8',
    )
    expect(libraryFile).toContain('Body')

    const indexed = db
      .prepare('SELECT title FROM assets_fts WHERE asset_id = ?')
      .get(created.asset.id) as { title: string } | undefined
    expect(indexed?.title).toBe('Code Review')
    expect(assets.tags(created.asset.id)).toEqual(['review'])
  })

  it('allocates a unique slug inside the same folder', () => {
    const first = assets.createAsset({
      kind: 'prompt',
      title: 'Same title',
      files: [{ path: 'same.prompt.md', content: 'x' }],
    })
    const second = assets.createAsset({
      kind: 'prompt',
      title: 'Same title',
      files: [{ path: 'same.prompt.md', content: 'y' }],
    })
    expect(first.asset.slug).toBe('same-title')
    expect(second.asset.slug).toBe('same-title-2')
  })

  it('enforces the expected revision and keeps history append-only', () => {
    const created = assets.createAsset({
      kind: 'prompt',
      title: 'Versioned',
      files: [{ path: 'versioned.prompt.md', content: 'v1' }],
    })
    const second = assets.addRevision(
      created.asset.id,
      [{ path: 'versioned.prompt.md', content: 'v2' }],
      'second',
      created.revision.id,
    )
    expect(second.version).toBe(2)

    expect(() =>
      assets.addRevision(
        created.asset.id,
        [{ path: 'versioned.prompt.md', content: 'v3' }],
        'stale',
        created.revision.id,
      ),
    ).toThrowError(AppError)

    expect(assets.versions(created.asset.id).map((revision) => revision.version)).toEqual([2, 1])
  })

  it('soft deletes, hides from counts, and restores', () => {
    const created = assets.createAsset({
      kind: 'skill',
      title: 'Helper',
      files: [
        { path: 'SKILL.md', content: '# Helper' },
        { path: 'scripts/run.sh', content: '#!/bin/sh\necho hi', isExecutable: true },
      ],
    })
    expect(assets.countByKind().skill).toBe(1)
    assets.softDelete(created.asset.id)
    expect(assets.countByKind().skill).toBe(0)
    expect(() => assets.getAsset(created.asset.id)).toThrowError(AppError)
    const restored = assets.restoreAsset(created.asset.id)
    expect(restored.deletedAt).toBeNull()
    expect(assets.countByKind().skill).toBe(1)
  })
})
