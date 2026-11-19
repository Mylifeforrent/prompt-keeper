import type {
  AssetKind,
  OperationRef,
  SearchQuery,
  SearchResultItem,
  SearchResultPage,
  SyncPolicy,
} from '../../shared/contracts'
import { AppError } from '../../shared/domain/errors'
import { normalizeFolder } from '../../shared/domain/folders'
import { nowIso } from '../../shared/domain/ids'
import type { AppContext } from '../context'
import type { AssetRecord } from './assetStore'
import type { SearchService } from './types'

/**
 * Snippet markers use private-use sentinels so real content can be HTML-escaped
 * first; only the sentinels are converted back into literal <mark> tags.
 *
 * If the FTS5 table is missing or a MATCH query fails, search degrades to a
 * LIKE query over title, description, slug, folder, and tags. That fallback
 * cannot inspect revision bodies, so it is advisory rather than a silent
 * replacement for the index.
 */
const MARK_OPEN = '\uE000PKMARK\uE000'
const MARK_CLOSE = '\uE001PKMARK\uE001'
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_TOKENS = 10

interface FtsRow {
  assetId: string
  kind: AssetKind
  title: string
  path: string
  folder: string
  snippet: string | null
  rank: number
}

interface LikeRow {
  id: string
  kind: AssetKind
  title: string
  slug: string
  folder: string
  description: string
  syncPolicy: SyncPolicy
  createdAt: string
  updatedAt: string
}

function isAssetKind(value: unknown): value is AssetKind {
  return value === 'prompt' || value === 'contract' || value === 'skill' || value === 'mcp'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function decorateSnippet(raw: string): string {
  return escapeHtml(raw)
    .split(MARK_OPEN)
    .join('<mark>')
    .split(MARK_CLOSE)
    .join('</mark>')
}

function highlightExcerpt(text: string, tokens: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const lower = clean.toLowerCase()
  let matchIndex = -1
  let matchToken = ''
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase())
    if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
      matchIndex = index
      matchToken = token
    }
  }
  const start = matchIndex > 60 ? matchIndex - 60 : 0
  const end = Math.min(
    clean.length,
    matchIndex >= 0 ? Math.max(start + 200, matchIndex + matchToken.length + 120) : start + 200,
  )
  let excerpt = clean.slice(start, end)
  if (start > 0) excerpt = `...${excerpt}`
  if (end < clean.length) excerpt = `${excerpt}...`

  let marked = escapeHtml(excerpt)
  const patterns = tokens
    .filter(Boolean)
    .map((token) => escapeRegExp(escapeHtml(token)))
  if (patterns.length) {
    const combined = new RegExp(`(${patterns.join('|')})`, 'gi')
    let marks = 0
    marked = marked.replace(combined, (match) => {
      if (marks >= 5) return match
      marks += 1
      return `${MARK_OPEN}${match}${MARK_CLOSE}`
    })
  }
  return marked.split(MARK_OPEN).join('<mark>').split(MARK_CLOSE).join('</mark>')
}

function ftsExpression(tokens: string[]): string {
  return tokens
    .map((token, index) => {
      const quoted = `"${token.replace(/"/g, '""')}"`
      return index === tokens.length - 1 ? `${quoted}*` : quoted
    })
    .join(' AND ')
}

function tableExists(ctx: AppContext, name: string): boolean {
  const row = ctx.db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { present: number } | undefined
  return !!row
}

