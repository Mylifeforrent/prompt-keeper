import { useState } from 'react'
import type { McpServer } from '../../types'
import { useStore } from '../../store/store'
import { MCP_TARGETS, AGENT_EXTERNAL_ENTRIES, SEED_MCP_STORE } from '../../data/seed'
import { Badge, Button, EmptyState } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { nowIso, uid } from '../../lib/utils'
import { useToast } from '../ui/toast'

/* ---------------- Agent MCP status (reverse import) ---------------- */

export function AgentMcpTab() {
  const { state, importAgentMcp } = useStore()
  const toast = useToast()

  return (
    <div className="space-y-3 p-4">
      <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3.5 py-2.5 text-[11px] leading-5 text-info">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        This view shows the current state of each Agent tool's MCP config file: entries written by this app are marked "Managed by this app", other entries are marked "External", and they can be reverse-imported into "My MCP" for unified management.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {MCP_TARGETS.map((t) => {
          const managed = state.mcps.filter((m) => m.installs[t.id])
          const external = AGENT_EXTERNAL_ENTRIES[t.id] ?? []
          return (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-primary">
                  <Icon name="server" className="h-3.5 w-3.5" />
                </span>
                <span className="text-[13px] font-medium">{t.name}</span>
                <Badge variant="outline" className="font-normal">{t.format.toUpperCase()}</Badge>
                <span className="tabular ml-auto text-[10.5px] text-muted-foreground">
                  Managed {managed.length} · External {external.length}
                </span>
              </div>
              <div className="mt-2 truncate rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">{t.file}</div>

              <div className="mt-3 space-y-1.5">
                {managed.length === 0 && external.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">No MCP config for this tool yet</p>
                )}
                {managed.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-[12.5px]">
                    <Icon name="check" className="h-3.5 w-3.5 text-success" />
                    <span className="truncate">{m.name}</span>
                    <Badge variant="success" className="ml-auto shrink-0 font-normal">
                      Managed by this app
                    </Badge>
                  </div>
                ))}
                {external.map((e) => (
                  <div key={e.name} className="flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-1.5">
                    <Icon name="externalLink" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px]">{e.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{e.hint}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto shrink-0"
                      onClick={() => {
                        importAgentMcp({
                          id: uid(),
                          name: e.name,
                          description: e.hint,
                          transport: 'stdio',
                          command: 'npx',
                          args: ['-y', e.name],
                          env: {},
                          enabled: false,
                          isFavorite: false,
                          folder: 'Imported tools',
                          tags: ['Import'],
                          source: 'import',
                          installs: {},
                          notes: `Reverse-imported from ${t.name}; disabled by default, dispatch after verifying it works`,
                          versions: [
                            {
                              id: uid(),
                              version: 1,
                              createdAt: nowIso(),
                              data: { config: JSON.stringify({ command: 'npx', args: ['-y', e.name] }, null, 2) },
                            },
                          ],
                          createdAt: nowIso(),
                          updatedAt: nowIso(),
                        })
                        toast.success(`Imported ${e.name} into "My MCP" (disabled by default)`)
                      }}
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      Import to My Library
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- MCP Store ---------------- */

export function McpStoreTab({ query, onInstalled }: { query: string; onInstalled: () => void }) {
  const { state, saveMcp } = useStore()
  const toast = useToast()
  const [detailOf, setDetailOf] = useState<McpStoreRow | null>(null)
  const q = query.trim().toLowerCase()
  const list = SEED_MCP_STORE.filter(
    (s) => !q || [s.name, s.description].join(' ').toLowerCase().includes(q),
  )
  const installedNames = new Set(state.mcps.map((m) => m.name))

  const install = (item: McpStoreRow) => {
    if (installedNames.has(item.name)) {
      toast.error(`A server named "${item.name}" already exists in My MCP (names must be unique). Rename or delete it first.`)
      return
    }
    saveMcp({
      id: uid(),
      name: item.name,
      description: item.description,
      transport: item.transport,
      command: item.command,
      args: item.args,
      url: item.url,
      env: Object.fromEntries(item.envDocs.map((e) => [e.key, ''])),
      requiredEnv: item.envDocs.map((e) => e.key),
      enabled: true,
      isFavorite: false,
      folder: 'Store templates',
      tags: ['Store'],
      source: 'market',
      installs: {},
      notes: '',
      versions: [
        {
          id: uid(),
          version: 1,
          note: `From store template v1`,
          createdAt: nowIso(),
          data: { config: JSON.stringify({ transport: item.transport, command: item.command, args: item.args, url: item.url }, null, 2) },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    toast.success(`Added "${item.name}" to My MCP; required environment variables still need values, start with the health check`)
    setDetailOf(null)
    onInstalled()
  }

  return (
    <div className="p-4">
      {list.length === 0 ? (
        <EmptyState icon="search" title="No matching servers" description="Try a different keyword" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetailOf(s)}
              className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft">
                  <Icon name="server" className="text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-5">{s.name}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{s.transport === 'stdio' ? s.installCommand.split(' ').slice(0, 2).join(' ') : 'Remote server'}</div>
                </div>
                <Badge variant="primary" className="shrink-0 font-normal">
                  Official catalog
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">{s.description}</p>
              <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2.5">
                {s.envDocs.length > 0 ? (
                  <Badge variant="warning" className="font-normal">Needs {s.envDocs.length} env vars</Badge>
                ) : (
                  <Badge variant="success" className="font-normal">Works out of the box</Badge>
                )}
                {installedNames.has(s.name) && <Badge variant="outline" className="font-normal">In library</Badge>}
                <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  View &amp; install
                  <Icon name="arrowRight" className="h-3 w-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detailOf && (
        <Modal
          open
          onClose={() => setDetailOf(null)}
          width="max-w-xl"
          title={`MCP details — ${detailOf.name}`}
          subtitle={detailOf.description}
          footer={
            <>
              <Button variant="outline" onClick={() => setDetailOf(null)}>
                Close
              </Button>
              <Button onClick={() => install(detailOf)}>
                <Icon name="download" />
                Install to My MCP
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">What it does</h3>
              <p>{detailOf.whatItDoes}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Use cases</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {detailOf.useCases.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Install command</h3>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs">{detailOf.installCommand}</pre>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Required environment variables</h3>
              {detailOf.envDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No extra variables needed.</p>
              ) : (
                <div className="space-y-2">
                  {detailOf.envDocs.map((e) => (
                    <div key={e.key} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.key}</code>
                        <span className="text-[11px] text-muted-foreground">Example placeholder: {e.placeholder}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{e.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </Modal>
      )}
    </div>
  )
}

type McpStoreRow = (typeof SEED_MCP_STORE)[number]

export function McpServerTypeBadge({ server }: { server: McpServer }) {
  return <Badge variant={server.transport === 'stdio' ? 'secondary' : 'info'}>{server.transport}</Badge>
}
