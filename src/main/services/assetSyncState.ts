import type { AssetSyncState, AssetBase, RepoPolicies, RepoStatus, SyncPolicy } from '../../shared/contracts'
import type { AppContext } from '../context'
import type { AssetRecord } from './assetStore'
import { scanFiles } from '../../shared/domain/credentialScanner'
import { sha256Hex } from '../adapters/hash'

export function repoRow(ctx: AppContext): Record<string, unknown> | null {
  return (ctx.db.prepare('SELECT * FROM repos ORDER BY created_at LIMIT 1').get() as
    | Record<string, unknown>
    | undefined) ?? null
}

export function repoPolicies(ctx: AppContext): RepoPolicies {
  const row = repoRow(ctx)
  if (!row) return { prompts: false, contracts: false, skills: false, mcp: false }
  try {
    return JSON.parse(row.policies_json as string) as RepoPolicies
  } catch {
    return { prompts: false, contracts: false, skills: false, mcp: false }
  }
}

function kindPolicyKey(kind: AssetRecord['kind']): keyof RepoPolicies {
  switch (kind) {
    case 'prompt':
      return 'prompts'
    case 'contract':
      return 'contracts'
    case 'skill':
      return 'skills'
    default:
      return 'mcp'
  }
}

export function effectiveSync(ctx: AppContext, kind: AssetRecord['kind'], syncPolicy: SyncPolicy): boolean {
  const repo = repoRow(ctx)
  if (!repo) return false
  if (syncPolicy === 'local') return false
  return repoPolicies(ctx)[kindPolicyKey(kind)]
}

export function syncStateFor(ctx: AppContext, assetId: string, effective: boolean): AssetSyncState {
  const repo = repoRow(ctx)
  if (!repo) return 'not-connected'
  if (!effective) return 'local-only'
  const rows = ctx.db
    .prepare(
      "SELECT direction, blocked FROM sync_changes WHERE asset_id = ? AND status IN ('open','reviewed')",
    )
    .all(assetId) as Array<{ direction: string; blocked: number }>
  if (rows.some((row) => row.direction === 'conflict')) return 'conflict'
  if (rows.some((row) => row.blocked)) return 'blocked'
  if (rows.some((row) => row.direction === 'incoming')) return 'incoming'
  if (rows.some((row) => row.direction === 'outgoing')) return 'outgoing'
  return 'in-sync'
}

