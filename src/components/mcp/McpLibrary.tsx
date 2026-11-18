import { useEffect, useMemo, useState } from 'react'
import type { McpServer } from '../../types'
import { useStore } from '../../store/store'
import { MCP_TARGETS } from '../../data/seed'
import { Badge, Button, Switch, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { checkHealth, healthBadge, mcpFilePath, projectForTarget, serverConfigJson } from '../../lib/mcp'
import { useToast } from '../ui/toast'
import { McpEditModal } from './McpEditModal'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { folderLabel, folderMatches } from '../../lib/folders'
import { FolderTree } from '../shared/FolderTree'

/** 目标平台当前对某 server 的状态 */
export type TargetStatus = 'managed' | 'missing' | 'external'
export function targetStatus(server: McpServer, platformId: string): TargetStatus {
  if (server.installs[platformId]) return 'managed'
  return 'missing'
}

/* ---------------- 分发弹窗 ---------------- */

export function McpDeployModal({
  server,
  onClose,
}: {
  server: McpServer
  onClose: () => void
}) {
  const { applyMcp, removeMcpFromPlatform } = useStore()
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [previewFor, setPreviewFor] = useState<string | null>(MCP_TARGETS[0].id)

  if (!server.enabled) {
    return (
      <Modal open onClose={onClose} title="无法分发" width="max-w-md">
        <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
          <Icon name="alert" className="mt-0.5" />
          服务「{server.name}」已停用，停用的服务禁止分发到任何平台。请先在列表中启用。
        </div>
      </Modal>
    )
  }

  const selectedServers = [server]

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`分发到 Agent 平台 — ${server.name}`}
      subtitle="应用会按平台规范改写其 MCP 配置文件；写入为原型模拟，不触碰真实文件"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              for (const p of selected) applyMcp(server.id, p)
              toast.success(`已把 ${server.name} 应用到 ${selected.length} 个平台（模拟写入）`)
              onClose()
            }}
          >
            应用到所选（{selected.length}）
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {MCP_TARGETS.map((t) => {
          const st = targetStatus(server, t.id)
          const active = selected.includes(t.id)
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                active ? 'border-primary bg-primary-soft' : 'border-border',
              )}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => setSelected((prev) => (active ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                className="h-4 w-4 cursor-pointer accent-indigo-600"
              />
              <div className="min-w-0 cursor-pointer" onClick={() => setPreviewFor(t.id)}>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{t.file}</div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => setPreviewFor(t.id)} className="cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
                  预览写入内容
                </button>
                {st === 'managed' ? (
                  <>
                    <Badge variant="success">已由本应用管理</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => {
                        removeMcpFromPlatform(server.id, t.id)
                        toast.success(`已从 ${t.name} 的配置移除（模拟）`)
                      }}
                    >
                      移除
                    </Button>
                  </>
                ) : (
                  <Badge variant="outline">{st === 'external' ? '外部配置' : '未创建'}</Badge>
                )}
              </div>
            </div>
          )
        })}

        {previewFor && (
          <div>
            <div className="mb-1 mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              写入预览 · {MCP_TARGETS.find((t) => t.id === previewFor)?.file}
              <Badge variant="outline">{MCP_TARGETS.find((t) => t.id === previewFor)?.format}</Badge>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
              {projectForTarget(selectedServers, MCP_TARGETS.find((t) => t.id === previewFor)!)}
            </pre>
            <p className="mt-1 text-[11px] text-muted-foreground">
              凭据在写入时会从加密存储解密注入；此处原型以 *** 代替。真实产品为原子写入 + 失败回滚，并保留原文件权限。
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- 我的 MCP：主从布局 ---------------- */

export function McpLibrary({ query, createSignal }: { query: string; createSignal: { n: number; page: string } }) {
  const { state, saveMcp, deleteMcp, toggleMcpEnabled, toggleMcpFavorite, restoreMcpVersion, deleteMcpVersion } = useStore()
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(state.mcps[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const [editingOf, setEditingOf] = useState<McpServer | null>(null)
  const [deployOf, setDeployOf] = useState<McpServer | null>(null)
  const [versionOf, setVersionOf] = useState<McpServer | null>(null)
  const [deleteOf, setDeleteOf] = useState<McpServer | null>(null)
  const [favOnly, setFavOnly] = useState(false)
  const [folderFilter, setFolderFilter] = useState('')

  const q = query.trim().toLowerCase()
  const list = useMemo(
    () =>
      state.mcps.filter((m) => {
        if (favOnly && !m.isFavorite) return false
        if (folderFilter && !folderMatches(m.folder, folderFilter)) return false
        if (
          q &&
          ![m.name, m.description, m.tags.join(' '), m.folder ?? ''].join(' ').toLowerCase().includes(q)
        )
          return false
        return true
      }),
    [state.mcps, q, favOnly, folderFilter],
  )

  const selected = state.mcps.find((m) => m.id === selectedId) ?? list[0] ?? null

  useEffect(() => {
    if (createSignal.page === 'mcp' && createSignal.n > 0) setCreating(true)
  }, [createSignal])

  const healthOf = (m: McpServer) => healthBadge(checkHealth(m))

  return (
    <div className="flex h-full min-h-0">
      <FolderTree
        items={state.mcps}
        getFolder={(m) => m.folder}
        selected={folderFilter}
        onSelect={setFolderFilter}
        className="hidden w-[176px] shrink-0 border-r border-border bg-card/40 xl:flex"
        title="MCP 文件夹"
      />
      {/* 列表 */}
      <div className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background/40 xl:w-[380px]">
        {folderFilter && (
          <div className="flex items-center gap-1.5 border-b border-border bg-muted/25 px-4 py-1.5 text-[11px] text-muted-foreground">
            <Icon name="folder" className="h-3 w-3" />
            <span className="truncate text-foreground">{folderLabel(folderFilter)}</span>
            <button
              type="button"
              onClick={() => setFolderFilter('')}
              className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              返回全部
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-3">
          <button
            type="button"
            onClick={() => setFavOnly((f) => !f)}
            aria-pressed={favOnly}
            aria-label="只看收藏"
            className={cn(
              'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors',
              favOnly
                ? 'border-warning/50 bg-warning-soft text-warning'
                : 'border-input text-muted-foreground hover:border-border-strong hover:bg-muted hover:text-foreground',
            )}
            title="只看收藏"
          >
            <Icon name="star" className="h-3.5 w-3.5" />
          </button>
          <span className="tabular text-[11px] text-muted-foreground">
            {list.length} / {state.mcps.length} 个服务
          </span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setCreating(true)}
            title="新建 MCP（快捷键 N）"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            新建
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">没有匹配的服务</p>
          ) : (
            list.map((m) => {
              const hb = healthOf(m)
              const active = selected?.id === m.id
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedId(m.id)
                    }
                  }}
                  className={cn(
                    'block w-full cursor-pointer border-b border-border/60 px-4 py-3 text-left transition-colors focus-visible:bg-muted/50',
                    active
                      ? 'bg-primary-soft/40 shadow-[inset_2px_0_0_var(--primary)]'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{m.name}</span>
                    <Badge variant={m.transport === 'stdio' ? 'secondary' : 'info'} className="shrink-0 font-normal">
                      {m.transport}
                    </Badge>
                    {hb !== 'ok' && (
                      <Badge
                        variant={hb === 'error' ? 'danger' : 'warning'}
                        className="shrink-0 gap-1 font-normal"
                      >
                        <Icon name="alert" className="h-3 w-3" />
                        {hb === 'error' ? 'error' : 'warn'}
                      </Badge>
                    )}
                    {m.isFavorite && <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-warning" />}
                    <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={m.enabled}
                        onChange={() => toggleMcpEnabled(m.id)}
                        label={`${m.enabled ? '停用' : '启用'} ${m.name}`}
                      />
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{m.description}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden">
                    <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <Icon name="folder" className="h-3 w-3 shrink-0" />
                      <span className="truncate">{folderLabel(m.folder)}</span>
                    </span>
                    {Object.keys(m.installs).length > 0 && (
                      <Badge variant="success" className="shrink-0 font-normal">
                        已分发 {Object.keys(m.installs).length}
                      </Badge>
                    )}
                    {!m.enabled && (
                      <Badge variant="warning" className="shrink-0 font-normal">
                        已停用
                      </Badge>
                    )}
                    <span className="tabular ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {formatDate(m.updatedAt, false)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 详情 */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-background/30">
        {selected ? (
          <McpDetail
            server={selected}
            onEdit={() => setEditingOf(selected)}
            onDeploy={() => setDeployOf(selected)}
            onVersions={() => setVersionOf(selected)}
            onDelete={() => setDeleteOf(selected)}
            onToggleFavorite={() => toggleMcpFavorite(selected.id)}
            onNotes={(notes) => saveMcp({ ...selected, notes })}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">左侧选择一个 MCP 服务</div>
        )}
      </div>

      {creating && <McpEditModal open onClose={() => setCreating(false)} />}
      {editingOf && <McpEditModal open server={editingOf} onClose={() => setEditingOf(null)} />}
      {deployOf && <McpDeployModal server={deployOf} onClose={() => setDeployOf(null)} />}

      {versionOf && (
        <VersionHistoryModalMcp
          server={versionOf}
          onClose={() => setVersionOf(null)}
          onRestore={(v) => {
            restoreMcpVersion(versionOf.id, v.id)
            toast.success(`已恢复 v${v.version}。注意：恢复不会自动写回 Agent 配置，需重新「应用到平台」`)
          }}
          onDeleteVersion={(vid) => {
            deleteMcpVersion(versionOf.id, vid)
            toast.success('已删除该历史版本')
          }}
        />
      )}

      <DeleteMcpConfirm
        server={deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={() => {
          if (deleteOf) {
            deleteMcp(deleteOf.id)
            setSelectedId(null)
            toast.success(`已删除 ${deleteOf.name}（绑定关系与脱敏指纹一并清理）`)
          }
        }}
      />
    </div>
  )
}

/* ---------------- 详情区 ---------------- */

function McpDetail({
  server,
  onEdit,
  onDeploy,
  onVersions,
  onDelete,
  onToggleFavorite,
  onNotes,
}: {
  server: McpServer
  onEdit: () => void
  onDeploy: () => void
  onVersions: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onNotes: (notes: string) => void
}) {
  const { state } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<'config' | 'health' | 'deploy'>('config')
  const [notesDraft, setNotesDraft] = useState(server.notes)
  const issues = checkHealth(server)
  const hb = healthBadge(issues)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Icon name="server" className="text-primary" />
            <h2 className="text-[17px] font-semibold leading-6 tracking-tight">{server.name}</h2>
            <Badge variant={server.transport === 'stdio' ? 'secondary' : 'info'} className="font-normal">
              {server.transport}
            </Badge>
            <Badge variant="secondary" className="gap-1 font-normal">
              <Icon name="folder" className="h-3 w-3" />
              {folderLabel(server.folder)}
            </Badge>
            <Badge variant={server.source === 'manual' ? 'outline' : server.source === 'market' ? 'primary' : 'warning'} className="font-normal">
              {server.source === 'manual' ? '手动创建' : server.source === 'market' ? '来自商店' : '导入'}
            </Badge>
            <AssetSyncBadge kind="mcp" name={server.name} />
            {hb !== 'ok' && (
              <Badge variant={hb === 'error' ? 'danger' : 'warning'} className="gap-1 font-normal">
                <Icon name="alert" className="h-3 w-3" />
                健康检查 {hb === 'error' ? 'error' : 'warning'}
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={server.isFavorite ? '取消收藏' : '收藏'}
              aria-pressed={server.isFavorite}
              title={server.isFavorite ? '取消收藏' : '收藏'}
              onClick={onToggleFavorite}
            >
              <Icon name="star" className={server.isFavorite ? 'fill-warning/20 text-warning' : ''} />
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border/80" />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="删除 MCP 服务"
              title="删除"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{server.description}</p>
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Icon name="gitBranch" className="h-3 w-3 shrink-0" />
          <span className="shrink-0">仓库文件</span>
          <code className="truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
            {mcpFilePath(server, state.repo.layout.mcp)}
          </code>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {server.tags.map((t) => (
            <Badge key={t} variant="primary" className="font-normal">
              #{t}
            </Badge>
          ))}
          <span className="tabular ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">
            更新于 {formatDate(server.updatedAt)}
          </span>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={onDeploy} disabled={!server.enabled} className="shadow-sm" title={server.enabled ? '' : '已停用的服务禁止分发'}>
            <Icon name="send" />
            应用到平台
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Icon name="pencil" />
            编辑
          </Button>
          <Button variant="outline" onClick={onVersions}>
            <Icon name="history" />
            版本（{server.versions.length}）
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-5 border-b border-border px-5 pt-2.5">
        {(
          [
            { v: 'config', label: '配置（脱敏）' },
            { v: 'health', label: `健康检查（${issues.length}）` },
            { v: 'deploy', label: `分发状态（${Object.keys(server.installs).length}/${MCP_TARGETS.length}）` },
          ] as const
        ).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setTab(t.v)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-0.5 pb-2.5 pt-1.5 text-[13px] transition-colors',
              tab === t.v
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {t.label}
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
                onClick={async () => {
                  await navigator.clipboard.writeText(serverConfigJson(server)).catch(() => {})
                  toast.success('已复制脱敏后的配置 JSON')
                }}
              >
                <Icon name="copy" className="h-3.5 w-3.5" />
                复制配置
              </Button>
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Icon name="pencil" className="h-3.5 w-3.5" />
                JSON / 表单编辑
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
              {serverConfigJson(server)}
            </pre>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              凭据字段（KEY / TOKEN / SECRET / PASSWORD / Authorization）以 AES-256-GCM 加密存于 SQLite，主密钥在系统钥匙串；界面回显一律 [REDACTED]，编辑时未改动的脱敏值沿用原值。
            </p>
            {server.notes !== undefined && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">个人备注（不产生版本）</div>
                <Textarea
                  aria-label="个人备注"
                  rows={2}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => notesDraft !== server.notes && onNotes(notesDraft)}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'health' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {hb === 'ok' ? (
                <Badge variant="success">
                  <Icon name="check" className="h-3 w-3" />
                  全部通过
                </Badge>
              ) : (
                <Badge variant={hb === 'error' ? 'danger' : 'warning'}>
                  <Icon name="alert" className="h-3 w-3" />
                  {issues.filter((i) => i.level === 'error').length} 个错误 ·{' '}
                  {issues.filter((i) => i.level === 'warning').length} 个警告
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">检查项：命令存在性 / URL 合法性 / 必填 env / 凭据格式（内置常见服务商规则）</span>
            </div>
            {issues.map((i, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                  i.level === 'error' ? 'border-danger/30 bg-danger-soft' : 'border-warning/30 bg-warning-soft',
                )}
              >
                <Icon name="alert" className={cn('mt-0.5', i.level === 'error' ? 'text-danger' : 'text-warning')} />
                <div>
                  <span className="font-mono text-xs">{i.field}</span>
                  <p className="text-xs">{i.message}</p>
                </div>
              </div>
            ))}
            {issues.length === 0 && <p className="text-xs text-muted-foreground">未发现静态问题。真实产品还会在 PATH 中探测命令、对远端 URL 做连通性探测。</p>}
          </div>
        )}

        {tab === 'deploy' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">各平台配置文件中该服务的当前状态。真实产品基于 SHA-256 entry digest 识别「外部修改 / 双向冲突」。</p>
            {MCP_TARGETS.map((t) => {
              const st = targetStatus(server, t.id)
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <Icon name="file" className="text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm">{t.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{t.file}</div>
                  </div>
                  <div className="ml-auto">
                    {st === 'managed' && <Badge variant="success">已写入 · 本应用管理</Badge>}
                    {st === 'missing' && <Badge variant="outline">未创建</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- 版本 / 删除 ---------------- */

function VersionHistoryModalMcp({
  server,
  onClose,
  onRestore,
  onDeleteVersion,
}: {
  server: McpServer
  onClose: () => void
  onRestore: (v: { id: string; version: number }) => void
  onDeleteVersion: (id: string) => void
}) {
  const versions = server.versions.map((v) => ({
    ...v,
    data: { config: v.data.config ?? '' },
  }))
  return (
    <VersionHistoryModal
      open
      onClose={onClose}
      title={`版本历史 — ${server.name}`}
      versions={versions}
      fields={[{ key: 'config', label: '服务配置（脱敏）' }]}
      onRestore={onRestore}
      onDeleteVersion={onDeleteVersion}
      restoreHint="恢复仅写入「我的 MCP」库，不会自动改写各 Agent 的配置文件。"
    />
  )
}

function DeleteMcpConfirm({
  server,
  onClose,
  onConfirm,
}: {
  server: McpServer | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={!!server} onClose={onClose} title="删除 MCP 服务？" width="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="danger" onClick={() => { onConfirm(); onClose() }}>确认删除</Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">
        <p>
          将删除「<b className="text-foreground">{server?.name}</b>」：配置、{server?.versions.length ?? 0} 个历史版本与凭据加密记录，并清理其分发绑定。
        </p>
        <p className="mt-2">已写入各平台配置文件中的条目不会被自动移除，可稍后在「Agent MCP」里卸载。</p>
      </div>
    </Modal>
  )
}
