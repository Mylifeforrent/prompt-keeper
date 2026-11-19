import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentMcpState,
  McpImportApplied,
  McpImportPreview,
} from '../../../shared/contracts'
import { Badge, Button, EmptyState, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { useToast } from '../../components/ui/toast'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc } from '../../lib/ipc'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { agentFormatLabel, transportMeta } from '../../lib/viewModels/mcp'

/**
 * Read-only view of every detected Agent MCP configuration with reverse import.
 * Prompt Keeper never writes to these files from this tab; import moves the
 * selected entries into the local library and encrypted secret storage.
 */
export function AgentMcpTab() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Record<string, string[]>>({})
  const [importPreview, setImportPreview] = useState<{
    agent: AgentMcpState
    preview: McpImportPreview
  } | null>(null)
  const [applied, setApplied] = useState<McpImportApplied | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agentsQuery = useQuery({
    queryKey: ['mcp', 'agentState'],
    queryFn: () => ipc.mcp.agentState({}),
  })

  const agents = agentsQuery.data ?? []
  const totals = useMemo(() => {
    const managed = agents.reduce(
      (sum, agent) => sum + agent.servers.filter((server) => server.managed).length,
      0,
    )
    const external = agents.reduce(
      (sum, agent) => sum + agent.servers.filter((server) => !server.managed).length,
      0,
    )
    return { managed, external }
  }, [agents])

  const selectedFor = (agentId: string) => selection[agentId] ?? []

  const toggle = (agentId: string, serverName: string) => {
    setSelection((current) => {
      const selected = current[agentId] ?? []
      return {
        ...current,
        [agentId]: selected.includes(serverName)
          ? selected.filter((name) => name !== serverName)
          : [...selected, serverName],
      }
    })
  }

  const startPreview = async (agent: AgentMcpState) => {
    const serverNames = selectedFor(agent.agentId)
    if (!serverNames.length) return
    setPreviewing(agent.agentId)
    setError(null)
    setApplied(null)
    try {
      const result = await ipc.mcp.importExternal({
        agentId: agent.agentId,
        serverNames,
        confirm: false,
      })
      if (result.phase === 'preview') setImportPreview({ agent, preview: result })
      else setApplied(result)
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setPreviewing(null)
    }
  }

  const applyImport = async () => {
    if (!importPreview) return
    setApplying(true)
    setError(null)
    try {
      const result = await ipc.mcp.importExternal({
        agentId: importPreview.agent.agentId,
        serverNames: importPreview.preview.entries.map((entry) => entry.name),
        confirm: true,
        previewToken: importPreview.preview.previewToken,
      })
      if (result.phase === 'applied') {
        setApplied(result)
        setImportPreview(null)
        setSelection((current) => ({ ...current, [importPreview.agent.agentId]: [] }))
        toast.success(
          `Imported ${result.imported.length} server${result.imported.length === 1 ? '' : 's'}. Secret values now live in encrypted local storage.`,
        )
        void queryClient.invalidateQueries({ queryKey: ['mcp'] })
        void queryClient.invalidateQueries({ queryKey: ['mcp', 'agentState'] })
        void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      }
    } catch (errorValue) {
      setError(errorMessage(errorValue))
    } finally {
      setApplying(false)
    }
  }

  const refresh = useMutation({
    mutationFn: () => ipc.mcp.agentState({}),
    onSuccess: (data) => {
      queryClient.setQueryData(['mcp', 'agentState'], data)
      toast.success('Agent MCP configuration re-read from disk.')
    },
    onError: (errorValue) => toast.error(`Could not re-read Agent configs: ${errorMessage(errorValue)}`),
  })

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-info/25 bg-info-soft px-3.5 py-2.5 text-[11px] leading-5 text-info">
        <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          Entries written by Prompt Keeper are managed; everything else is external. Reverse import previews
          each entry redacted, then moves selected secret values into encrypted storage. This view never
          rewrites Agent files.
        </span>
        <span className="tabular shrink-0">
          {totals.managed} managed · {totals.external} external
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <Icon name="refresh" className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
          Re-read
        </Button>
      </div>

      {error && !importPreview && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {agentsQuery.isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Reading Agent MCP configuration files…
        </div>
      )}

      {agentsQuery.isError && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Icon name="alert" className="h-6 w-6 text-danger" />
          <p className="text-sm font-medium">Agent configurations could not be read</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {errorMessage(agentsQuery.error)}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void agentsQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!agentsQuery.isLoading && !agentsQuery.isError && agents.length === 0 && (
        <EmptyState
          icon="server"
          title="No Agent MCP configurations were found"
          description="Prompt Keeper looks for known Agent config formats (JSON, JSONC, TOML). Install an Agent or add an MCP entry, then re-read."
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {agents.map((agent) => {
          const external = agent.servers.filter((server) => !server.managed)
          const managed = agent.servers.filter((server) => server.managed)
          const selected = selectedFor(agent.agentId)
          return (
            <div
              key={agent.agentId}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-primary">
                  <Icon name="server" className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.agentName}</span>
                <Badge variant="outline">{agentFormatLabel(agent.format)}</Badge>
                {agent.exists ? (
                  <Badge variant="success">Config found</Badge>
                ) : (
                  <Badge variant="outline">Config missing</Badge>
                )}
              </div>
              <div className="mt-2 truncate rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {agent.configPath}
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-1.5">
                {agent.servers.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
                    This configuration has no MCP servers.
                  </p>
                )}
                {managed.map((server) => {
                  const transport = transportMeta(server.transport)
                  return (
                    <div key={`managed-${server.name}`} className="rounded-lg border border-border/80 px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-success" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{server.name}</span>
                        <Badge variant={transport.variant}>{transport.label}</Badge>
                        <Badge variant="success">Managed</Badge>
                        {server.drift === 'modified' && <Badge variant="danger">Drifted</Badge>}
                        {server.drift === 'unknown' && <Badge variant="warning">Drift unknown</Badge>}
                      </div>
                      <RedactedConfig config={server.redactedConfig} />
                    </div>
                  )
                })}
                {external.map((server) => {
                  const transport = transportMeta(server.transport)
                  const checked = selected.includes(server.name)
                  return (
                    <div
                      key={`external-${server.name}`}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 transition-colors',
                        checked ? 'border-primary/50 bg-primary-soft/40' : 'border-border/80',
                      )}
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                          checked={checked}
                          onChange={() => toggle(agent.agentId, server.name)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-[12.5px]">{server.name}</span>
                            <Badge variant={transport.variant}>{transport.label}</Badge>
                            <Badge variant="warning">External</Badge>
                          </span>
                        </span>
                      </label>
                      <RedactedConfig config={server.redactedConfig} />
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
                <span className="text-[10.5px] text-muted-foreground">
                  {external.length} external · {managed.length} managed
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={selected.length === 0 || previewing === agent.agentId}
                  onClick={() => void startPreview(agent)}
                >
                  {previewing === agent.agentId ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Icon name="download" className="h-3.5 w-3.5" />
                  )}
                  Review import
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {importPreview && (
        <Modal
          open
          onClose={() => {
            setImportPreview(null)
            setError(null)
          }}
          width="max-w-2xl"
          title={`Import from ${importPreview.agent.agentName}`}
          subtitle="Preview is redacted. Applying moves the selected secret values into encrypted local storage."
          footer={
            <>
              <div className="mr-auto min-w-0">
                {error && <p className="truncate text-xs text-danger">{error}</p>}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setImportPreview(null)
                  setError(null)
                }}
              >
                Cancel
              </Button>
              <Button disabled={applying} onClick={() => void applyImport()}>
                {applying ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
                Import {importPreview.preview.entries.length} server
                {importPreview.preview.entries.length === 1 ? '' : 's'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="flex items-start gap-1.5 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">
              <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Secret keys are moved to encrypted storage. The imported entry is marked Imported and can be
              reviewed before it is applied anywhere.
            </p>
            <div className="truncate rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {importPreview.agent.configPath}
            </div>
            {importPreview.preview.entries.map((entry) => {
              const transport = transportMeta(entry.transport)
              return (
                <div key={entry.name} className="rounded-lg border border-border">
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
                    <span className="text-[12.5px] font-medium">{entry.name}</span>
                    <Badge variant={transport.variant}>{transport.label}</Badge>
                    {entry.secretKeys.length > 0 && (
                      <Badge variant="warning">{entry.secretKeys.length} secrets</Badge>
                    )}
                  </div>
                  <div className="space-y-2 px-3 py-2">
                    {entry.secretKeys.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {entry.secretKeys.map((key) => (
                          <Badge key={key} variant="outline" className="font-mono">
                            {key}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-4">
                      {JSON.stringify(entry.redactedConfig, null, 2)}
                    </pre>
                    {entry.warnings.length > 0 && (
                      <ul className="space-y-0.5 text-[10.5px] leading-4 text-warning">
                        {entry.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {applied && (
        <Modal
          open
          onClose={() => setApplied(null)}
          width="max-w-lg"
          title="Import complete"
          footer={<Button onClick={() => setApplied(null)}>Done</Button>}
        >
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-xs text-success">
              <Icon name="check" className="h-4 w-4" />
              Imported {applied.imported.length} server{applied.imported.length === 1 ? '' : 's'} into the
              local library.
            </p>
            <div className="space-y-1">
              {applied.imported.map((server) => (
                <div key={server.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <span className="font-medium">{server.title}</span>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {server.folder || 'Uncategorized'}
                  </span>
                  <span className="ml-2 text-[10.5px] text-muted-foreground">
                    updated {formatDate(server.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
            {applied.skipped.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
                <p className="font-medium">Skipped</p>
                <ul className="mt-1 space-y-0.5">
                  {applied.skipped.map((entry) => (
                    <li key={`${entry.name}-${entry.reason}`}>
                      {entry.name}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function RedactedConfig({ config }: { config: Record<string, unknown> }) {
  const empty = Object.keys(config).length === 0
  if (empty) return null
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none text-[10.5px] text-muted-foreground hover:text-foreground">
        Redacted config
      </summary>
      <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[10px] leading-4">
        {JSON.stringify(config, null, 2)}
      </pre>
    </details>
  )
}
