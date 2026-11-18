import { useEffect, useState } from 'react'
import type { McpServer, McpTransport } from '../../types'
import { Button, Input, Select, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, nowIso, uid } from '../../lib/utils'
import { isSecretKey, mcpFilePath } from '../../lib/mcp'
import { useStore } from '../../store/store'
import { useToast } from '../ui/toast'
import { folderOptions, normalizeFolder } from '../../lib/folders'
import { FolderField } from '../shared/FolderTree'

interface EnvRow {
  key: string
  value: string
}

const emptyServer = (): McpServer => ({
  id: '',
  name: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  requiredEnv: [],
  url: '',
  headers: {},
  enabled: true,
  isFavorite: false,
  folder: null,
  tags: [],
  source: 'manual',
  installs: {},
  notes: '',
  versions: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
})

/** 简易来源识别（对应 PromptHub 的 mcp-source.ts 六类识别的原型子集） */
function detectSource(input: string): { transport: McpTransport; command?: string; args?: string[]; url?: string; hint: string } {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return { transport: 'http', url: trimmed, hint: '识别为远程 URL → streamable-http / SSE 传输' }
  }
  if (/^npx\s|^uvx\s|^node\s|^python\s|^docker\s/.test(trimmed)) {
    const parts = trimmed.split(/\s+/)
    return { transport: 'stdio', command: parts[0], args: parts.slice(1), hint: '识别为启动命令 → stdio 传输（已按空格拆分参数）' }
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return { transport: 'stdio', command: 'node', args: [trimmed], hint: '识别为本地路径 → 以 node 运行该入口（本地项目建议先确认入口文件）' }
  }
  if (trimmed.includes('github.com') || trimmed.startsWith('gh:')) {
    const repo = trimmed.replace(/^gh:/, '').replace(/https:\/\/github\.com\//, '')
    return { transport: 'stdio', command: 'npx', args: ['-y', `github:${repo}`], hint: '识别为 GitHub 仓库 → 转为 npx -y github:owner/repo' }
  }
  return { transport: 'stdio', command: trimmed, args: [], hint: '无法确定类型，已填入命令，请补充参数或改用粘贴配置' }
}

