import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentMcpState,
  McpApplyPreview,
  McpDetail,
  McpListItem,
  McpQuery,
  McpSource,
  McpStoreItem,
  McpTransport,
} from '../../../shared/contracts'
import { flattenFolderTree } from '../../../shared/domain/folders'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Spinner,
  Switch,
} from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { FolderTree } from '../shared/FolderTree'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { useToast } from '../ui/toast'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn, copyToClipboard, formatDate } from '../../lib/utils'
import {
  PLAINTEXT_AT_REST_NOTICE,
  SECRET_STORAGE_NOTICE,
  STATIC_HEALTH_NOTICE,
  agentFormatLabel,
  applyActionMeta,
  healthIssueCounts,
  healthStatusMeta,
  mcpApplyEntryPreview,
  mcpConfigPreview,
  mcpRepoPath,
  mcpSourceMeta,
  serverMatchNames,
  transportMeta,
} from '../../lib/mcpView'
import type { WorkspaceProps } from '../../app/types'
import { McpEditModal } from './McpEditModal'

let lastHandledCreate = 0

interface McpLibraryProps extends WorkspaceProps {
  focus: { id: string; n: number } | null
}

type TransportFilter = McpTransport | 'all'
type EnabledFilter = 'all' | 'enabled' | 'disabled'
type HealthFilter = 'all' | 'ok' | 'warning' | 'error'

const SOURCE_LABEL: Record<McpSource, string> = {
  manual: 'Manual',
  market: 'From store',
  import: 'Imported',
}

