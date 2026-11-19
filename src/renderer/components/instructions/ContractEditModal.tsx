import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ContractActivation,
  ContractActivationMode,
  ContractDetail,
  ContractScope,
  SyncPolicy,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import {
  isSafeRelativePath,
  normalizeFolder,
  slugify,
  validateFolder,
} from '../../../shared/domain/folders'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { useToast } from '../ui/toast'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  SYNC_POLICY_META,
  compatibilityFor,
  contractRepositoryPath,
  targetSupportsActivation,
} from '../../lib/contractView'

interface Draft {
  title: string
  description: string
  body: string
  folder: string
  tags: string[]
  scope: ContractScope
  pathPrefix: string
  activationMode: ContractActivationMode
  globsText: string
  activationDescription: string
  priority: number
  importsText: string
  targetIds: string[]
  syncPolicy: SyncPolicy
}

interface FieldError {
  field: string
  message: string
}

interface RevisionConflict {
  currentVersion: number
  updatedAt: string
}

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  body: '',
  folder: '',
  tags: [],
  scope: 'project',
  pathPrefix: '',
  activationMode: 'always',
  globsText: '',
  activationDescription: '',
  priority: 50,
  importsText: '',
  targetIds: ['agents-md'],
  syncPolicy: 'inherit',
}

function splitGlobs(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-[11px] leading-4 text-danger">{message}</p>
}