export function McpEditModal({ open, server, onClose }: { open: boolean; server?: McpServer; onClose: () => void }) {
  const { state, saveMcp } = useStore()
  const toast = useToast()
  const isEdit = !!server
  const [mode, setMode] = useState<'source' | 'paste' | 'manual'>('source')
  const [sourceInput, setSourceInput] = useState('')
  const [detectHint, setDetectHint] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [draft, setDraft] = useState<McpServer>(emptyServer)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const folders = folderOptions(state.mcps, (m) => m.folder)

  useEffect(() => {
    if (!open) return
    if (server) {
      setDraft({ ...server })
      setEnvRows(Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value })))
    } else {
      setDraft(emptyServer())
      setEnvRows([])
      setMode('source')
      setSourceInput('')
      setPasteText('')
      setDetectHint(null)
    }
    setError(null)
  }, [open, server])

  const set = (patch: Partial<McpServer>) => setDraft((d) => ({ ...d, ...patch }))

  const detect = () => {
    const r = detectSource(sourceInput)
    setDetectHint(r.hint)
    set((r.command !== undefined ? { transport: r.transport, command: r.command, args: r.args } : { transport: r.transport, url: r.url }))
  }

  const parsePaste = () => {
    try {
      const parsed = JSON.parse(pasteText) as Record<string, unknown>
      const servers = (parsed.mcpServers ?? parsed.servers ?? parsed) as Record<string, unknown>
      const firstName = Object.keys(servers)[0]
      if (!firstName) throw new Error('未找到服务定义')
      const cfg = servers[firstName] as Record<string, unknown>
      const next: Partial<McpServer> = {
        name: firstName,
        transport: cfg.url ? 'http' : 'stdio',
        ...(cfg.url ? { url: String(cfg.url) } : { command: String(cfg.command ?? ''), args: (cfg.args as string[]) ?? [] }),
        env: (cfg.env as Record<string, string>) ?? {},
      }
      set(next)
      setEnvRows(Object.entries(next.env ?? {}).map(([key, value]) => ({ key, value })))
      setDetectHint(`已解析 ${firstName}；重复名称保存时会提示`)
      setError(null)
    } catch (e) {
      toast.error(`解析失败：${e instanceof Error ? e.message : 'JSON 不合法'}`)
    }
  }

  const submit = () => {
    if (!draft.name.trim()) {
      setError('名称必填')
      return
    }
    const dup = state.mcps.find((m) => m.name === draft.name.trim() && m.id !== draft.id)
    if (dup) {
      setError(`名称与现有服务「${dup.name}」重复（名称唯一约束）`)
      return
    }
    if (draft.transport === 'stdio' && !draft.command?.trim() && isEdit) {
      setError('stdio 服务需要启动命令')
      return
    }
    const env = Object.fromEntries(envRows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))
    const requiredEnv = Object.keys(env).filter((k) => isSecretKey(k))
    saveMcp({
      ...draft,
      name: draft.name.trim(),
      folder: normalizeFolder(draft.folder),
      env,
      requiredEnv: draft.requiredEnv?.length ? draft.requiredEnv : requiredEnv,
      updatedAt: nowIso(),
    })
    toast.success(draft.id ? `已保存「${draft.name}」，配置变更已生成新版本` : `已添加「${draft.name}」`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={isEdit ? `编辑 MCP — ${server!.name}` : '新建 MCP'}
      subtitle={isEdit ? '配置变更保存后自动生成版本；凭据未改动则沿用原值' : '三种方式：从来源识别 / 粘贴配置 / 手动填写'}
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>{isEdit ? '保存' : '添加到我的 MCP'}</Button>
        </>
      }
    >
      {!isEdit && (
        <div className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { v: 'source', label: '从来源添加' },
              { v: 'paste', label: '粘贴配置' },
              { v: 'manual', label: '手动配置' },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setMode(t.v)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium',
                mode === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!isEdit && mode === 'source' && (
        <div className="mb-4 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">命令 / URL / 本地路径 / GitHub 仓库</label>
          <div className="flex gap-2">
            <Input
              aria-label="命令、URL 或本地路径"
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value)}
              placeholder="npx -y @mcp/notion  ·  https://…/sse  ·  ~/projects/mcp-server  ·  gh:owner/repo"
            />
            <Button onClick={detect}>
              <Icon name="sparkles" />
              识别
            </Button>
          </div>
          {detectHint && (
            <p className="flex items-start gap-1.5 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {detectHint}
            </p>
          )}
        </div>
      )}

      {!isEdit && mode === 'paste' && (
        <div className="mb-4 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">粘贴 mcpServers JSON（Claude Desktop / Cursor 格式）</label>
          <Textarea
            aria-label="粘贴 mcpServers JSON"
            rows={5}
            className="font-mono text-xs"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`{\n  "mcpServers": {\n    "notion": { "command": "npx", "args": ["-y", "@mcp/notion"] }\n  }\n}`}
          />
          <Button size="sm" variant="outline" onClick={parsePaste}>
            解析并填入
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">名称 *（唯一）</label>
            <Input aria-label="名称" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="notion" />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">传输类型</label>
            <Select aria-label="传输类型" value={draft.transport} onChange={(e) => set({ transport: e.target.value as McpTransport })}>
              <option value="stdio">stdio（本地命令）</option>
              <option value="http">http（远程 URL）</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述</label>
          <Input aria-label="描述" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="这个服务能做什么" />
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => set({ folder })}
          options={folders}
          pathPreview={mcpFilePath(
            { ...draft, name: draft.name || 'untitled', folder: draft.folder },
            state.repo.layout.mcp,
          )}
          hint="每个 server 一个 JSON 文件；文件夹决定它在仓库中的位置。"
        />

        {draft.transport === 'stdio' ? (
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">启动命令</label>
              <Input aria-label="启动命令" value={draft.command ?? ''} onChange={(e) => set({ command: e.target.value })} placeholder="npx / uvx / node…" className="font-mono text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">参数（空格分隔）</label>
              <Input
                aria-label="参数"
                value={(draft.args ?? []).join(' ')}
                onChange={(e) => set({ args: e.target.value.split(/\s+/).filter(Boolean) })}
                placeholder="-y @mcp/notion"
                className="font-mono text-xs"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">服务 URL</label>
            <Input aria-label="服务 URL" value={draft.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://mcp.example.dev/sse" className="font-mono text-xs" />
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            环境变量 / 凭据
            <span className="font-normal">名称含 KEY / TOKEN / SECRET 的值保存后加密存储、界面回显 [REDACTED]</span>
          </div>
          <div className="space-y-1.5">
            {envRows.map((row, idx) => {
              const secret = isSecretKey(row.key)
              const masked = secret && !reveal[idx]
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    aria-label={`环境变量名 ${idx + 1}`}
                    className="w-48 font-mono text-xs"
                    placeholder="API_KEY"
                    value={row.key}
                    onChange={(e) => setEnvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
                  />
                  <div className="relative flex-1">
                    <Input
                      aria-label={`环境变量值 ${idx + 1}`}
                      className="pr-9 font-mono text-xs"
                      type={masked ? 'password' : 'text'}
                      placeholder={secret ? '已加密存储' : 'value'}
                      value={masked && row.value === '' ? '[REDACTED]' : row.value}
                      onChange={(e) => setEnvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                    />
                    {secret && (
                      <button
                        type="button"
                        aria-label={masked ? '显示凭据' : '隐藏凭据'}
                        className="absolute right-2 top-2 cursor-pointer text-muted-foreground hover:text-foreground"
                        onClick={() => setReveal((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      >
                        <Icon name={masked ? 'eye' : 'eyeOff'} className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-danger"
                    aria-label={`删除环境变量 ${idx + 1}`}
                    onClick={() => setEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Icon name="x" />
                  </Button>
                </div>
              )
            })}
            <Button size="sm" variant="outline" onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              添加变量
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