export function McpLibrary({ query, createSignal, focus }: McpLibraryProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [folder, setFolder] = useState('')
  const [transport, setTransport] = useState<TransportFilter>('all')
  const [enabled, setEnabled] = useState<EnabledFilter>('all')
  const [health, setHealth] = useState<HealthFilter>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<McpDetail | null>(null)
  const [deleting, setDeleting] = useState<McpDetail | null>(null)
  const [versionsOf, setVersionsOf] = useState<McpDetail | null>(null)
  const [applyOf, setApplyOf] = useState<McpDetail | null>(null)

  const effectiveSearch = search.trim() || query.trim()

  const listInput: McpQuery = {
    search: effectiveSearch || undefined,
    folder: folder || undefined,
    includeDescendants: true,
    transport: transport === 'all' ? undefined : transport,
    enabled: enabled === 'all' ? undefined : enabled === 'enabled',
    favorite: favoriteOnly || undefined,
    healthStatus: health === 'all' ? undefined : health,
    sort: 'updated',
    order: 'desc',
    limit: 200,
  }

  const listQuery = useQuery({
    queryKey: queryKeys.mcp.list(listInput),
    queryFn: () => ipc.mcp.list(listInput),
  })

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])
  const total = listQuery.data?.total ?? 0
  const folders = useMemo(() => listQuery.data?.folders ?? [], [listQuery.data])
  const folderPaths = useMemo(
    () => flattenFolderTree(folders).map((node) => node.path),
    [folders],
  )

  const detailQuery = useQuery({
    queryKey: queryKeys.mcp.detail(selectedId ?? 'none'),
    queryFn: () => {
      if (!selectedId) return Promise.reject(new Error('No MCP server selected'))
      return ipc.mcp.get(selectedId)
    },
    enabled: !!selectedId,
  })

  useEffect(() => {
    if (createSignal.page !== 'mcp' || createSignal.n <= lastHandledCreate) return
    lastHandledCreate = createSignal.n
    setCreating(true)
  }, [createSignal])

  useEffect(() => {
    if (!focus) return
    setFolder('')
    setTransport('all')
    setEnabled('all')
    setHealth('all')
    setFavoriteOnly(false)
    setSearch('')
    setSelectedId(focus.id)
  }, [focus])

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  const filtered =
    !!effectiveSearch || !!folder || transport !== 'all' || enabled !== 'all' || health !== 'all' || favoriteOnly

  const clearFilters = () => {
    setFolder('')
    setTransport('all')
    setEnabled('all')
    setHealth('all')
    setFavoriteOnly(false)
    setSearch('')
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await ipc.mcp.delete({ id: deleting.id, confirm: true })
      toast.success(
        `Deleted "${deleting.title}" from the library. Agent configuration files are unchanged.`,
      )
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden w-[190px] shrink-0 border-r border-border bg-card/40 xl:flex xl:flex-col">
        <FolderTree
          nodes={folders}
          selected={folder}
          onSelect={setFolder}
          totalCount={total}
          title="MCP folders"
        />
      </div>

      <div className="flex w-[340px] shrink-0 flex-col border-r border-border bg-background/40 xl:w-[360px]">
        <div className="shrink-0 space-y-2 border-b border-border px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Filter MCP servers"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter servers…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button size="sm" onClick={() => setCreating(true)} title="New MCP server (shortcut N)">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Select
              aria-label="Filter by transport"
              className="min-w-0 flex-1"
              value={transport}
              onChange={(event) => setTransport(event.target.value as TransportFilter)}
            >
              <option value="all">All transports</option>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </Select>
            <Select
              aria-label="Filter by enabled state"
              className="min-w-0 flex-1"
              value={enabled}
              onChange={(event) => setEnabled(event.target.value as EnabledFilter)}
            >
              <option value="all">Any state</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </Select>
            <Select
              aria-label="Filter by health"
              className="w-[104px] shrink-0"
              value={health}
              onChange={(event) => setHealth(event.target.value as HealthFilter)}
            >
              <option value="all">Any health</option>
              <option value="ok">ok</option>
              <option value="warning">warning</option>
              <option value="error">error</option>
            </Select>
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <button
              type="button"
              aria-pressed={favoriteOnly}
              onClick={() => setFavoriteOnly((value) => !value)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 transition-colors',
                favoriteOnly
                  ? 'border-warning/50 bg-warning-soft text-warning'
                  : 'border-border hover:bg-muted hover:text-foreground',
              )}
              title="Favorites only"
            >
              <Icon name="star" className="h-3 w-3" />
              Favorites
            </button>
            <span>
              <span className="tabular font-medium text-foreground">{items.length}</span> of {total}
            </span>
            {folder && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
                <Icon name="folder" className="h-3 w-3 shrink-0" />
                <span className="truncate">{folder}</span>
              </span>
            )}
            {filtered && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listQuery.isLoading && (
            <div className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" />
              Loading the MCP library…
            </div>
          )}
          {listQuery.isError && (
            <div className="px-4 py-8 text-center">
              <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
              <p className="mt-2 text-xs font-medium">The MCP library could not be loaded</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {errorMessage(listQuery.error)}
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void listQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
            <EmptyState
              icon="server"
              title={filtered ? 'No servers match these filters' : 'No MCP servers yet'}
              description={
                filtered
                  ? 'Try another keyword, transport, health status, or folder.'
                  : 'Create a server, import one from an Agent config, or add one from the curated catalog.'
              }
              action={
                filtered ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    New server
                  </Button>
                )
              }
            />
          )}
          {items.map((item) => (
            <McpRow
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onSelect={() => setSelectedId(item.id)}
              onToggleEnabled={(next) => {
                void ipc.mcp
                  .setEnabled({ id: item.id, enabled: next })
                  .then(() => {
                    toast.success(next ? `Enabled "${item.title}".` : `Disabled "${item.title}".`)
                    void queryClient.invalidateQueries({ queryKey: ['mcp'] })
                  })
                  .catch((error) => toast.error(`Enabled state not saved: ${errorMessage(error)}`))
              }}
            />
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden bg-background/30">
        {detailQuery.isLoading && selectedId && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Loading server details…
          </div>
        )}
        {detailQuery.isError && selectedId && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon name="alert" className="h-6 w-6 text-danger" />
            <p className="text-sm font-medium">Server details could not be loaded</p>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              {errorMessage(detailQuery.error)}
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void detailQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {detailQuery.data && (
          <McpDetailPane
            server={detailQuery.data}
            onEdit={() => setEditing(detailQuery.data ?? null)}
            onDelete={() => setDeleting(detailQuery.data ?? null)}
            onVersions={() => setVersionsOf(detailQuery.data ?? null)}
            onApply={() => setApplyOf(detailQuery.data ?? null)}
          />
        )}
        {!selectedId && !detailQuery.isLoading && (
          <EmptyState
            icon="server"
            title="Select a server"
            description="Pick a server to review its redacted configuration, static health, and version history."
          />
        )}
      </div>

      <McpEditModal
        open={creating || !!editing}
        server={editing}
        folderOptions={folderPaths}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={(saved) => {
          setSelectedId(saved.id)
          setCreating(false)
          setEditing(null)
        }}
      />

      {versionsOf && <McpVersionsModal server={versionsOf} onClose={() => setVersionsOf(null)} />}
      {applyOf && <McpApplyModal server={applyOf} onClose={() => setApplyOf(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this MCP server?"
        confirmText="Delete local copy"
        message={
          <>
            <p>
              This deletes only the local copy of{' '}
              <b className="text-foreground">{deleting?.title}</b>, its versions, and its encrypted secret
              records.
            </p>
            <p className="mt-2">
              Agent configuration files are not rewritten, and repository files are not deleted. A server that
              still exists remotely may reappear on the next pull.
            </p>
          </>
        }
      />
    </div>
  )
}

function McpRow({
  item,
  active,
  onSelect,
  onToggleEnabled,
}: {
  item: McpListItem
  active: boolean
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const transport = transportMeta(item.transport)
  const health = healthStatusMeta(item.healthStatus)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'w-full cursor-pointer border-b border-border/60 px-3.5 py-2.5 text-left transition-colors focus-visible:bg-muted/50',
        active ? 'bg-primary-soft/40 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/50',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="server" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{item.title}</span>
        <Badge variant={transport.variant} className="shrink-0 font-normal">
          {transport.label}
        </Badge>
        {item.healthStatus !== 'ok' && (
          <Badge variant={health.variant} className="shrink-0 font-normal">
            <Icon name="alert" className="h-3 w-3" />
            {item.healthStatus}
          </Badge>
        )}
        {item.isFavorite && <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-warning" />}
        <span className="ml-auto shrink-0" onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={item.enabled}
            onChange={onToggleEnabled}
            label={`${item.enabled ? 'Disable' : 'Enable'} ${item.title}`}
          />
        </span>
      </div>
      <p className="mt-0.5 line-clamp-1 pl-5 text-[11px] text-muted-foreground">
        {item.description || 'No description'}
      </p>
      <div className="mt-1 flex items-center gap-1.5 overflow-hidden pl-5 text-[10px] text-muted-foreground">
        <Icon name="folder" className="h-3 w-3 shrink-0" />
        <span className="truncate">{item.folder || 'Uncategorized'}</span>
        <Badge variant={mcpSourceMeta(item.source).variant} className="shrink-0 font-normal">
          {SOURCE_LABEL[item.source]}
        </Badge>
        {!item.enabled && (
          <Badge variant="warning" className="shrink-0 font-normal">
            Disabled
          </Badge>
        )}
        {item.pendingChangeCount > 0 && (
          <Badge variant="warning" className="shrink-0 font-normal">
            pending
          </Badge>
        )}
        <span className="tabular ml-auto shrink-0">{formatDate(item.updatedAt, false)}</span>
      </div>
    </div>
  )
}

function McpDetailPane({
  server,
  onEdit,
  onDelete,
  onVersions,
  onApply,
}: {
  server: McpDetail
  onEdit: () => void
  onDelete: () => void
  onVersions: () => void
  onApply: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'config' | 'health' | 'notes'>('config')

  const healthQuery = useQuery({
    queryKey: queryKeys.mcp.health(server.id),
    queryFn: () => ipc.mcp.health({ id: server.id }),
  })

  const setEnabled = useMutation({
    mutationFn: (next: boolean) => ipc.mcp.setEnabled({ id: server.id, enabled: next }),
    onSuccess: (saved) => {
      toast.success(
        saved.enabled
          ? `Enabled "${saved.title}".`
          : `Disabled "${saved.title}". Disabled servers cannot be applied to Agent configs.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
    },
    onError: (error) => toast.error(`Enabled state not saved: ${errorMessage(error)}`),
  })

  const setFavorite = useMutation({
    mutationFn: (favorite: boolean) => ipc.mcp.setFavorite({ id: server.id, favorite }),
    onSuccess: (result) => {
      toast.success(result.isFavorite ? 'Added to favorites.' : 'Removed from favorites.')
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
    },
    onError: (error) => toast.error(`Favorite not saved: ${errorMessage(error)}`),
  })

  const transport = transportMeta(server.transport)
  const source = mcpSourceMeta(server.source)
  const effectiveHealth = healthQuery.data
  const issues = effectiveHealth?.issues ?? server.health
  const healthStatus = effectiveHealth?.status ?? server.healthStatus
  const health = healthStatusMeta(healthStatus)
  const counts = healthIssueCounts(issues)
  const repoPath = mcpRepoPath(server)

  const copy = async (value: string, label: string) => {
    const copied = await copyToClipboard(value)
    if (copied) toast.success(`${label} copied to the clipboard.`)
    else toast.error('The clipboard is not available in this window.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Icon name="server" className="text-primary" />
            <h2 className="truncate text-[17px] font-semibold leading-6 tracking-tight">{server.title}</h2>
            <Badge variant={transport.variant}>{transport.label}</Badge>
            <Badge variant={health.variant}>{health.label}</Badge>
            <Badge variant={source.variant}>{source.label}</Badge>
            {!server.enabled && <Badge variant="warning">Disabled</Badge>}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={server.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={server.isFavorite}
              onClick={() => setFavorite.mutate(!server.isFavorite)}
            >
              <Icon name="star" className={server.isFavorite ? 'fill-warning/20 text-warning' : ''} />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border/80" />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete MCP server"
              title="Delete"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {server.description || 'No description.'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Badge variant="secondary" className="gap-1 font-normal">
            <Icon name="folder" className="h-3 w-3" />
            {server.folder || 'Uncategorized'}
          </Badge>
          <Icon name="gitBranch" className="h-3 w-3 shrink-0" />
          <span className="shrink-0">Repo file</span>
          <code className="min-w-0 truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
            {repoPath}
          </code>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Copy repository path"
            onClick={() => void copy(repoPath, 'Repository path')}
          >
            <Icon name="copy" className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            disabled={!server.enabled}
            title={server.enabled ? 'Preview and apply to Agent configs' : 'Disabled servers cannot be applied'}
            onClick={onApply}
          >
            <Icon name="send" className="h-3.5 w-3.5" />
            Apply to Agents
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Icon name="pencil" className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onVersions}>
            <Icon name="history" className="h-3.5 w-3.5" />
            Versions ({server.versionCount})
          </Button>
          <div className="flex items-center gap-1.5 pl-1">
            <Switch
              checked={server.enabled}
              onChange={(next) => setEnabled.mutate(next)}
              disabled={setEnabled.isPending}
              label={server.enabled ? 'Disable server' : 'Enable server'}
            />
            <span className="text-[11px] text-muted-foreground">
              {server.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {!server.enabled && (
            <span className="text-[10.5px] text-warning">
              Enable this server before applying it to Agent configs.
            </span>
          )}
          {server.tags.map((tag) => (
            <Badge key={tag} variant="primary" className="font-normal">
              #{tag}
            </Badge>
          ))}
          <span className="tabular ml-auto text-[10.5px] text-muted-foreground">
            Updated {formatDate(server.updatedAt)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-5 border-b border-border px-5 pt-2.5">
        {(
          [
            { value: 'config', label: 'Configuration' },
            { value: 'health', label: `Health (${issues.length})` },
            { value: 'notes', label: 'Notes' },
          ] as const
        ).map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setTab(entry.value)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-0.5 pb-2.5 pt-1.5 text-[13px] transition-colors',
              tab === entry.value
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === 'config' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copy(mcpConfigPreview(server), 'Redacted config')}
              >
                <Icon name="copy" className="h-3.5 w-3.5" />
                Copy config
              </Button>
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Icon name="pencil" className="h-3.5 w-3.5" />
                Edit configuration
              </Button>
              <span className="ml-auto text-[10.5px] text-muted-foreground">
                Credentials are redacted at the data boundary
              </span>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
              {mcpConfigPreview(server)}
            </pre>
            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {SECRET_STORAGE_NOTICE} The repository file stores only placeholders for credential-like fields.
            </p>
            {server.requiredEnv.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Required environment keys</div>
                <div className="flex flex-wrap gap-1.5">
                  {server.requiredEnv.map((key) => (
                    <Badge key={key} variant="warning" className="font-mono">
                      {key}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'health' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={health.variant}>{health.label}</Badge>
              <span className="text-[11px] text-muted-foreground">
                {counts.errors} errors · {counts.warnings} warnings
                {effectiveHealth ? ` · checked ${formatDate(effectiveHealth.checkedAt)}` : ''}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={healthQuery.isFetching}
                onClick={() => void healthQuery.refetch()}
              >
                <Icon
                  name="refresh"
                  className={cn('h-3.5 w-3.5', healthQuery.isFetching && 'animate-spin')}
                />
                Re-check
              </Button>
            </div>
            <p className="flex items-start gap-1.5 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">
              <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {STATIC_HEALTH_NOTICE}
            </p>
            {healthQuery.isError && (
              <p className="text-xs text-danger">
                Health could not be refreshed: {errorMessage(healthQuery.error)}
              </p>
            )}
            {issues.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-xs text-success">
                <Icon name="check" className="h-4 w-4" />
                No static issues were found for this configuration.
              </div>
            ) : (
              issues.map((issue, index) => (
                <div
                  key={`${issue.field}-${index}`}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                    issue.level === 'error'
                      ? 'border-danger/30 bg-danger-soft'
                      : 'border-warning/30 bg-warning-soft',
                  )}
                >
                  <Icon
                    name="alert"
                    className={cn(
                      'mt-0.5',
                      issue.level === 'error' ? 'text-danger' : 'text-warning',
                    )}
                  />
                  <div className="min-w-0">
                    <span className="font-mono text-xs">{issue.field}</span>
                    <p className="text-xs leading-5">{issue.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-2">
            {server.notes ? (
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-6 text-foreground/90">
                {server.notes}
              </p>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                No notes were added. Notes are versioned with the configuration and are edited in the server
                editor.
              </p>
            )}
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
              Edit notes
            </Button>
            <p className="text-[11px] leading-5 text-muted-foreground">
              Saving notes creates a new revision. Agent configuration files are not rewritten until the
              server is applied again.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function McpVersionsModal({ server, onClose }: { server: McpDetail; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [restoring, setRestoring] = useState(false)

  const versions = useQuery({
    queryKey: queryKeys.mcp.versions(server.id),
    queryFn: () => ipc.mcp.versions(server.id),
  })

  const restore = async (revisionId: string) => {
    setRestoring(true)
    try {
      await ipc.mcp.restoreVersion({
        id: server.id,
        revisionId,
        expectedRevisionId: server.currentRevisionId,
      })
      toast.success(
        'Version restored as a new revision. Agent config files are not rewritten; apply the server again.',
      )
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      onClose()
    } catch (error) {
      toast.error(`Restore failed: ${errorMessage(error)}`)
    } finally {
      setRestoring(false)
    }
  }

  if (versions.isError) {
    return (
      <Modal
        open
        onClose={onClose}
        title={`Version history — ${server.title}`}
        width="max-w-md"
        footer={
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="text-xs leading-5 text-danger">
          Version history could not be loaded: {errorMessage(versions.error)}
        </p>
      </Modal>
    )
  }

  return (
    <VersionHistoryModal
      open
      onClose={onClose}
      title={`Version history — ${server.title}`}
      versions={versions.data ?? []}
      currentRevisionId={server.currentRevisionId}
      loading={versions.isLoading}
      restorePending={restoring}
      onRestore={(revisionId) => {
        if (restoring) return
        void restore(revisionId)
      }}
    />
  )
}

type AgentTargetState = 'missing' | 'managed' | 'drifted' | 'unknown' | 'external'

function agentTargetState(agent: AgentMcpState, server: McpDetail): AgentTargetState {
  const names = serverMatchNames(server)
  const entry = agent.servers.find((candidate) => names.includes(candidate.name))
  if (!entry) return 'missing'
  if (!entry.managed) return 'external'
  if (entry.drift === 'modified') return 'drifted'
  if (entry.drift === 'unknown') return 'unknown'
  return 'managed'
}

function agentStateMeta(state: AgentTargetState): { label: string; variant: 'success' | 'warning' | 'danger' | 'outline' } {
  switch (state) {
    case 'managed':
      return { label: 'Managed · synced', variant: 'success' }
    case 'drifted':
      return { label: 'Drifted', variant: 'danger' }
    case 'unknown':
      return { label: 'Drift unknown', variant: 'warning' }
    case 'external':
      return { label: 'External entry', variant: 'warning' }
    default:
      return { label: 'Not created', variant: 'outline' }
  }
}

function McpApplyModal({ server, onClose }: { server: McpDetail; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<McpApplyPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeAgent, setRemoveAgent] = useState<AgentMcpState | null>(null)
  const initialized = useRef(false)

  const agentsQuery = useQuery({
    queryKey: ['mcp', 'agentState'],
    queryFn: () => ipc.mcp.agentState({}),
  })

  useEffect(() => {
    if (!agentsQuery.data || initialized.current) return
    initialized.current = true
    const existing = agentsQuery.data.filter((agent) => agent.exists).map((agent) => agent.agentId)
    setSelected(existing.length ? existing : agentsQuery.data.map((agent) => agent.agentId))
  }, [agentsQuery.data])

  const selectionKey = selected.slice().sort().join(',')
  useEffect(() => {
    setPreview(null)
  }, [selectionKey])

  const toggle = (agentId: string) => {
    setSelected((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    )
  }

  const startPreview = async () => {
    if (!selected.length) return
    setPreviewing(true)
    setError(null)
    setPreview(null)
    try {
      const result = await ipc.mcp.apply({
        serverIds: [server.id],
        agentIds: selected,
        confirm: false,
      })
      if (result.phase === 'preview') setPreview(result)
      else setError('The backend did not return an apply preview.')
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setPreviewing(false)
    }
  }

  const confirmApply = async () => {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      await ipc.mcp.apply({
        serverIds: [server.id],
        agentIds: selected,
        confirm: true,
        previewToken: preview.previewToken,
        acknowledgePlaintextAtRest: true,
      })
      toast.success('Apply started. Progress and per-target results appear in the operation panel.')
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      onClose()
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setApplying(false)
    }
  }

  const remove = useMutation({
    mutationFn: (agentId: string) =>
      ipc.mcp.remove({ serverIds: [server.id], agentIds: [agentId], confirm: true }),
    onSuccess: () => {
      toast.success('Remove started. The per-target result appears in the operation panel.')
      setPreview(null)
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
    },
    onError: (errorValue) => toast.error(`Remove failed: ${errorMessage(errorValue)}`),
  })

  const driftWarning = preview
    ? preview.targets.some((target) => target.entries.some((entry) => entry.drift))
    : false

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width="max-w-2xl"
        title={`Apply to Agents — ${server.title}`}
        subtitle="Preview the exact target entries, then confirm. Preview values are redacted."
        footer={
          <>
            <div className="mr-auto min-w-0">
              {error && <p className="truncate text-xs text-danger">{error}</p>}
            </div>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {preview ? (
              <Button
                disabled={!acknowledged || applying || selected.length === 0}
                onClick={() => void confirmApply()}
              >
                {applying ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" className="h-3.5 w-3.5" />}
                Confirm apply
              </Button>
            ) : (
              <Button
                disabled={!selected.length || previewing || !server.enabled}
                onClick={() => void startPreview()}
              >
                {previewing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="eye" className="h-3.5 w-3.5" />}
                Preview apply
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {!server.enabled && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              This server is disabled. Disabled servers cannot be applied or re-synced. Enable it in the
              library first.
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">Target Agent configs</h3>
              <span className="text-[11px] text-muted-foreground">{selected.length} selected</span>
            </div>
            {agentsQuery.isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5" />
                Reading Agent configuration files…
              </div>
            )}
            {agentsQuery.isError && (
              <p className="text-xs text-danger">
                Agent configurations could not be read: {errorMessage(agentsQuery.error)}
              </p>
            )}
            <div className="space-y-1.5">
              {(agentsQuery.data ?? []).map((agent) => {
                const state = agentTargetState(agent, server)
                const meta = agentStateMeta(state)
                const active = selected.includes(agent.agentId)
                const removable = state === 'managed' || state === 'drifted' || state === 'unknown'
                return (
                  <div
                    key={agent.agentId}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      active ? 'border-primary/50 bg-primary-soft/40' : 'border-border',
                      !server.enabled && 'opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 cursor-pointer"
                      checked={active}
                      disabled={!server.enabled}
                      onChange={() => toggle(agent.agentId)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-medium">{agent.agentName}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <Badge variant="outline">{agentFormatLabel(agent.format)}</Badge>
                        {!agent.exists && <Badge variant="secondary">Config missing</Badge>}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {agent.configPath}
                      </div>
                    </div>
                    {removable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-danger"
                        disabled={!server.enabled}
                        onClick={() => setRemoveAgent(agent)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )
              })}
              {agentsQuery.isSuccess && (agentsQuery.data ?? []).length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No Agent MCP configurations were detected on this machine.
                </p>
              )}
            </div>
          </div>

          {preview && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Preview</h3>
                <Badge variant="outline">Redacted</Badge>
                <span className="text-[10.5px] text-muted-foreground">
                  Secret values are replaced with placeholders
                </span>
              </div>
              {preview.targets.map((target) => (
                <div key={target.agentId} className="rounded-md border border-border bg-card px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium">{target.agentName}</span>
                    <Badge variant="outline">{agentFormatLabel(target.format)}</Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {target.configPath}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {target.entries.map((entry) => {
                      const action = applyActionMeta(entry.action)
                      return (
                        <div key={entry.serverId} className="rounded border border-border/70 bg-muted/30 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[11px]">{entry.serverName}</span>
                            <Badge variant={action.variant}>{action.label}</Badge>
                            {entry.drift && <Badge variant="danger">Drifted entry</Badge>}
                          </div>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/70 p-2 font-mono text-[10px] leading-4">
                            {mcpApplyEntryPreview(entry.redactedEntry)}
                          </pre>
                        </div>
                      )
                    })}
                  </div>
                  {target.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-4 text-warning">
                      {target.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {driftWarning && (
                <p className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-[11px] leading-5 text-danger">
                  At least one managed entry was edited by hand. Bulk apply does not overwrite drifted
                  entries; review that Agent configuration first.
                </p>
              )}

              <div className="space-y-2 border-t border-border/70 pt-2">
                <p className="flex items-start gap-1.5 text-[11px] leading-5 text-warning">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {PLAINTEXT_AT_REST_NOTICE}
                </p>
                <Checkbox
                  checked={acknowledged}
                  onChange={setAcknowledged}
                  label={
                    <span className="text-[11px] leading-5">
                      I understand real secret values will be stored in the target Agent configuration file.
                    </span>
                  }
                />
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removeAgent}
        onClose={() => setRemoveAgent(null)}
        onConfirm={() => {
          if (removeAgent) remove.mutate(removeAgent.agentId)
        }}
        title="Remove this managed entry?"
        confirmText="Remove entry"
        message={
          <>
            This deletes only the entry managed by Prompt Keeper in{' '}
            <code className="break-all font-mono text-xs">{removeAgent?.configPath}</code>. External entries
            and unrelated keys are preserved. The library copy is unchanged.
          </>
        }
      />
    </>
  )
}

export function McpStoreTab({ query, onAdded }: { query: string; onAdded: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [detail, setDetail] = useState<McpStoreItem | null>(null)

  const store = useQuery({
    queryKey: ['mcp', 'store', query.trim()],
    queryFn: () => ipc.mcp.storeList({ search: query.trim() || undefined, limit: 100 }),
  })

  const library = useQuery({
    queryKey: queryKeys.mcp.list({ scope: 'store-check', limit: 200 }),
    queryFn: () => ipc.mcp.list({ limit: 200 }),
  })

  const libraryTitles = useMemo(
    () => new Set((library.data?.items ?? []).map((item) => item.title)),
    [library.data],
  )

  const add = useMutation({
    mutationFn: (item: McpStoreItem) =>
      ipc.mcp.create({
        title: item.name,
        description: item.description,
        transport: item.transport,
        ...(item.transport === 'stdio'
          ? { command: item.command ?? '', args: item.args ?? [] }
          : { url: item.url ?? '' }),
        env: Object.fromEntries(item.envDocs.map((doc) => [doc.key, ''])),
        requiredEnv: item.envDocs.map((doc) => doc.key),
        folder: 'store',
        tags: ['store'],
        notes:
          'Added from the curated demo catalog. Fill the required environment values before applying it to an Agent; credentials stay encrypted locally.',
        source: 'market',
      }),
    onSuccess: (created) => {
      toast.success(
        `Added "${created.title}". Fill the required environment values, then review its static health.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      setDetail(null)
      onAdded()
    },
    onError: (error) => {
      if (isIpcError(error) && error.code === 'CONFLICT') {
        toast.error('A server with this name already exists. Rename or delete the existing entry first.')
        return
      }
      toast.error(`Could not add the server: ${errorMessage(error)}`)
    },
  })

  if (store.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Loading the curated MCP catalog…
      </div>
    )
  }

  if (store.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Icon name="alert" className="h-6 w-6 text-danger" />
        <p className="text-sm font-medium">The curated catalog could not be loaded</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">{errorMessage(store.error)}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void store.refetch()}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  const items = store.data?.items ?? []

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="info" className="font-normal">
          Curated demo catalog
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Bundled with the app · no live registry is contacted · secrets are never included
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">{items.length} servers</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching catalog entries"
          description={
            query.trim()
              ? 'Try another keyword.'
              : 'The curated MCP catalog is empty in this build.'
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const transport = transportMeta(item.transport)
            const installed = libraryTitles.has(item.name)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDetail(item)}
                className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft text-primary">
                    <Icon name="server" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-5">{item.name}</div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      {item.transport === 'stdio' ? item.installCommand : 'Remote HTTP server'}
                    </div>
                  </div>
                  <Badge variant={transport.variant} className="shrink-0 font-normal">
                    {transport.label}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">
                  {item.description}
                </p>
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2.5">
                  {item.envDocs.length > 0 ? (
                    <Badge variant="warning" className="font-normal">
                      Needs {item.envDocs.length} env values
                    </Badge>
                  ) : (
                    <Badge variant="success" className="font-normal">
                      No env values
                    </Badge>
                  )}
                  {installed && (
                    <Badge variant="outline" className="font-normal">
                      In library
                    </Badge>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Review
                    <Icon name="arrowRight" className="h-3 w-3" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {detail && (
        <McpStoreDetail
          item={detail}
          installed={libraryTitles.has(detail.name)}
          pending={add.isPending}
          onClose={() => setDetail(null)}
          onAdd={() => add.mutate(detail)}
        />
      )}
    </div>
  )
}

function McpStoreDetail({
  item,
  installed,
  pending,
  onClose,
  onAdd,
}: {
  item: McpStoreItem
  installed: boolean
  pending: boolean
  onClose: () => void
  onAdd: () => void
}) {
  const transport = transportMeta(item.transport)
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={
        <span className="flex items-center gap-2">
          {item.name}
          <Badge variant={transport.variant}>{transport.label}</Badge>
          <Badge variant="info">Curated demo</Badge>
        </span>
      }
      subtitle={item.description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={installed || pending} onClick={onAdd}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
            {installed ? 'Already in library' : 'Add to library'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2.5 text-[11px] leading-5 text-info">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Curated demo catalog entry. Adding it creates a local server with empty environment placeholders;
          no secret is included, and the Agent configuration is untouched until you apply it.
        </div>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">What it does</h3>
          <p className="leading-6 text-foreground/90">{item.whatItDoes}</p>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Use cases</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {item.useCases.map((useCase) => (
              <li key={useCase}>{useCase}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Install command</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs">
            {item.installCommand}
          </pre>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Transport configuration</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs">
            {JSON.stringify(
              item.transport === 'stdio'
                ? { command: item.command ?? '', args: item.args ?? [] }
                : { url: item.url ?? '' },
              null,
              2,
            )}
          </pre>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Required environment variables</h3>
          {item.envDocs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No extra variables are documented.</p>
          ) : (
            <div className="space-y-2">
              {item.envDocs.map((doc) => (
                <div key={doc.key} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{doc.key}</code>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      placeholder: {doc.placeholder}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{doc.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
