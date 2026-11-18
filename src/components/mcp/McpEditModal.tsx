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

/** Simple source detection (prototype subset of the six detection types in PromptHub's mcp-source.ts) */
function detectSource(input: string): { transport: McpTransport; command?: string; args?: string[]; url?: string; hint: string } {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return { transport: 'http', url: trimmed, hint: 'Detected a remote URL → streamable-http / SSE transport' }
  }
  if (/^npx\s|^uvx\s|^node\s|^python\s|^docker\s/.test(trimmed)) {
    const parts = trimmed.split(/\s+/)
    return { transport: 'stdio', command: parts[0], args: parts.slice(1), hint: 'Detected a launch command → stdio transport (arguments split on spaces)' }
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return { transport: 'stdio', command: 'node', args: [trimmed], hint: 'Detected a local path → run that entry with node (for local projects, verify the entry file first)' }
  }
  if (trimmed.includes('github.com') || trimmed.startsWith('gh:')) {
    const repo = trimmed.replace(/^gh:/, '').replace(/https:\/\/github\.com\//, '')
    return { transport: 'stdio', command: 'npx', args: ['-y', `github:${repo}`], hint: 'Detected a GitHub repo → converted to npx -y github:owner/repo' }
  }
  return { transport: 'stdio', command: trimmed, args: [], hint: 'Could not determine the type; filled in the command. Add arguments or paste a config instead.' }
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
      if (!firstName) throw new Error('No server definition found')
      const cfg = servers[firstName] as Record<string, unknown>
      const next: Partial<McpServer> = {
        name: firstName,
        transport: cfg.url ? 'http' : 'stdio',
        ...(cfg.url ? { url: String(cfg.url) } : { command: String(cfg.command ?? ''), args: (cfg.args as string[]) ?? [] }),
        env: (cfg.env as Record<string, string>) ?? {},
      }
      set(next)
      setEnvRows(Object.entries(next.env ?? {}).map(([key, value]) => ({ key, value })))
      setDetectHint(`Parsed ${firstName}; duplicate names are flagged on save`)
      setError(null)
    } catch (e) {
      toast.error(`Parse failed: ${e instanceof Error ? e.message : 'invalid JSON'}`)
    }
  }

  const submit = () => {
    if (!draft.name.trim()) {
      setError('Name is required')
      return
    }
    const dup = state.mcps.find((m) => m.name === draft.name.trim() && m.id !== draft.id)
    if (dup) {
      setError(`Name conflicts with existing server "${dup.name}" (names must be unique)`)
      return
    }
    if (draft.transport === 'stdio' && !draft.command?.trim() && isEdit) {
      setError('stdio servers need a launch command')
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
    toast.success(draft.id ? `Saved "${draft.name}"; config changes created a new version` : `Added "${draft.name}"`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={isEdit ? `Edit MCP — ${server!.name}` : 'New MCP'}
      subtitle={isEdit ? 'Config changes create a version on save; unchanged credentials keep their existing values' : 'Three ways in: detect from source / paste config / fill in manually'}
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{isEdit ? 'Save' : 'Add to My MCP'}</Button>
        </>
      }
    >
      {!isEdit && (
        <div className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { v: 'source', label: 'Add from source' },
              { v: 'paste', label: 'Paste config' },
              { v: 'manual', label: 'Manual config' },
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
          <label className="block text-xs font-medium text-muted-foreground">Command / URL / local path / GitHub repo</label>
          <div className="flex gap-2">
            <Input
              aria-label="Command, URL, or local path"
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value)}
              placeholder="npx -y @mcp/notion  ·  https://.../sse  ·  ~/projects/mcp-server  ·  gh:owner/repo"
            />
            <Button onClick={detect}>
              <Icon name="sparkles" />
              Detect
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
          <label className="block text-xs font-medium text-muted-foreground">Paste mcpServers JSON (Claude Desktop / Cursor format)</label>
          <Textarea
            aria-label="Paste mcpServers JSON"
            rows={5}
            className="font-mono text-xs"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`{\n  "mcpServers": {\n    "notion": { "command": "npx", "args": ["-y", "@mcp/notion"] }\n  }\n}`}
          />
          <Button size="sm" variant="outline" onClick={parsePaste}>
            Parse and fill
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name * (unique)</label>
            <Input aria-label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="notion" />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Transport</label>
            <Select aria-label="Transport" value={draft.transport} onChange={(e) => set({ transport: e.target.value as McpTransport })}>
              <option value="stdio">stdio (local command)</option>
              <option value="http">http (remote URL)</option>
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Input aria-label="Description" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this server does" />
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => set({ folder })}
          options={folders}
          pathPreview={mcpFilePath(
            { ...draft, name: draft.name || 'untitled', folder: draft.folder },
            state.repo.layout.mcp,
          )}
          hint="One JSON file per server; the folder determines its location in the repo."
        />

        {draft.transport === 'stdio' ? (
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Launch command</label>
              <Input aria-label="Launch command" value={draft.command ?? ''} onChange={(e) => set({ command: e.target.value })} placeholder="npx / uvx / node…" className="font-mono text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Arguments (space-separated)</label>
              <Input
                aria-label="Arguments"
                value={(draft.args ?? []).join(' ')}
                onChange={(e) => set({ args: e.target.value.split(/\s+/).filter(Boolean) })}
                placeholder="-y @mcp/notion"
                className="font-mono text-xs"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Server URL</label>
            <Input aria-label="Server URL" value={draft.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://mcp.example.dev/sse" className="font-mono text-xs" />
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Environment variables / Credentials
            <span className="font-normal">Values whose names contain KEY / TOKEN / SECRET are stored encrypted and shown as [REDACTED] in the UI</span>
          </div>
          <div className="space-y-1.5">
            {envRows.map((row, idx) => {
              const secret = isSecretKey(row.key)
              const masked = secret && !reveal[idx]
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    aria-label={`Environment variable name ${idx + 1}`}
                    className="w-48 font-mono text-xs"
                    placeholder="API_KEY"
                    value={row.key}
                    onChange={(e) => setEnvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
                  />
                  <div className="relative flex-1">
                    <Input
                      aria-label={`Environment variable value ${idx + 1}`}
                      className="pr-9 font-mono text-xs"
                      type={masked ? 'password' : 'text'}
                      placeholder={secret ? 'Stored encrypted' : 'value'}
                      value={masked && row.value === '' ? '[REDACTED]' : row.value}
                      onChange={(e) => setEnvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                    />
                    {secret && (
                      <button
                        type="button"
                        aria-label={masked ? 'Show credential' : 'Hide credential'}
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
                    aria-label={`Delete environment variable ${idx + 1}`}
                    onClick={() => setEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Icon name="x" />
                  </Button>
                </div>
              )
            })}
            <Button size="sm" variant="outline" onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add variable
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
