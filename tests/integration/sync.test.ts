import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { OperationCompletedEvent, OperationRef } from '../../src/shared/contracts'
import { serializePromptFile } from '../../src/shared/domain/promptFile'
import { BlobStore } from '../../src/main/adapters/blobStore'
import type { SecretStore, SecretOwnerType } from '../../src/main/adapters/secrets'
import type { AppContext } from '../../src/main/context'
import { openDatabase, type Db } from '../../src/main/db/database'
import { EventBus } from '../../src/main/events'
import { Logger } from '../../src/main/logger'
import { OperationManager } from '../../src/main/operations'
import { resolveAppPaths, type AppPaths } from '../../src/main/paths'
import { AssetStore } from '../../src/main/services/assetStore'
import { AuditService } from '../../src/main/services/auditService'
import { createPromptService } from '../../src/main/services/prompts'
import { createSyncService } from '../../src/main/services/sync'

class MemorySecrets implements SecretStore {
  private values = new Map<string, string>()
  available(): boolean {
    return true
  }
  reason(): string | undefined {
    return undefined
  }
  set(ownerType: SecretOwnerType, ownerId: string, key: string, value: string): void {
    this.values.set(`${ownerType}:${ownerId}:${key}`, value)
  }
  get(ownerType: SecretOwnerType, ownerId: string, key: string): string | null {
    return this.values.get(`${ownerType}:${ownerId}:${key}`) ?? null
  }
  has(ownerType: SecretOwnerType, ownerId: string, key: string): boolean {
    return this.values.has(`${ownerType}:${ownerId}:${key}`)
  }
  listKeys(ownerType: SecretOwnerType, ownerId: string): string[] {
    return [...this.values.keys()]
      .filter((entry) => entry.startsWith(`${ownerType}:${ownerId}:`))
      .map((entry) => entry.split(':')[2])
  }
  delete(ownerType: SecretOwnerType, ownerId: string, key: string): void {
    this.values.delete(`${ownerType}:${ownerId}:${key}`)
  }
  deleteOwner(ownerType: SecretOwnerType, ownerId: string): void {
    for (const key of this.listKeys(ownerType, ownerId)) this.delete(ownerType, ownerId, key)
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('git synchronization', () => {
  let root: string
  let dataDir: string
  let remote: string
  let seed: string
  let clone: string
  let paths: AppPaths
  let db: Db
  let ctx: AppContext
  let events: EventBus
  let completed: OperationCompletedEvent[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pk-sync-'))
    dataDir = join(root, 'data')
    remote = join(root, 'remote.git')
    seed = join(root, 'seed')
    clone = join(root, 'clone')
    execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' })
    execFileSync('git', ['clone', remote, seed], { encoding: 'utf8' })
    git(seed, 'config', 'user.email', 'test@example.com')
    git(seed, 'config', 'user.name', 'Test')
    git(seed, 'checkout', '-b', 'main')
    writeFileSync(
      join(seed, 'README.md'),
      '# Repository\n',
    )
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'seed')
    git(seed, 'push', '-u', 'origin', 'main')
    execFileSync('git', ['clone', remote, clone], { encoding: 'utf8' })

    paths = resolveAppPaths(dataDir)
    db = openDatabase(paths)
    const blobs = new BlobStore(paths.blobs)
    events = new EventBus()
    completed = []
    events.attach((channel, payload) => {
      if (channel === 'operation:completed') completed.push(payload as OperationCompletedEvent)
    })
    const assets = new AssetStore(db, blobs, paths)
    ctx = {
      db,
      paths,
      blobs,
      assets,
      secrets: new MemorySecrets(),
      events,
      operations: new OperationManager(db, events),
      audit: new AuditService(db),
      logger: new Logger(paths.logs),
      platform: 'darwin',
      appVersion: 'test',
      buildId: 'test',
      safeStorageAvailable: true,
    }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function waitFor(ref: OperationRef): Promise<OperationCompletedEvent> {
    for (let index = 0; index < 400; index++) {
      const hit = completed.find((event) => event.operationId === ref.operationId)
      if (hit) return hit
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('The operation did not complete.')
  }

  it('connects, pushes a local Prompt, fetches a remote Prompt, and resolves a conflict', async () => {
    const sync = createSyncService(ctx)
    const prompts = createPromptService(ctx)

    const preview = await sync.repoConnect({
      url: `file://${remote}`,
      branch: 'main',
      cloneMode: 'bound',
      localPath: clone,
      auth: { mode: 'credential' },
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: false,
    })
    expect(preview.phase).toBe('preview')
    if (preview.phase !== 'preview') throw new Error('Expected a preview.')

    const applied = await sync.repoConnect({
      url: `file://${remote}`,
      branch: 'main',
      cloneMode: 'bound',
      localPath: clone,
      auth: { mode: 'credential' },
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: true,
      previewToken: preview.previewToken,
    })
    expect(applied.phase).toBe('applied')

    await prompts.create({
      title: 'Local prompt',
      userPrompt: 'Local body with {{name}}.',
    })

    const outgoing = await sync.changes({ direction: 'outgoing', limit: 50 })
    expect(outgoing.items.some((change) => change.path.includes('local-prompt'))).toBe(true)

    const pushRef = await sync.push({
      changeIds: [outgoing.items[0].id],
      commitMessage: 'Add local prompt',
      method: 'direct',
    })
    const pushed = await waitFor(pushRef)
    expect(pushed.state).toBe('committed')
    expect(git(remote, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main')).toContain(
      'prompts/local-prompt.prompt.md',
    )

    const remoteFile = join(seed, 'prompts', 'remote', 'remote.prompt.md')
    git(seed, 'pull', '--rebase', 'origin', 'main')
    mkdirSync(join(seed, 'prompts', 'remote'), { recursive: true })
    writeFileSync(
      remoteFile,
      serializePromptFile({
        id: 'ast_remote_prompt',
        title: 'Remote prompt',
        description: '',
        folder: 'remote',
        tags: [],
        variables: [],
        syncPolicy: 'inherit',
        systemPrompt: '',
        userPrompt: 'Remote body.',
      }),
    )
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'Add remote prompt')
    git(seed, 'push', 'origin', 'main')

    const fetchRef = await sync.fetch({})
    const fetched = await waitFor(fetchRef)
    expect(fetched.state).toBe('committed')

    const incoming = await sync.changes({ direction: 'incoming', limit: 50 })
    const incomingChange = incoming.items.find((change) => change.path.includes('remote.prompt.md'))
    expect(incomingChange).toBeTruthy()
    if (!incomingChange) throw new Error('Missing incoming change.')

    const approved = await sync.review({
      changeIds: [incomingChange.id],
      decision: 'approve',
      expectedFingerprints: { [incomingChange.id]: incomingChange.fingerprint },
    })
    expect(approved.approved).toEqual([incomingChange.id])

    const pullRef = await sync.pull({
      changeIds: [incomingChange.id],
      expectedFingerprints: { [incomingChange.id]: incomingChange.fingerprint },
    })
    const pulled = await waitFor(pullRef)
    expect(pulled.state).toBe('committed')
    expect((await prompts.list({ search: 'Remote prompt' })).total).toBe(1)

    // Create a conflict: edit the same remote-backed Prompt locally and remotely.
    const remotePrompt = (await prompts.list({ search: 'Remote prompt' })).items[0]
    const current = await prompts.get(remotePrompt.id)
    await prompts.update({
      id: remotePrompt.id,
      expectedRevisionId: current.currentRevisionId,
      userPrompt: 'Local conflict body.',
    })
    git(seed, 'pull', '--rebase', 'origin', 'main')
    writeFileSync(
      remoteFile,
      serializePromptFile({
        id: 'ast_remote_prompt',
        title: 'Remote prompt',
        description: '',
        folder: 'remote',
        tags: [],
        variables: [],
        syncPolicy: 'inherit',
        systemPrompt: '',
        userPrompt: 'Remote conflict body.',
      }),
    )
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'Remote conflict edit')
    git(seed, 'push', 'origin', 'main')

    const conflictFetch = await sync.fetch({})
    await waitFor(conflictFetch)
    const conflicts = await sync.changes({ direction: 'conflict', limit: 50 })
    const conflict = conflicts.items[0]
    expect(conflict).toBeTruthy()
    if (!conflict) throw new Error('Missing conflict.')

    const detail = await sync.changeDetail({ changeId: conflict.id })
    expect(detail.files[0].local).toContain('Local conflict body.')
    expect(detail.files[0].remote).toContain('Remote conflict body.')

    const resolved = await sync.conflictResolve({
      changeId: conflict.id,
      expectedFingerprint: conflict.fingerprint,
      strategy: 'take-remote',
      confirm: true,
    })
    expect(resolved.resolved).toBe(true)
    const after = await prompts.get(remotePrompt.id)
    expect(after.userPrompt).toContain('Remote conflict body.')
  })

  it('connects a local repository without a URL, branch, or token', async () => {
    const sync = createSyncService(ctx)

    const preview = await sync.repoConnect({
      cloneMode: 'bound',
      localPath: clone,
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: false,
    })
    expect(preview.phase).toBe('preview')
    if (preview.phase !== 'preview') throw new Error('Expected a preview.')
    expect(preview.repo.url).toBe(remote)
    expect(preview.repo.branch).toBe('main')
    expect(preview.repo.localPath).toBe(clone)

    const applied = await sync.repoConnect({
      cloneMode: 'bound',
      localPath: clone,
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: true,
      previewToken: preview.previewToken,
    })
    expect(applied.phase).toBe('applied')
    if (applied.phase !== 'applied') throw new Error('Expected an applied connection.')
    expect(applied.repo.url).toBe(remote)
    expect(applied.repo.branch).toBe('main')
    expect(applied.repo.auth).toEqual({ mode: 'credential', hasToken: false })
  })

  it('rejects a local repository without an origin remote', async () => {
    const sync = createSyncService(ctx)
    const local = join(root, 'no-origin')
    mkdirSync(local, { recursive: true })
    execFileSync('git', ['init', local], { encoding: 'utf8' })

    await expect(
      sync.repoConnect({
        cloneMode: 'bound',
        localPath: local,
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('connects a skill repository whose content exceeds the previous scan budget', async () => {
    const sync = createSyncService(ctx)
    const skillDir = join(seed, 'skills', 'large-skill')
    const assetsDir = join(skillDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      ['---', 'name: Large Skill', 'description: A skill with large binary assets', '---', '', 'Use the assets.'].join(
        '\n',
      ),
    )
    const chunk = Buffer.alloc(14 * 1024 * 1024, 0x41)
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(assetsDir, `blob-${index}.bin`), chunk)
    }
    git(seed, 'add', '-A')
    git(seed, 'commit', '-m', 'Add a large skill')
    git(seed, 'push', 'origin', 'main')
    git(clone, 'pull', '--rebase', 'origin', 'main')

    const preview = await sync.repoConnect({
      cloneMode: 'bound',
      localPath: clone,
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: false,
    })
    expect(preview.phase).toBe('preview')
    if (preview.phase !== 'preview') throw new Error('Expected a preview.')
    expect(preview.counts.skill).toBe(1)

    const applied = await sync.repoConnect({
      cloneMode: 'bound',
      localPath: clone,
      policies: { prompts: true, contracts: true, skills: true, mcp: true },
      autoFetch: false,
      confirm: true,
      previewToken: preview.previewToken,
    })
    expect(applied.phase).toBe('applied')

    const row = ctx.db
      .prepare("SELECT id FROM assets WHERE kind = 'skill' AND deleted_at IS NULL")
      .get() as { id: string } | undefined
    expect(row).toBeTruthy()
    if (!row) throw new Error('The skill was not imported.')
    const skillsRow = ctx.db.prepare('SELECT version_label FROM skills WHERE asset_id = ?').get(row.id) as
      | { version_label: string }
      | undefined
    expect(skillsRow).toBeTruthy()
    const materialized = join(paths.library, 'skill', row.id, 'assets', 'blob-4.bin')
    expect(existsSync(materialized)).toBe(true)
    expect(statSync(materialized).size).toBe(chunk.length)
  })
})
