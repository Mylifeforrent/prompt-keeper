import { useState } from 'react'
import type { AgentRuntime, Deployment, FanoutStatus, InstallMode } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Switch } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { AGENT_RUNTIMES } from '../../data/syncSeed'
import { DEPLOY_META, deploymentTone } from '../../lib/sync'

interface AssetRow {
  kind: 'skill' | 'mcp'
  id: string
  name: string
  version: string
  description: string
}

export function SyncDeploy() {
  const { state, redetectAgents, syncAllStale } = useStore()
  const toast = useToast()
  const [kindFilter, setKindFilter] = useState<'all' | 'skill' | 'mcp'>('all')
  const [showAll, setShowAll] = useState(false)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [cell, setCell] = useState<{ asset: AssetRow; agent: AgentRuntime } | null>(null)

  const allAssets: AssetRow[] = [
    ...state.skills.map((s) => ({
      kind: 'skill' as const,
      id: s.id,
      name: s.name,
      version: `v${s.version}`,
      description: s.description,
    })),
    ...state.mcps.map((m) => ({
      kind: 'mcp' as const,
      id: m.id,
      name: m.name,
      version: `v${m.versions[0]?.version ?? 1}`,
      description: m.description,
    })),
  ]

  const agents = AGENT_RUNTIMES.filter((a) => {
    if (!showAll && !state.detectedAgents.includes(a.id)) return false
    if (kindFilter === 'skill') return a.supportsSkills
    if (kindFilter === 'mcp') return a.supportsMcp
    return true
  })

  const statusOf = (asset: AssetRow, agentId: string): FanoutStatus =>
    state.deployments.find((d) => d.kind === asset.kind && d.assetId === asset.id && d.agentId === agentId)?.status ??
    'missing'

  const assets = allAssets
    .filter((a) => kindFilter === 'all' || a.kind === kindFilter)
    .filter((a) => {
      if (!onlyAttention) return true
      return agents.some((ag) => {
        const st = statusOf(a, ag.id)
        return st === 'stale' || st === 'drifted'
      })
    })

  const staleTotal = state.deployments.filter(
    (d) => d.status === 'stale' && !(d.kind === 'mcp' && state.mcps.find((m) => m.id === d.assetId)?.enabled === false),
  ).length
  const driftedTotal = state.deployments.filter((d) => d.status === 'drifted').length

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="send" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Dispatch is <b>one-way</b>: local library → each Agent's default directory, never written back to the repo.
          Files edited by hand inside an Agent are marked <b>Drifted</b> and are never overwritten by batch sync; each needs individual confirmation.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { v: 'all', label: 'All' },
              { v: 'skill', label: 'Skills' },
              { v: 'mcp', label: 'MCP' },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setKindFilter(t.v)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium',
                kindFilter === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Checkbox checked={onlyAttention} onChange={setOnlyAttention} label={<span className="text-xs">Issues only</span>} />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={showAll} onChange={setShowAll} label="Show undetected Agents" />
          Show undetected Agents
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Detected {state.detectedAgents.length} · Stale {staleTotal} · Drifted {driftedTotal}
        </span>
        <Button size="sm" variant="outline" onClick={() => toast.info(`Detection complete: ${redetectAgents().length} Agents`)}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Redetect
        </Button>
        <Button
          size="sm"
          disabled={staleTotal === 0}
          onClick={() => {
            syncAllStale()
            toast.success(`Redistributed ${staleTotal} stale assets; drifted items were not overwritten`)
          }}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Sync all stale ({staleTotal})
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-10 min-w-[210px] bg-card px-3 py-2.5 text-xs font-medium">Asset</th>
              {agents.map((a) => (
                <th key={a.id} className="min-w-[112px] px-2 py-2.5 text-xs font-medium">
                  <div className="flex items-center gap-1">
                    {a.name}
                    {state.detectedAgents.includes(a.id) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-success" title="Detected on this machine" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-border" title="Not detected" />
                    )}
                  </div>
                  <div className="mt-0.5 max-w-[104px] truncate font-mono text-[9px] font-normal text-muted-foreground">
                    {a.skillDir || a.mcpFile}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={`${asset.kind}-${asset.id}`} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon name={asset.kind === 'skill' ? 'grid' : 'server'} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{asset.name}</span>
                        <span className="text-[10px] text-muted-foreground">{asset.version}</span>
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">{asset.description}</div>
                    </div>
                  </div>
                </td>
                {agents.map((agent) => {
                  const supported = asset.kind === 'skill' ? agent.supportsSkills : agent.supportsMcp
                  if (!supported) {
                    return (
                      <td key={agent.id} className="px-2 py-2">
                        <span className="text-[10px] text-muted-foreground">Unsupported</span>
                      </td>
                    )
                  }
                  const st = statusOf(asset, agent.id)
                  const meta = DEPLOY_META[st]
                  return (
                    <td key={agent.id} className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setCell({ asset, agent })}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors',
                          st === 'synced' && 'border-success/30 bg-success-soft text-success',
                          st === 'stale' && 'border-warning/30 bg-warning-soft text-warning',
                          st === 'drifted' && 'border-danger/30 bg-danger-soft text-danger',
                          st === 'missing' && 'border-dashed border-border text-muted-foreground hover:bg-muted',
                          st === 'paused' && 'border-border bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon name={meta.icon} className="h-3 w-3" />
                        {meta.label}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {assets.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
          No assets match the current filter.
        </p>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        Published as symlinks by default, so library edits take effect immediately; when the filesystem does not support them, it falls back to copy with per-item prompts.
        Target paths follow each tool's conventions, and disabled MCP servers cannot be dispatched.
      </p>

      {cell && <DeploymentModal asset={cell.asset} agent={cell.agent} onClose={() => setCell(null)} />}
    </div>
  )
}

function DeploymentModal({
  asset,
  agent,
  onClose,
}: {
  asset: AssetRow
  agent: AgentRuntime
  onClose: () => void
}) {
  const { state, deployAsset, syncDeployment, setDeploymentMode, removeDeployment, rollbackDeployment } = useStore()
  const toast = useToast()
  const deployment = state.deployments.find(
    (d) => d.kind === asset.kind && d.assetId === asset.id && d.agentId === agent.id,
  )
  const status: FanoutStatus = deployment?.status ?? 'missing'
  const meta = DEPLOY_META[status]
  const [mode, setMode] = useState<InstallMode>(deployment?.mode ?? 'symlink')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const targetPath = asset.kind === 'skill' ? `${agent.skillDir}/${asset.name}/` : agent.mcpFile

  const mcp = asset.kind === 'mcp' ? state.mcps.find((m) => m.id === asset.id) : undefined
  const mcpDisabled = !!mcp && !mcp.enabled
  const mcpPreview = mcp
    ? JSON.stringify(
        {
          mcpServers: {
            [mcp.name]: {
              ...(mcp.transport === 'stdio'
                ? { command: mcp.command, args: mcp.args }
                : { url: mcp.url, headers: mcp.headers }),
              env: Object.fromEntries(Object.keys(mcp.env ?? {}).map((k) => [k, '[REDACTED]'])),
            },
          },
        },
        null,
        2,
      )
    : ''

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width="max-w-xl"
        title={`${asset.name} → ${agent.name}`}
        subtitle={`${asset.kind === 'skill' ? 'Skill' : 'MCP'} ${asset.version} · Dispatch is one-way and never modifies the repo`}
        footer={
          <>
            {deployment && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" className="h-3.5 w-3.5" />
                Remove dispatch
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              disabled={mcpDisabled}
              title={mcpDisabled ? 'Disabled MCP cannot be dispatched; enable it in "My MCP" first' : ''}
              onClick={() => {
                if (deployment) {
                  syncDeployment(deployment.id)
                  toast.success(`Resynced ${asset.name} → ${agent.name} (${mode})`)
                } else {
                  deployAsset(asset.kind, asset.id, agent.id, mode)
                  toast.success(`Dispatched ${asset.name} → ${agent.name} (${mode})`)
                }
              }}
            >
              <Icon name="send" />
              {deployment ? 'Resync' : 'Dispatch to this Agent'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant}>
              <Icon name={meta.icon} className="h-3 w-3" />
              {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {deployment
                ? `Current ${deployment.deployedVersion} · deployed ${formatDate(deployment.deployedAt)}`
                : 'This asset is not in this Agent directory yet'}
            </span>
          </div>

          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Target path</div>
            <div className="mt-0.5 break-all font-mono text-xs">{targetPath}</div>
          </div>

          {mcpDisabled && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The service "{asset.name}" is disabled and cannot be dispatched or resynced. Enable it in "My MCP" first.
            </div>
          )}

          {deployment?.note && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {deployment.note}
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Install mode</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { v: 'symlink', title: 'symlink (recommended)', desc: 'Library edits take effect immediately; multiple tools share one copy' },
                  { v: 'copy', title: 'copy', desc: 'Each Agent gets its own copy; redistribute after updates' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => {
                    setMode(o.v)
                    if (deployment) setDeploymentMode(deployment.id, o.v)
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    mode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="text-xs font-medium">{o.title}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {mcp && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Written content preview
                <Badge variant="outline">
                  <Icon name="lock" className="h-3 w-3" />
                  Credentials [REDACTED]
                </Badge>
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[11px] leading-5">
                {mcpPreview}
              </pre>
              <p className="mt-1 text-[10px] text-muted-foreground">
                The real secret is decrypted from the local keychain and injected at write time; it never enters logs, version snapshots, or the repo.
              </p>
            </div>
          )}

          {deployment && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="text-[11px] text-muted-foreground">Last updated {relativeTime(deployment.deployedAt)}</span>
              {deployment.previousVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    rollbackDeployment(deployment.id)
                    toast.warning(`Rolled back to ${deployment.previousVersion}; the local library and repo are unchanged`)
                  }}
                >
                  <Icon name="undo" className="h-3.5 w-3.5" />
                  Roll back to {deployment.previousVersion}
                </Button>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (deployment) {
            removeDeployment(deployment.id)
            toast.success(`Removed ${asset.name} from ${agent.name}; the local library and repo are unaffected`)
          }
          onClose()
        }}
        title="Remove dispatch?"
        confirmText="Remove"
        message={`This deletes the contents under ${targetPath} (prototype simulation). The local asset library and Git repo are unaffected.`}
      />
    </>
  )
}