export function assetBase(ctx: AppContext, asset: AssetRecord): AssetBase {
  const revision = ctx.assets.currentRevision(asset.id)
  const versionCount = (
    ctx.db.prepare('SELECT COUNT(*) AS count FROM asset_revisions WHERE asset_id = ?').get(asset.id) as {
      count: number
    }
  ).count
  const effective = effectiveSync(ctx, asset.kind, asset.syncPolicy)
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    slug: asset.slug,
    folder: asset.folder,
    description: asset.description,
    tags: ctx.assets.tags(asset.id),
    syncPolicy: asset.syncPolicy,
    effectiveSync: effective,
    syncState: syncStateFor(ctx, asset.id, effective),
    inRepo: ctx.assets.hasBase(asset.id),
    currentRevisionId: revision.id,
    currentVersion: revision.version,
    versionCount,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

export function withdrawPendingChanges(ctx: AppContext, assetId: string): string[] {
  const rows = ctx.db
    .prepare("SELECT id FROM sync_changes WHERE asset_id = ? AND status IN ('open','reviewed')")
    .all(assetId) as Array<{ id: string }>
  if (!rows.length) return []
  ctx.db
    .prepare("UPDATE sync_changes SET status = 'resolved', updated_at = ? WHERE asset_id = ? AND status IN ('open','reviewed')")
    .run(new Date().toISOString(), assetId)
  return rows.map((row) => row.id)
}

/**
 * Record (or refresh) an outgoing change for an asset that participates in sync.
 * Never commits or pushes; push remains an explicit user action.
 */
export function recordLocalChange(ctx: AppContext, assetId: string): void {
  const asset = ctx.assets.getAsset(assetId)
  if (!effectiveSync(ctx, asset.kind, asset.syncPolicy)) return
  const repo = repoRow(ctx)
  if (!repo) return
  const revision = ctx.assets.currentRevision(assetId)
  let layout: Record<string, string>
  try {
    layout = JSON.parse(repo.layout_json as string) as Record<string, string>
  } catch {
    return
  }
  const root = layout[kindPolicyKey(asset.kind)] ?? asset.kind
  const remotePath = ctx.assets.repoPathForLayout(asset, root)
  const risk: string[] = []
  try {
    const contents = ctx.assets.revisionFiles(revision.id)
      .filter((file) => file.mediaKind === 'text')
      .map((file) => ({ path: file.path, content: ctx.blobs.readSync(file.blobHash).toString('utf8') }))
    if (scanFiles(contents, '{{variable}}').some((finding) => finding.confidence === 'high')) {
      risk.push('secrets')
    }
    if (asset.kind === 'skill' && contents.some((file) => /\.(sh|bash|ps1|py|js|ts)$/i.test(file.path))) {
      risk.push('scripts')
    }
    if (asset.kind === 'mcp') {
      const row = ctx.db.prepare('SELECT transport, url FROM mcp_servers WHERE asset_id = ?').get(assetId) as
        | { transport: string; url: string | null }
        | undefined
      if (row && (row.transport === 'http' || row.url)) risk.push('network')
    }
  } catch {
    // Risk detection is advisory; a blob failure surfaces during push.
  }

  const base = ctx.db
    .prepare('SELECT base_revision_id FROM repo_assets WHERE repo_id = ? AND asset_id = ?')
    .get(repo.id as string, assetId) as { base_revision_id: string | null } | undefined
  const fingerprint = sha256Hex(
    `${assetId}|${revision.id}|${remotePath}|outgoing|${base?.base_revision_id ?? 'none'}`,
  )
  const existing = ctx.db
    .prepare("SELECT id FROM sync_changes WHERE repo_id = ? AND asset_id = ? AND status IN ('open','reviewed')")
    .get(repo.id as string, assetId) as { id: string } | undefined
  const at = new Date().toISOString()
  if (existing) {
    ctx.db
      .prepare(
        'UPDATE sync_changes SET remote_path = ?, fingerprint = ?, local_revision_id = ?, risk_json = ?, summary = ?, updated_at = ? WHERE id = ?',
      )
      .run(remotePath, fingerprint, revision.id, JSON.stringify(risk), `Local changes to ${asset.title}`, at, existing.id)
    return
  }
  ctx.db
    .prepare(
      `INSERT INTO sync_changes
       (id, repo_id, asset_id, asset_kind, asset_name, remote_path, direction, change_kind, status,
        risk_json, fingerprint, local_revision_id, base_revision_id, additions, deletions, summary, blocked, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'outgoing', ?, 'open', ?, ?, ?, ?, 0, 0, ?, 0, ?, ?)`,
    )
    .run(
      `chg_${sha256Hex(fingerprint).slice(0, 20)}`,
      repo.id as string,
      assetId,
      asset.kind,
      asset.title,
      remotePath,
      base?.base_revision_id ? 'modified' : 'added',
      JSON.stringify(risk),
      fingerprint,
      revision.id,
      base?.base_revision_id ?? null,
      `Local changes to ${asset.title}`,
      at,
      at,
    )
}

export function repoStatusRow(ctx: AppContext): RepoStatus | null {
  const row = repoRow(ctx)
  if (!row) return null
  const policies = repoPolicies(ctx)
  const layout = JSON.parse(row.layout_json as string) as RepoStatus['layout']
  const tokenCount = (
    ctx.db.prepare("SELECT COUNT(*) AS count FROM secrets WHERE owner_type = 'git_token'").get() as {
      count: number
    }
  ).count
  const pending = ctx.db
    .prepare("SELECT direction, COUNT(*) AS count FROM sync_changes WHERE status IN ('open','reviewed') GROUP BY direction")
    .all() as Array<{ direction: string; count: number }>
  void pending
  return {
    connected: true,
    provider: row.provider as RepoStatus['provider'],
    url: row.url as string,
    branch: row.branch as string,
    localPath: row.local_path as string,
    cloneMode: row.clone_mode as 'managed' | 'bound',
    auth: {
      mode: row.auth_mode as 'credential' | 'ssh' | 'token',
      hasToken: tokenCount > 0,
    },
    policies,
    layout,
    autoFetch: !!row.auto_fetch,
    fetchIntervalMin: row.fetch_interval_min as number,
    pushMode: row.push_mode as 'direct' | 'branch',
    ...(row.last_fetched_at ? { lastFetchedAt: row.last_fetched_at as string } : {}),
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at as string } : {}),
    ahead: 0,
    behind: 0,
    operation: null,
    security: { plaintextCredentialCount: 0, blocked: false },
  }
}