export function createSearchService(ctx: AppContext): SearchService {
  let rebuilding = false

  function queryFts(input: {
    tokens: string[]
    expression: string
    kinds: AssetKind[]
    folder: string
    includeDescendants: boolean
    limit: number
    offset: number
    rebuilding: boolean
  }): SearchResultPage {
    const where: string[] = ['assets_fts MATCH ?', 'a.deleted_at IS NULL']
    const filterParams: unknown[] = [input.expression]
    if (input.kinds.length) {
      where.push(`assets_fts.kind IN (${input.kinds.map(() => '?').join(', ')})`)
      filterParams.push(...input.kinds)
    }
    if (input.folder) {
      if (input.includeDescendants) {
        where.push(`(a.folder = ? OR a.folder LIKE ? ESCAPE '\\')`)
        filterParams.push(input.folder, `${escapeLike(input.folder)}/%`)
      } else {
        where.push('a.folder = ?')
        filterParams.push(input.folder)
      }
    }
    const clause = where.join(' AND ')

    const total = (
      ctx.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM assets_fts
           JOIN assets a ON a.id = assets_fts.asset_id
           WHERE ${clause}`,
        )
        .get(...filterParams) as { count: number }
    ).count

    const rows = ctx.db
      .prepare(
        `SELECT assets_fts.asset_id AS assetId,
                assets_fts.kind AS kind,
                a.title AS title,
                assets_fts.path AS path,
                a.folder AS folder,
                snippet(assets_fts, -1, ?, ?, '...', 20) AS snippet,
                bm25(assets_fts) AS rank
         FROM assets_fts
         JOIN assets a ON a.id = assets_fts.asset_id
         WHERE ${clause}
         ORDER BY bm25(assets_fts) ASC, a.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(MARK_OPEN, MARK_CLOSE, ...filterParams, input.limit, input.offset) as FtsRow[]

    const items = rows.map<SearchResultItem>((row) => ({
      assetId: row.assetId,
      kind: row.kind,
      title: row.title,
      path: row.path,
      folder: row.folder,
      snippet:
        typeof row.snippet === 'string' && row.snippet.length
          ? decorateSnippet(row.snippet)
          : escapeHtml(row.title),
      rank: typeof row.rank === 'number' ? row.rank : 0,
    }))

    return { items, total, limit: input.limit, offset: input.offset, rebuilding: input.rebuilding }
  }

  function queryLike(input: {
    tokens: string[]
    kinds: AssetKind[]
    folder: string
    includeDescendants: boolean
    limit: number
    offset: number
    rebuilding: boolean
  }): SearchResultPage {
    const where: string[] = ['a.deleted_at IS NULL']
    const params: unknown[] = []
    for (const token of input.tokens) {
      const like = `%${escapeLike(token)}%`
      where.push(
        `(a.title LIKE ? ESCAPE '\\'
          OR a.description LIKE ? ESCAPE '\\'
          OR a.slug LIKE ? ESCAPE '\\'
          OR a.folder LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM tags tg WHERE tg.asset_id = a.id AND tg.tag LIKE ? ESCAPE '\\'))`,
      )
      params.push(like, like, like, like, like)
    }
    if (input.kinds.length) {
      where.push(`a.kind IN (${input.kinds.map(() => '?').join(', ')})`)
      params.push(...input.kinds)
    }
    if (input.folder) {
      if (input.includeDescendants) {
        where.push(`(a.folder = ? OR a.folder LIKE ? ESCAPE '\\')`)
        params.push(input.folder, `${escapeLike(input.folder)}/%`)
      } else {
        where.push('a.folder = ?')
        params.push(input.folder)
      }
    }
    const clause = where.join(' AND ')

    const total = (
      ctx.db
        .prepare(`SELECT COUNT(*) AS count FROM assets a WHERE ${clause}`)
        .get(...params) as { count: number }
    ).count

    const rows = ctx.db
      .prepare(
        `SELECT a.id, a.kind, a.title, a.slug, a.folder, a.description,
                a.sync_policy AS syncPolicy, a.created_at AS createdAt, a.updated_at AS updatedAt
         FROM assets a
         WHERE ${clause}
         ORDER BY a.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, input.offset) as LikeRow[]

    const items = rows.map<SearchResultItem>((row) => {
      const asset: AssetRecord = {
        id: row.id,
        kind: row.kind,
        title: row.title,
        slug: row.slug,
        folder: row.folder,
        description: row.description,
        syncPolicy: row.syncPolicy,
        source: 'local',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: null,
      }
      const source = row.description.trim() ? row.description : row.title
      return {
        assetId: row.id,
        kind: row.kind,
        title: row.title,
        path: ctx.assets.repoPathFor(asset),
        folder: row.folder,
        snippet: highlightExcerpt(source, input.tokens),
        rank: 0,
      }
    })

    return { items, total, limit: input.limit, offset: input.offset, rebuilding: input.rebuilding }
  }

  return {
    async query(input: SearchQuery): Promise<SearchResultPage> {
      const limit = Math.min(Math.max(input?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(input?.offset ?? 0, 0)
      const raw = typeof input?.q === 'string' ? input.q.trim() : ''
      const tokens = raw
        .split(/\s+/)
        .filter((token) => /[\p{L}\p{N}]/u.test(token))
        .slice(0, MAX_TOKENS)
      const kinds = (input?.kinds ?? []).filter(isAssetKind)
      const folder = normalizeFolder(input?.folder)
      const includeDescendants = input?.includeDescendants === true
      const rebuildingNow = rebuilding

      if (!tokens.length) {
        return { items: [], total: 0, limit, offset, rebuilding: rebuildingNow }
      }

      const common = { tokens, kinds, folder, includeDescendants, limit, offset, rebuilding: rebuildingNow }
      if (tableExists(ctx, 'assets_fts')) {
        try {
          return queryFts({ ...common, expression: ftsExpression(tokens) })
        } catch (error) {
          // A corrupt or unavailable FTS index must not make search unusable.
          // The LIKE path searches metadata and tags, not revision bodies.
          ctx.logger.warn('search', 'Full-text search failed; using the metadata fallback', {
            message: error instanceof Error ? error.message : 'unknown',
          })
        }
      }
      try {
        return queryLike(common)
      } catch (error) {
        throw new AppError(
          'INTERNAL',
          'Search could not read the local index. Rebuild the index from Settings.',
          { kind: 'unknown', message: error instanceof Error ? error.message : 'unknown' },
        )
      }
    },

    async rebuild(): Promise<OperationRef> {
      const total = (
        ctx.db.prepare('SELECT COUNT(*) AS count FROM assets WHERE deleted_at IS NULL').get() as {
          count: number
        }
      ).count
      rebuilding = true
      try {
        return ctx.operations.start('search_rebuild', async (operationContext) => {
          try {
            // Let the operation reference reach the renderer before the synchronous
            // rebuild starts blocking the main process.
            await Promise.resolve()
            operationContext.progress('index', 0, total, 'Rebuilding the local search index')
            const indexed = ctx.assets.rebuildIndex()
            operationContext.progress('index', indexed, Math.max(indexed, total))
            ctx.events.domainChanged('search', 'updated', [], operationContext.operationId)
            ctx.logger.info('search', 'Search index rebuilt', { indexed, at: nowIso() })
            return { type: 'search_rebuild' as const, indexed }
          } finally {
            rebuilding = false
          }
        })
      } catch (error) {
        rebuilding = false
        throw error
      }
    },
  }
}
