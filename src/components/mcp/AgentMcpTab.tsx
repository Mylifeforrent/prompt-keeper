import { useState } from 'react'
import type { McpServer } from '../../types'
import { useStore } from '../../store/store'
import { MCP_TARGETS, AGENT_EXTERNAL_ENTRIES, SEED_MCP_STORE } from '../../data/seed'
import { Badge, Button, EmptyState } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { nowIso, uid } from '../../lib/utils'
import { useToast } from '../ui/toast'

/* ---------------- Agent MCP 现状（反向导入） ---------------- */

export function AgentMcpTab() {
  const { state, importAgentMcp } = useStore()
  const toast = useToast()

  return (
    <div className="space-y-3 p-4">
      <p className="flex items-start gap-1.5 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        这里是各 Agent 工具 MCP 配置文件的现状视图：由本应用写入的条目标记「本应用管理」，其他条目标记「外部」，可反向导入到「我的 MCP」统一管理。
      </p>
      <div className="grid grid-cols-2 gap-3">
        {MCP_TARGETS.map((t) => {
          const managed = state.mcps.filter((m) => m.installs[t.id])
          const external = AGENT_EXTERNAL_ENTRIES[t.id] ?? []
          return (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Icon name="server" className="text-primary" />
                <span className="text-sm font-medium">{t.name}</span>
                <Badge variant="outline">{t.format.toUpperCase()}</Badge>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  管理 {managed.length} · 外部 {external.length}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{t.file}</div>

              <div className="mt-3 space-y-1.5">
                {managed.length === 0 && external.length === 0 && (
                  <p className="text-xs text-muted-foreground">该工具还没有任何 MCP 配置</p>
                )}
                {managed.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <Icon name="check" className="text-success" />
                    {m.name}
                    <Badge variant="success" className="ml-auto">
                      本应用管理
                    </Badge>
                  </div>
                ))}
                {external.map((e) => (
                  <div key={e.name} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <Icon name="externalLink" className="text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{e.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{e.hint}</span>
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
                          tags: ['导入'],
                          source: 'import',
                          installs: {},
                          notes: `从 ${t.name} 反向导入，导入后默认停用，确认可用后再分发`,
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
                        toast.success(`已把 ${e.name} 导入「我的 MCP」（默认停用）`)
                      }}
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      导入到我的库
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

/* ---------------- MCP 商店 ---------------- */

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
      toast.error(`名称「${item.name}」已存在于我的 MCP（名称唯一约束），请先重命名或删除`)
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
      tags: ['商店'],
      source: 'market',
      installs: {},
      notes: '',
      versions: [
        {
          id: uid(),
          version: 1,
          note: `来自商店模板 v1`,
          createdAt: nowIso(),
          data: { config: JSON.stringify({ transport: item.transport, command: item.command, args: item.args, url: item.url }, null, 2) },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    toast.success(`「${item.name}」已加入我的 MCP；必填环境变量待配置，可先看健康检查`)
    setDetailOf(null)
    onInstalled()
  }

  return (
    <div className="p-4">
      {list.length === 0 ? (
        <EmptyState icon="search" title="未找到匹配的服务" description="换个关键词试试" />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetailOf(s)}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Icon name="server" className="text-primary" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground">{s.transport === 'stdio' ? s.installCommand.split(' ').slice(0, 2).join(' ') : '远程服务'}</div>
                </div>
                <Badge variant="primary" className="ml-auto">
                  官方目录
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-xs leading-5 text-muted-foreground">{s.description}</p>
              <div className="mt-2 flex items-center gap-1">
                {s.envDocs.length > 0 ? (
                  <Badge variant="warning">需配置 {s.envDocs.length} 个变量</Badge>
                ) : (
                  <Badge variant="success">开箱即用</Badge>
                )}
                {installedNames.has(s.name) && <Badge variant="outline">已在库中</Badge>}
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
          title={`MCP 详情 — ${detailOf.name}`}
          subtitle={detailOf.description}
          footer={
            <>
              <Button variant="outline" onClick={() => setDetailOf(null)}>
                关闭
              </Button>
              <Button onClick={() => install(detailOf)}>
                <Icon name="download" />
                安装到我的 MCP
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">它能做什么</h3>
              <p>{detailOf.whatItDoes}</p>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">适用场景</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {detailOf.useCases.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">安装命令</h3>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-2.5 font-mono text-xs">{detailOf.installCommand}</pre>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">必填环境变量</h3>
              {detailOf.envDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">无需额外变量。</p>
              ) : (
                <div className="space-y-2">
                  {detailOf.envDocs.map((e) => (
                    <div key={e.key} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.key}</code>
                        <span className="text-[11px] text-muted-foreground">占位示例：{e.placeholder}</span>
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
