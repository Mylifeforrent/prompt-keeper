import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  McpCreateInput,
  McpDetail,
  McpFieldValue,
  McpTransport,
  McpUpdateInput,
} from '../../../shared/contracts'
import { isSecretKey } from '../../../shared/domain/mcpFile'
import { normalizeFolder } from '../../../shared/domain/folders'
import { Badge, Button, Input, Spinner, Switch, Textarea } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { FolderField } from '../shared/FolderTree'
import { useToast } from '../ui/toast'
import { Icon } from '../../lib/icons'
import { errorDetails, errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn, uid } from '../../lib/utils'
import { mcpRepoPath } from '../../lib/mcpView'

type FieldRowMode = 'stored' | 'plain' | 'new' | 'replace' | 'clear'

interface FieldRow {
  id: string
  key: string
  mode: FieldRowMode
  value: string
  locked: boolean
  redacted: boolean
  hasValue: boolean
}

interface McpFormState {
  title: string
  description: string
  transport: McpTransport
  command: string
  args: string
  url: string
  folder: string
  tags: string[]
  requiredEnv: string[]
  notes: string
  enabled: boolean
}

const emptyForm: McpFormState = {
  title: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  folder: '',
  tags: [],
  requiredEnv: [],
  notes: '',
  enabled: true,
}

function rowsFromRecord(record: Record<string, McpFieldValue>): FieldRow[] {
  return Object.entries(record).map(([key, field]) => ({
    id: uid(),
    key,
    mode: field.redacted && field.hasValue ? 'stored' : 'plain',
    value: field.redacted ? '' : field.value,
    locked: true,
    redacted: field.redacted,
    hasValue: field.hasValue,
  }))
}

function createRecord(rows: FieldRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key || row.mode === 'clear') continue
    out[key] = row.mode === 'stored' ? '' : row.value
  }
  return out
}

function patchRecord(
  rows: FieldRow[],
  original: Record<string, McpFieldValue>,
): Record<string, string | null> | undefined {
  const patch: Record<string, string | null> = {}
  let changed = false
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    if (row.mode === 'clear') {
      patch[key] = null
      changed = true
      continue
    }
    if (row.mode === 'stored') continue
    if (row.mode === 'replace') {
      patch[key] = row.value
      changed = true
      continue
    }
    const previous = original[key]
    if (!previous || previous.redacted || previous.value !== row.value) {
      patch[key] = row.value
      changed = true
    }
  }
  return changed ? patch : undefined
}

function hasSecretClear(rows: FieldRow[]): boolean {
  return rows.some((row) => row.mode === 'clear' && (row.redacted || isSecretKey(row.key)))
}