export function ContractEditModal({
  open,
  contract,
  folders,
  onClose,
  onSaved,
}: {
  open: boolean
  contract: ContractDetail | null
  folders: string[]
  onClose: () => void
  onSaved: (contract: ContractDetail) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [targetWarnings, setTargetWarnings] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [conflict, setConflict] = useState<RevisionConflict | null>(null)
  const submitRef = useRef<() => void>(() => {})

  const targetsQuery = useQuery({
    queryKey: queryKeys.targets,
    queryFn: () => ipc.targets.list(),
    staleTime: 5 * 60_000,
    enabled: open,
  })

  const contractId = contract?.id ?? null

  useEffect(() => {
    if (!open) return
    if (contract) {
      setDraft({
        title: contract.title,
        description: contract.description,
        body: contract.body,
        folder: contract.folder,
        tags: [...contract.tags],
        scope: contract.scope,
        pathPrefix: contract.pathPrefix ?? '',
        activationMode: contract.activation.mode,
        globsText: contract.activation.globs.join('\n'),
        activationDescription: contract.activation.description ?? '',
        priority: contract.priority,
        importsText: contract.imports.join('\n'),
        targetIds: [...contract.targetIds],
        syncPolicy: contract.syncPolicy,
      })
    } else {
      setDraft({ ...EMPTY_DRAFT, tags: [], targetIds: [...EMPTY_DRAFT.targetIds] })
    }
    setTagInput('')
    setError(null)
    setFieldErrors([])
    setTargetWarnings(null)
    setAcknowledged(false)
    setConflict(null)
  }, [open, contractId])

  const parsedGlobs = useMemo(() => splitGlobs(draft.globsText), [draft.globsText])
  const parsedImports = useMemo(() => splitLines(draft.importsText), [draft.importsText])
  const targets = targetsQuery.data ?? []
  const selectedTargets = targets.filter((target) => draft.targetIds.includes(target.id))
  const compatibility = selectedTargets.map((target) =>
    compatibilityFor(
      {
        mode: draft.activationMode,
        globs: parsedGlobs,
        ...(draft.activationDescription.trim()
          ? { description: draft.activationDescription.trim() }
          : {}),
      },
      parsedImports,
      target,
    ),
  )
  const blockingTargets = compatibility.filter((entry) => entry.blocking)
  const advisoryWarnings = compatibility.flatMap((entry) => entry.warnings)

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  const fieldError = (field: string) =>
    fieldErrors.find((entry) => entry.field === field || entry.field.startsWith(`${field}.`))
      ?.message

  const clearWarningAcknowledgement = () => {
    if (targetWarnings || acknowledged) {
      setTargetWarnings(null)
      setAcknowledged(false)
    }
  }

  const setMode = (mode: ContractActivationMode) => {
    clearWarningAcknowledgement()
    set({ activationMode: mode })
  }

  const toggleTarget = (targetId: string) => {
    clearWarningAcknowledgement()
    setDraft((current) => ({
      ...current,
      targetIds: current.targetIds.includes(targetId)
        ? current.targetIds.filter((id) => id !== targetId)
        : [...current.targetIds, targetId],
    }))
  }

  const validate = (): FieldError[] => {
    const errors: FieldError[] = []
    if (!draft.title.trim()) errors.push({ field: 'title', message: 'Title is required.' })
    if (!draft.body.trim()) errors.push({ field: 'body', message: 'Contract body is required.' })

    const folder = normalizeFolder(draft.folder)
    const folderError = validateFolder(folder)
    if (folderError) errors.push({ field: 'folder', message: folderError })

    if (draft.scope === 'path') {
      const prefix = draft.pathPrefix.trim()
      if (!prefix) {
        errors.push({ field: 'pathPrefix', message: 'Path scope requires a directory prefix.' })
      } else if (!isSafeRelativePath(prefix)) {
        errors.push({
          field: 'pathPrefix',
          message: 'Use a relative directory path without "." or ".." segments.',
        })
      }
    }

    if (draft.activationMode === 'glob' && parsedGlobs.length === 0) {
      errors.push({ field: 'activation', message: 'Glob activation requires at least one glob.' })
    }
    if (draft.activationMode === 'model' && !draft.activationDescription.trim()) {
      errors.push({
        field: 'activation',
        message: 'Model decision activation requires a description of when to apply.',
      })
    }

    if (!Number.isFinite(draft.priority) || draft.priority < 0) {
      errors.push({ field: 'priority', message: 'Priority must be a non-negative number.' })
    }

    if (draft.targetIds.length === 0) {
      errors.push({ field: 'targetIds', message: 'Select at least one target.' })
    }

    for (const item of parsedImports) {
      if (item.includes('://')) {
        errors.push({ field: 'imports', message: `Imports must be relative paths, not URLs: ${item}` })
        break
      }
      if (!isSafeRelativePath(item)) {
        errors.push({
          field: 'imports',
          message: `Import "${item}" must be a relative path without "." or ".." segments.`,
        })
        break
      }
    }

    return errors
  }

  const invalidateAfterSave = () => {
    void queryClient.invalidateQueries({ queryKey: ['contracts'] })
    void queryClient.invalidateQueries({ queryKey: ['projections'] })
    void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
    void queryClient.invalidateQueries({ queryKey: ['globalTargets'] })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const activation: ContractActivation = {
        mode: draft.activationMode,
        globs: draft.activationMode === 'glob' ? parsedGlobs : [],
        ...(draft.activationMode === 'model' && draft.activationDescription.trim()
          ? { description: draft.activationDescription.trim() }
          : {}),
      }
      const folder = normalizeFolder(draft.folder)
      const shared = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        body: draft.body.trim(),
        folder,
        scope: draft.scope,
        activation,
        priority: draft.priority,
        imports: parsedImports,
        targetIds: draft.targetIds,
        tags: draft.tags,
        ...(acknowledged ? { acknowledgeTargetWarnings: true } : {}),
      }
      if (contract) {
        const updated = await ipc.contracts.update({
          id: contract.id,
          expectedRevisionId: contract.currentRevisionId,
          ...shared,
          pathPrefix: draft.scope === 'path' ? draft.pathPrefix.trim() : null,
        })
        if (draft.syncPolicy !== contract.syncPolicy) {
          try {
            await ipc.contracts.setSyncPolicy({ id: contract.id, syncPolicy: draft.syncPolicy })
          } catch (policyError) {
            toast.warning(
              `The contract was saved, but the sync policy was not updated: ${errorMessage(policyError)}`,
            )
          }
        }
        return updated
      }
      return ipc.contracts.create({
        ...shared,
        ...(draft.scope === 'path' ? { pathPrefix: draft.pathPrefix.trim() } : {}),
        syncPolicy: draft.syncPolicy,
      })
    },
    onSuccess: (saved) => {
      invalidateAfterSave()
      toast.success(
        contract
          ? `Saved "${saved.title}". Affected projections were marked stale; Agent directories were not written.`
          : `Created "${saved.title}".`,
      )
      onSaved(saved)
      onClose()
    },
    onError: (mutationError) => {
      const details = errorDetails(mutationError)
      if (isIpcError(mutationError) && mutationError.code === 'REVISION_CONFLICT') {
        setConflict(
          details?.kind === 'revision-conflict'
            ? { currentVersion: details.currentVersion, updatedAt: details.updatedAt }
            : { currentVersion: contract?.currentVersion ?? 0, updatedAt: new Date().toISOString() },
        )
        setError(null)
        return
      }
      if (details?.kind === 'target-warnings') {
        setTargetWarnings(details.warnings)
        setAcknowledged(false)
        setError(null)
        return
      }
      if (details?.kind === 'validation') {
        setFieldErrors(
          details.fields.map((entry) => ({ field: entry.path, message: entry.message })),
        )
        setError('The contract was not saved because some fields are invalid.')
        return
      }
      if (details?.kind === 'duplicate') {
        setError(`A ${details.field} with the value "${details.value}" already exists. Choose another.`)
        return
      }
      setError(errorMessage(mutationError))
    },
  })

  const submit = () => {
    if (saveMutation.isPending) return
    setError(null)
    setConflict(null)
    const errors = validate()
    setFieldErrors(errors)
    if (errors.length > 0) {
      setError('Fix the highlighted fields before saving.')
      return
    }
    if (targetWarnings && !acknowledged) {
      setError('Acknowledge the target warnings before saving.')
      return
    }
    saveMutation.mutate()
  }

  useEffect(() => {
    submitRef.current = submit
  })

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        submitRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const repoPreview = contractRepositoryPath(
    normalizeFolder(draft.folder),
    contract?.slug ?? slugify(draft.title || 'untitled', 'contract'),
  )

  const addTag = () => {
    const value = tagInput.trim()
    if (!value) return
    if (!draft.tags.includes(value)) set({ tags: [...draft.tags, value] })
    setTagInput('')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contract ? 'Edit instruction contract' : 'New instruction contract'}
      subtitle="One canonical contract compiles per target into AGENTS.md, CLAUDE.md, Copilot instructions, .cursor/rules, or Windsurf rules."
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto min-w-0 truncate text-xs text-danger">
            {error ?? (targetWarnings && !acknowledged ? 'Target warnings need acknowledgement.' : '')}
          </span>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
            {saveMutation.isPending ? 'Saving…' : 'Save (creates a version)'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {conflict && (
          <div className="rounded-lg border border-warning/35 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
            <div className="flex items-start gap-2">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                This contract changed after the editor opened. The current version is{' '}
                <b>v{conflict.currentVersion}</b> (updated {formatDate(conflict.updatedAt)}). Your draft is
                kept and nothing was saved. Reload the current version before saving again.
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (contract) {
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.contracts.detail(contract.id),
                    })
                  }
                  onClose()
                }}
              >
                Close and reload
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
                Keep editing
              </Button>
            </div>
          </div>
        )}

        {fieldErrors.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
            {fieldErrors.map((entry) => (
              <div key={`${entry.field}-${entry.message}`} className="flex items-start gap-2 text-xs leading-5 text-danger">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <b>{entry.field}</b>: {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
            <Input
              aria-label="Title"
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder="e.g. Frontend code standards"
              aria-invalid={!!fieldError('title')}
            />
            <FieldError message={fieldError('title')} />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
            <Input
              aria-label="Priority"
              type="number"
              min={0}
              value={draft.priority}
              onChange={(event) => set({ priority: Number(event.target.value) })}
            />
            <FieldError message={fieldError('priority')} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Input
            aria-label="Description"
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="One line on what this contract constrains"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Folder</label>
          <Input
            aria-label="Folder"
            list="contract-folder-options"
            value={draft.folder}
            onChange={(event) => set({ folder: event.target.value })}
            placeholder="e.g. engineering/frontend"
            className="font-mono text-xs"
          />
          <datalist id="contract-folder-options">
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Use <code className="rounded bg-muted px-1">/</code> for nested directories; leave empty for
            Uncategorized.
          </p>
          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">→ {repoPreview}</p>
          <FieldError message={fieldError('folder')} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Scope</label>
            <Select
              aria-label="Scope"
              value={draft.scope}
              onChange={(event) => set({ scope: event.target.value as ContractScope })}
            >
              {(Object.keys(CONTRACT_SCOPE_META) as ContractScope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {CONTRACT_SCOPE_META[scope].label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {CONTRACT_SCOPE_META[draft.scope].description}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Path prefix</label>
            <Input
              aria-label="Path prefix"
              value={draft.pathPrefix}
              disabled={draft.scope !== 'path'}
              onChange={(event) => set({ pathPrefix: event.target.value })}
              placeholder="src"
              className="font-mono text-xs disabled:opacity-50"
              aria-invalid={!!fieldError('pathPrefix')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Required for Path scope; applies inside this directory and its descendants.
            </p>
            <FieldError message={fieldError('pathPrefix')} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Activation</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ACTIVATION_META) as ContractActivationMode[]).map((mode) => {
              const meta = ACTIVATION_META[mode]
              const active = draft.activationMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMode(mode)}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="text-xs font-medium">{meta.label}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                    {meta.description}
                  </div>
                </button>
              )
            })}
          </div>
          <FieldError message={fieldError('activation')} />
        </div>

        {draft.activationMode === 'glob' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Glob patterns *</label>
            <Textarea
              aria-label="Glob patterns"
              rows={3}
              value={draft.globsText}
              onChange={(event) => set({ globsText: event.target.value })}
              className="font-mono text-xs"
              placeholder={'src/**/*.{ts,tsx}\npackages/**'}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              One per line or comma-separated; supports **, *, ?, and {'{a,b}'}. Currently parsed:{' '}
              {parsedGlobs.length} pattern{parsedGlobs.length === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        {draft.activationMode === 'model' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              When to apply (model decision) *
            </label>
            <Input
              aria-label="When to apply"
              value={draft.activationDescription}
              onChange={(event) => {
                clearWarningAcknowledgement()
                set({ activationDescription: event.target.value })
              }}
              placeholder="e.g. When the user asks for a code review or to check changes"
            />
          </div>
        )}

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Projection targets *</label>
            <span className="text-[11px] text-muted-foreground">
              Capabilities are data-driven; incompatible targets are skipped, not downgraded.
            </span>
          </div>
          {targetsQuery.isPending ? (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-[74px] animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : targetsQuery.isError ? (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              <Icon name="alert" className="h-3.5 w-3.5" />
              The target registry could not be loaded.
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                onClick={() => void targetsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {targets.map((target) => {
                const active = draft.targetIds.includes(target.id)
                const supported = targetSupportsActivation(target, draft.activationMode)
                return (
                  <div
                    key={target.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleTarget(target.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleTarget(target.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                      active
                        ? supported
                          ? 'border-primary bg-primary-soft'
                          : 'border-warning bg-warning-soft/60'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span onClick={(event) => event.stopPropagation()} className="flex items-center">
                        <Checkbox checked={active} onChange={() => toggleTarget(target.id)} />
                      </span>
                      <span className="text-xs font-medium">{target.label}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {target.merge === 'single-file' ? 'Merged' : 'Separate'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {target.agentName}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {target.supports.globs && <Badge variant="outline">glob</Badge>}
                      {target.supports.modelDecision && <Badge variant="outline">model</Badge>}
                      {target.supports.manual && <Badge variant="outline">manual</Badge>}
                      {target.supports.imports && <Badge variant="outline">@import</Badge>}
                      {!supported && <Badge variant="warning">activation skipped</Badge>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <FieldError message={fieldError('targetIds')} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Claude @import (optional)
          </label>
          <Textarea
            aria-label="Claude @import"
            rows={2}
            value={draft.importsText}
            onChange={(event) => {
              clearWarningAcknowledgement()
              set({ importsText: event.target.value })
            }}
            className="font-mono text-xs"
            placeholder="docs/interaction-design.md"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            One relative path per line. Only targets that declare import support write them; others receive
            plain text with an explanation.
          </p>
          <FieldError message={fieldError('imports')} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Contract body *</label>
          <Textarea
            aria-label="Contract body"
            rows={12}
            value={draft.body}
            onChange={(event) => set({ body: event.target.value })}
            className="font-mono text-xs leading-5"
            placeholder={'# Frontend code standards\n\n- Function components + hooks\n- Use Tailwind tokens'}
            aria-invalid={!!fieldError('body')}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            The body is written verbatim into merged files; per-contract targets receive target-specific
            frontmatter automatically.
          </p>
          <FieldError message={fieldError('body')} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tags</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((tag) => (
              <Badge key={tag} variant="primary" className="gap-1 py-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="cursor-pointer"
                  onClick={() => set({ tags: draft.tags.filter((item) => item !== tag) })}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="Add tag"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={draft.tags.length ? '' : 'repository, frontend, review...'}
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
          <label className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            Sync scope
            <span className="font-normal">
              Instructions enter every session; keep private content local.
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SYNC_POLICY_META) as SyncPolicy[]).map((policy) => {
              const meta = SYNC_POLICY_META[policy]
              const active = draft.syncPolicy === policy
              return (
                <button
                  key={policy}
                  type="button"
                  onClick={() => set({ syncPolicy: policy })}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="text-xs font-medium">{meta.label}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                    {meta.description}
                  </div>
                </button>
              )
            })}
          </div>
          {contract && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              A changed sync scope is applied with this save through the sync-policy channel.
            </p>
          )}
        </div>

        {(advisoryWarnings.length > 0 || targetWarnings) && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
            <div className="flex items-start gap-2 text-xs font-medium leading-5 text-warning">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              {targetWarnings
                ? 'The backend requires acknowledgement of these target warnings.'
                : 'These selected targets cannot represent the current activation.'}
            </div>
            <ul className="mt-1 list-disc space-y-1 pl-8 text-xs leading-5 text-warning">
              {(targetWarnings ?? advisoryWarnings).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {targetWarnings && (
              <div className="mt-2 pl-1">
                <Checkbox
                  checked={acknowledged}
                  onChange={setAcknowledged}
                  label="I understand these targets will be skipped during projection and want to save anyway."
                />
              </div>
            )}
            {!targetWarnings && blockingTargets.length > 0 && (
              <p className="mt-1 text-[11px] leading-5 text-warning">
                Saving is allowed; these combinations appear as skipped in resolution preview and projections.
              </p>
            )}
          </div>
        )}

        <p className="text-[11px] leading-5 text-muted-foreground">
          Press <kbd className="rounded border border-border bg-muted px-1">Cmd/Ctrl</kbd> +{' '}
          <kbd className="rounded border border-border bg-muted px-1">Enter</kbd> to save. Saving never writes
          to Agent directories; projections must be confirmed separately.
        </p>
      </div>
    </Modal>
  )
}