export function McpEditModal({
  open,
  server,
  folderOptions,
  onClose,
  onSaved,
}: {
  open: boolean
  server?: McpDetail | null
  folderOptions: string[]
  onClose: () => void
  onSaved?: (saved: McpDetail) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<McpFormState>(emptyForm)
  const [envRows, setEnvRows] = useState<FieldRow[]>([])
  const [headerRows, setHeaderRows] = useState<FieldRow[]>([])
  const [tagInput, setTagInput] = useState('')
  const [requiredInput, setRequiredInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [clearTarget, setClearTarget] = useState<{ list: 'env' | 'headers'; rowId: string } | null>(
    null,
  )
  const titleRef = useRef<HTMLInputElement>(null)

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    enabled: open,
    staleTime: 15_000,
  })

  const secretsAvailable = bootstrap.data?.safeStorage.available ?? true
  const storageReason = bootstrap.data?.safeStorage.reason

  useEffect(() => {
    if (!open) return
    setError(null)
    setTagInput('')
    setRequiredInput('')
    setClearTarget(null)
    if (server) {
      setForm({
        title: server.title,
        description: server.description,
        transport: server.transport,
        command: server.command ?? '',
        args: server.args.join('\n'),
        url: server.url ?? '',
        folder: server.folder,
        tags: [...server.tags],
        requiredEnv: [...server.requiredEnv],
        notes: server.notes,
        enabled: server.enabled,
      })
      setEnvRows(rowsFromRecord(server.env))
      setHeaderRows(rowsFromRecord(server.headers))
    } else {
      setForm(emptyForm)
      setEnvRows([])
      setHeaderRows([])
    }
  }, [open, server])

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  const update = (patch: Partial<McpFormState>) => setForm((current) => ({ ...current, ...patch }))

  const updateRow = (
    list: 'env' | 'headers',
    rowId: string,
    patch: Partial<FieldRow>,
  ) => {
    const apply = (rows: FieldRow[]) =>
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
    if (list === 'env') setEnvRows(apply)
    else setHeaderRows(apply)
  }

  const addRow = (list: 'env' | 'headers') => {
    const row: FieldRow = {
      id: uid(),
      key: '',
      mode: 'new',
      value: '',
      locked: false,
      redacted: false,
      hasValue: false,
    }
    if (list === 'env') setEnvRows((current) => [...current, row])
    else setHeaderRows((current) => [...current, row])
  }

  const requestClear = (list: 'env' | 'headers', row: FieldRow) => {
    if (row.mode === 'stored') {
      setClearTarget({ list, rowId: row.id })
      return
    }
    updateRow(list, row.id, { mode: 'clear' })
  }

  const addTag = () => {
    const value = tagInput.trim()
    if (!value) return
    if (!form.tags.includes(value)) update({ tags: [...form.tags, value] })
    setTagInput('')
  }

  const repoPreview = mcpRepoPath({
    title: form.title.trim() || 'untitled',
    slug: server && form.title.trim() === server.title ? server.slug : undefined,
    folder: normalizeFolder(form.folder),
  })

  const validate = (): string | null => {
    if (!form.title.trim()) return 'Title is required.'
    if (form.transport === 'stdio' && !form.command.trim()) {
      return 'A stdio server needs a launch command.'
    }
    if (form.transport === 'http' && !/^https?:\/\/\S+$/.test(form.url.trim())) {
      return 'An http server needs a valid http(s) URL.'
    }
    for (const rows of [envRows, headerRows]) {
      const seen = new Set<string>()
      for (const row of rows) {
        if (row.mode === 'clear') continue
        const key = row.key.trim()
        if (!key) {
          if (row.value.trim()) return 'Every value needs a key.'
          continue
        }
        const lower = key.toLowerCase()
        if (seen.has(lower)) return `Duplicate key "${key}".`
        seen.add(lower)
        if (row.mode === 'replace' && !row.value) {
          return `Enter a new secret value for "${key}" or use "Keep stored".`
        }
      }
    }
    return null
  }

  const save = useMutation({
    mutationFn: async (): Promise<McpDetail> => {
      const title = form.title.trim()
      const shared = {
        title,
        description: form.description.trim(),
        transport: form.transport,
        folder: normalizeFolder(form.folder),
        tags: form.tags,
        notes: form.notes.trim(),
        requiredEnv: form.requiredEnv,
      }
      let saved: McpDetail
      if (server) {
        const clearSecrets = hasSecretClear(envRows) || hasSecretClear(headerRows)
        const input: McpUpdateInput = {
          id: server.id,
          expectedRevisionId: server.currentRevisionId,
          ...shared,
          ...(form.transport === 'stdio'
            ? { command: form.command.trim(), args: splitArgs(form.args) }
            : { url: form.url.trim() }),
          env: patchRecord(envRows, server.env),
          headers: patchRecord(headerRows, server.headers),
          ...(clearSecrets ? { confirmClearSecrets: true } : {}),
        }
        saved = await ipc.mcp.update(input)
      } else {
        const input: McpCreateInput = {
          ...shared,
          source: 'manual',
          ...(form.transport === 'stdio'
            ? { command: form.command.trim(), args: splitArgs(form.args) }
            : { url: form.url.trim() }),
          env: createRecord(envRows),
          headers: createRecord(headerRows),
        }
        saved = await ipc.mcp.create(input)
      }
      if (saved.enabled !== form.enabled) {
        try {
          saved = await ipc.mcp.setEnabled({ id: saved.id, enabled: form.enabled })
        } catch (error) {
          toast.warning(
            `Configuration saved, but the enabled state could not be changed: ${errorMessage(error)}`,
          )
        }
      }
      return saved
    },
    onSuccess: (saved) => {
      toast.success(
        server
          ? `Saved "${saved.title}". Agent config files are not rewritten until you apply again.`
          : `Added "${saved.title}" to the MCP library.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['mcp'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      onSaved?.(saved)
      onClose()
    },
    onError: (errorValue) => setError(errorMessage(errorValue)),
  })

  const submit = () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError(null)
    save.mutate()
  }

  const conflictDetails = errorDetails(save.error)
  const revisionConflict = conflictDetails?.kind === 'revision-conflict' ? conflictDetails : null

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-3xl"
        title={server ? `Edit MCP server — ${server.title}` : 'New MCP server'}
        subtitle={
          server
            ? `Saving creates revision v${server.currentVersion + 1}. Secrets are never displayed or written back from redacted placeholders.`
            : 'One server per repository JSON file. Credential-like values are encrypted locally and shown redacted.'
        }
        footer={
          <>
            <div className="mr-auto min-w-0">
              {error && <p className="truncate text-xs text-danger">{error}</p>}
              {revisionConflict && (
                <p className="truncate text-xs text-danger">
                  This server changed since it was opened (current v{revisionConflict.currentVersion}).
                </p>
              )}
            </div>
            {revisionConflict ? (
              <Button
                variant="outline"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['mcp'] })
                  onClose()
                }}
              >
                Close and reload
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={save.isPending} onClick={submit}>
                  {save.isPending ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Icon name="check" className="h-3.5 w-3.5" />
                  )}
                  {server ? 'Save revision' : 'Add to library'}
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
              <Input
                ref={titleRef}
                aria-label="Title"
                value={form.title}
                onChange={(event) => update({ title: event.target.value })}
                placeholder="notion"
                className="font-mono text-xs"
              />
            </div>
            <div className="w-48">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Transport</label>
              <div className="inline-flex h-9 w-full items-center rounded-lg bg-muted p-1">
                {(
                  [
                    { value: 'stdio', label: 'stdio' },
                    { value: 'http', label: 'http' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => update({ transport: option.value })}
                    className={cn(
                      'h-full flex-1 cursor-pointer rounded-md text-xs font-medium transition-colors',
                      form.transport === option.value
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex w-28 flex-col">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Enabled</label>
              <div className="flex h-9 items-center gap-2 rounded-lg border border-input px-2.5">
                <Switch
                  checked={form.enabled}
                  onChange={(enabled) => update({ enabled })}
                  label="Enabled"
                />
                <span className="text-[11px] text-muted-foreground">{form.enabled ? 'On' : 'Off'}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <Input
              aria-label="Description"
              value={form.description}
              onChange={(event) => update({ description: event.target.value })}
              placeholder="What this server exposes to the Agent."
            />
          </div>

          <FolderField
            value={form.folder || null}
            onChange={(folder) => update({ folder: folder ?? '' })}
            options={folderOptions}
            pathPreview={repoPreview}
            hint="One JSON file per server; the folder is the repository directory."
          />

          {form.transport === 'stdio' ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Command</label>
                <Input
                  aria-label="Launch command"
                  value={form.command}
                  onChange={(event) => update({ command: event.target.value })}
                  placeholder="npx"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Arguments (one per line)
                </label>
                <Textarea
                  aria-label="Arguments"
                  rows={2}
                  value={form.args}
                  onChange={(event) => update({ args: event.target.value })}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Server URL</label>
              <Input
                aria-label="Server URL"
                value={form.url}
                onChange={(event) => update({ url: event.target.value })}
                placeholder="https://mcp.example.dev/sse"
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">
            <p className="flex items-start gap-1.5">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stored secrets are shown as <code className="font-mono">[REDACTED]</code> and never returned
              to the interface. Untouched values are preserved; a new value replaces the stored one; clearing
              requires confirmation.
            </p>
            {!secretsAvailable && (
              <p className="mt-1.5 font-medium text-warning">
                Secure storage is unavailable
                {storageReason ? ` (${storageReason})` : ''}. Secret values cannot be entered or replaced,
                but existing non-secret values remain editable.
              </p>
            )}
          </div>

          <FieldRowsEditor
            label="Environment variables"
            rows={envRows}
            secretsAvailable={secretsAvailable}
            onChange={setEnvRows}
            onAdd={() => addRow('env')}
            onClear={(row) => requestClear('env', row)}
            updateRow={(rowId, patch) => updateRow('env', rowId, patch)}
            addLabel="Add variable"
          />

          <FieldRowsEditor
            label="HTTP headers"
            hint="Only used by the http transport."
            rows={headerRows}
            secretsAvailable={secretsAvailable}
            onChange={setHeaderRows}
            onAdd={() => addRow('headers')}
            onClear={(row) => requestClear('headers', row)}
            updateRow={(rowId, patch) => updateRow('headers', rowId, patch)}
            addLabel="Add header"
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Required environment keys
            </label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
              {form.requiredEnv.map((key) => (
                <Badge key={key} variant="warning" className="gap-1 py-1 font-mono">
                  {key}
                  <button
                    type="button"
                    aria-label={`Remove required key ${key}`}
                    className="cursor-pointer"
                    onClick={() =>
                      update({ requiredEnv: form.requiredEnv.filter((value) => value !== key) })
                    }
                  >
                    <Icon name="x" className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                aria-label="Add required environment key"
                className="min-w-32 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/80"
                value={requiredInput}
                placeholder={form.requiredEnv.length ? '' : 'NOTION_API_KEY'}
                onChange={(event) => setRequiredInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const value = requiredInput.trim()
                    if (value && !form.requiredEnv.includes(value)) {
                      update({ requiredEnv: [...form.requiredEnv, value] })
                    }
                    setRequiredInput('')
                  }
                }}
                onBlur={() => {
                  const value = requiredInput.trim()
                  if (value && !form.requiredEnv.includes(value)) {
                    update({ requiredEnv: [...form.requiredEnv, value] })
                  }
                  setRequiredInput('')
                }}
              />
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
              Missing required keys are reported by the static health check.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
              {form.tags.map((tag) => (
                <Badge key={tag} variant="primary" className="gap-1 py-1">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    className="cursor-pointer"
                    onClick={() => update({ tags: form.tags.filter((value) => value !== tag) })}
                  >
                    <Icon name="x" className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                aria-label="Add tag"
                className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                value={tagInput}
                placeholder={form.tags.length ? '' : 'search, database, docs…'}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTag()
                  }
                }}
                onBlur={addTag}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea
              aria-label="Notes"
              rows={2}
              value={form.notes}
              onChange={(event) => update({ notes: event.target.value })}
              placeholder="Setup notes for teammates. Notes are versioned with the configuration."
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!clearTarget}
        onClose={() => setClearTarget(null)}
        onConfirm={() => {
          if (clearTarget) {
            updateRow(clearTarget.list, clearTarget.rowId, { mode: 'clear' })
          }
        }}
        title="Clear this stored secret?"
        confirmText="Clear secret"
        message={
          <>
            The stored value is removed from encrypted local storage when you save. This cannot be undone
            without re-entering the secret. Agent configuration files are not rewritten until the server is
            applied again.
          </>
        }
      />
    </>
  )
}

function FieldRowsEditor({
  label,
  hint,
  rows,
  secretsAvailable,
  onChange,
  onAdd,
  onClear,
  updateRow,
  addLabel,
}: {
  label: string
  hint?: string
  rows: FieldRow[]
  secretsAvailable: boolean
  onChange: (rows: FieldRow[]) => void
  onAdd: () => void
  onClear: (row: FieldRow) => void
  updateRow: (rowId: string, patch: Partial<FieldRow>) => void
  addLabel: string
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {label}
        <span className="font-normal text-[10.5px]">
          {hint ?? 'Credential-like names are stored encrypted.'}
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const secretLike = row.redacted || isSecretKey(row.key)
          const valueLocked = secretLike && !secretsAvailable
          const toggleReveal = () =>
            setRevealed((current) => ({ ...current, [row.id]: !current[row.id] }))
          return (
            <div key={row.id} className="flex items-start gap-1.5">
              <div className="w-44 shrink-0">
                <Input
                  aria-label="Environment or header key"
                  value={row.key}
                  disabled={row.locked}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                  placeholder={label.startsWith('HTTP') ? 'Authorization' : 'API_KEY'}
                  className="h-8 font-mono text-[11px]"
                />
                {!row.locked && secretLike && (
                  <span className="mt-0.5 flex items-center gap-1 text-[9.5px] text-warning">
                    <Icon name="lock" className="h-2.5 w-2.5" />
                    Encrypted value
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {row.mode === 'stored' ? (
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-input bg-muted/50 px-2.5 font-mono text-[11px] text-muted-foreground">
                      <Icon name="lock" className="h-3 w-3" />
                      [REDACTED]
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!secretsAvailable}
                      onClick={() => updateRow(row.id, { mode: 'replace', value: '' })}
                    >
                      Replace
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => onClear(row)}
                    >
                      Clear
                    </Button>
                  </div>
                ) : row.mode === 'replace' ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="New secret value"
                      type="password"
                      autoComplete="off"
                      value={row.value}
                      onChange={(event) => updateRow(row.id, { value: event.target.value })}
                      placeholder="New secret value (stored encrypted)"
                      className="h-8 font-mono text-[11px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateRow(row.id, { mode: 'stored', value: '' })}
                    >
                      Keep stored
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => onClear(row)}
                    >
                      Clear
                    </Button>
                  </div>
                ) : row.mode === 'clear' ? (
                  <div className="flex h-8 items-center gap-1.5 rounded-lg border border-warning/30 bg-warning-soft px-2.5 text-[11px] text-warning">
                    <Icon name="alert" className="h-3 w-3" />
                    Cleared on save
                    <button
                      type="button"
                      className="ml-auto cursor-pointer underline-offset-2 hover:underline"
                      onClick={() =>
                        updateRow(row.id, {
                          mode: row.redacted && row.hasValue ? 'stored' : 'plain',
                          value: '',
                        })
                      }
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        aria-label="Environment or header value"
                        type={secretLike && !revealed[row.id] ? 'password' : 'text'}
                        autoComplete="off"
                        value={row.value}
                        disabled={valueLocked}
                        onChange={(event) => updateRow(row.id, { value: event.target.value })}
                        placeholder={
                          valueLocked
                            ? 'Secure storage unavailable'
                            : secretLike
                              ? 'Stored encrypted'
                              : 'value'
                        }
                        className="h-8 pr-8 font-mono text-[11px]"
                      />
                      {secretLike && secretsAvailable && (
                        <button
                          type="button"
                          aria-label={revealed[row.id] ? 'Hide value' : 'Show value'}
                          className="absolute right-2 top-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={toggleReveal}
                        >
                          <Icon name={revealed[row.id] ? 'eyeOff' : 'eye'} className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {!row.locked ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-danger"
                        aria-label="Remove field"
                        onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
                      >
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => onClear(row)}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>
    </div>
  )
}

function splitArgs(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
