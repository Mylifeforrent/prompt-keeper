import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PromptDetail, PromptVariable, PromptVariableType } from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { FolderField } from '../shared/FolderTree'
import { DiffView } from '../shared/DiffView'
import { Icon } from '../../lib/icons'
import { cn, formatDate } from '../../lib/utils'
import { errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { useToast } from '../ui/toast'
import { folderOptionsFromTree, normalizeTags } from '../../lib/promptView'
import { mergeVariableDefs, validateVariableDefinitions } from '../../../shared/domain/variables'
import { normalizeFolder, validateFolder } from '../../../shared/domain/folders'
import { promptRepoPath } from '../../../shared/domain/promptFile'

interface PromptDraft {
  title: string
  description: string
  folder: string
  tags: string[]
  systemPrompt: string
  userPrompt: string
}

interface ConflictState {
  currentVersion: number
  updatedAt: string
  current: PromptDetail | null
  loading: boolean
}

const EMPTY_DRAFT: PromptDraft = {
  title: '',
  description: '',
  folder: '',
  tags: [],
  systemPrompt: '',
  userPrompt: '',
}

const VARIABLE_TYPES: Array<{ value: PromptVariableType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
]

function draftFromPrompt(prompt: PromptDetail): PromptDraft {
  return {
    title: prompt.title,
    description: prompt.description,
    folder: prompt.folder,
    tags: prompt.tags,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
  }
}

function optionsTextFromVariables(variables: PromptVariable[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const variable of variables) result[variable.name] = (variable.options ?? []).join(', ')
  return result
}

export function PromptEditModal({
  open,
  prompt,
  onClose,
  onSaved,
}: {
  open: boolean
  prompt: PromptDetail | null
  onClose: () => void
  onSaved?: (prompt: PromptDetail) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT)
  const [variables, setVariables] = useState<PromptVariable[]>([])
  const [optionsText, setOptionsText] = useState<Record<string, string>>({})
  const [tagInput, setTagInput] = useState('')
  const [baseRevisionId, setBaseRevisionId] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (prompt) {
      setDraft(draftFromPrompt(prompt))
      setVariables(prompt.variables)
      setOptionsText(optionsTextFromVariables(prompt.variables))
      setBaseRevisionId(prompt.currentRevisionId)
    } else {
      setDraft(EMPTY_DRAFT)
      setVariables([])
      setOptionsText({})
      setBaseRevisionId('')
    }
    setTagInput('')
    setSubmitted(false)
    setConflict(null)
    setCompareOpen(false)
    // Reset only when the dialog opens for a different asset; background detail
    // refetches for the same asset must not overwrite the user's draft.
  }, [open, prompt?.id])

  const foldersQuery = useQuery({
    queryKey: queryKeys.prompts.folders({ editor: true }),
    queryFn: () => ipc.prompts.folders({}),
    staleTime: 30_000,
    enabled: open,
  })
  const folderOptions = useMemo(
    () => folderOptionsFromTree(foldersQuery.data ?? []),
    [foldersQuery.data],
  )

  const detectedVariables = useMemo(
    () => mergeVariableDefs([draft.systemPrompt, draft.userPrompt], variables),
    [draft.systemPrompt, draft.userPrompt, variables],
  )

  const normalizedFolder = normalizeFolder(draft.folder)
  const titleError = draft.title.trim() ? null : 'Title is required.'
  const bodyError =
    draft.systemPrompt.trim() || draft.userPrompt.trim()
      ? null
      : 'Fill in at least one of System Prompt or User Prompt.'
  const folderError = validateFolder(normalizedFolder)
  const variableErrors = validateVariableDefinitions(detectedVariables)
  const formError = titleError ?? bodyError ?? folderError ?? variableErrors[0] ?? null
  const pathPreview = promptRepoPath(
    {
      id: prompt?.id ?? 'new-prompt',
      title: draft.title.trim() || 'untitled',
      folder: normalizedFolder,
    },
    'prompts',
  )

  const saveMutation = useMutation({
    mutationFn: (): Promise<PromptDetail> => {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        folder: normalizedFolder,
        tags: normalizeTags(tagInput.trim() ? [...draft.tags, tagInput] : draft.tags),
        systemPrompt: draft.systemPrompt,
        userPrompt: draft.userPrompt,
        variables: detectedVariables,
      }
      if (prompt) {
        return ipc.prompts.update({
          id: prompt.id,
          expectedRevisionId: baseRevisionId || prompt.currentRevisionId,
          ...payload,
        })
      }
      return ipc.prompts.create(payload)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['prompts'] })
      toast.success(
        prompt
          ? `Saved "${saved.title}" as v${saved.currentVersion}. A new revision was created.`
          : `Created "${saved.title}". It is stored only in the local library.`,
      )
      onSaved?.(saved)
      onClose()
    },
    onError: (error) => {
      if (prompt && isIpcError(error) && error.code === 'REVISION_CONFLICT') {
        const details = error.details
        const meta = details?.kind === 'revision-conflict' ? details : undefined
        setConflict({
          currentVersion: meta?.currentVersion ?? 0,
          updatedAt: meta?.updatedAt ?? '',
          current: null,
          loading: true,
        })
        toast.warning(
          'Save blocked: this Prompt changed after the editor opened. Your draft is preserved.',
        )
        void ipc.prompts
          .get(prompt.id)
          .then((current) => {
            setConflict((previous) =>
              previous ? { ...previous, current, loading: false } : previous,
            )
          })
          .catch((loadError) => {
            setConflict((previous) => (previous ? { ...previous, loading: false } : previous))
            toast.error(`Could not load the current version: ${errorMessage(loadError)}`)
          })
        return
      }
      toast.error(`Not saved: ${errorMessage(error)}`)
    },
  })

  const submit = () => {
    setSubmitted(true)
    if (!draft.title.trim() || !draft.systemPrompt.trim() && !draft.userPrompt.trim()) return
    if (folderError || variableErrors.length > 0) return
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  const submitRef = useRef(submit)
  submitRef.current = submit

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

  const applyCurrent = (current: PromptDetail) => {
    setDraft(draftFromPrompt(current))
    setVariables(current.variables)
    setOptionsText(optionsTextFromVariables(current.variables))
    setBaseRevisionId(current.currentRevisionId)
    setConflict(null)
    setCompareOpen(false)
    setSubmitted(false)
  }

  const reloadCurrent = () => {
    if (!conflict?.current) return
    applyCurrent(conflict.current)
    toast.info('Loaded the latest version. Review the draft and save to create a new revision.')
  }

  const updateVariable = (name: string, patch: Partial<PromptVariable>) => {
    setVariables((previous) => {
      const existing = previous.find((variable) => variable.name === name) ?? {
        name,
        type: 'text' as PromptVariableType,
      }
      const next: PromptVariable = { ...existing, ...patch, name }
      if (next.type !== 'select') delete next.options
      return [...previous.filter((variable) => variable.name !== name), next]
    })
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag) return
    setDraft((current) =>
      current.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
        ? current
        : { ...current, tags: [...current.tags, tag] },
    )
    setTagInput('')
  }

  const savingLabel = prompt ? 'Save (creates a new version)' : 'Create Prompt'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prompt ? 'Edit Prompt' : 'New Prompt'}
      subtitle={
        prompt
          ? 'Saving creates a new immutable revision. Metadata changes may create a pending push, but nothing is committed automatically.'
          : 'Prompts are stored only in the local library. Git sync is optional and configured separately.'
      }
      width="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-danger">
            {submitted && formError ? formError : null}
          </span>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
            {savingLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {conflict && (
          <div className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
            <div className="flex items-start gap-2">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  This Prompt changed after the editor opened. Your draft is preserved.
                </p>
                <p className="mt-0.5">
                  {conflict.loading
                    ? 'Loading the current version…'
                    : conflict.current
                      ? `Current version: v${conflict.current.currentVersion}. Updated ${formatDate(
                          conflict.updatedAt || conflict.current.updatedAt,
                        )}.`
                      : `Current version: v${conflict.currentVersion}. The current content could not be loaded; you can still compare later.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!conflict.current || conflict.loading}
                    onClick={reloadCurrent}
                  >
                    <Icon name="refresh" className="h-3.5 w-3.5" />
                    Reload current version
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!conflict.current}
                    onClick={() => setCompareOpen((current) => !current)}
                  >
                    <Icon name="history" className="h-3.5 w-3.5" />
                    {compareOpen ? 'Hide comparison' : 'Compare with current'}
                  </Button>
                </div>
              </div>
            </div>

            {compareOpen && conflict.current && (
              <div className="mt-3 space-y-3 text-foreground">
                {(
                  [
                    { key: 'title', label: 'Title', before: conflict.current.title, after: draft.title },
                    {
                      key: 'description',
                      label: 'Description',
                      before: conflict.current.description,
                      after: draft.description,
                    },
                    {
                      key: 'system',
                      label: 'System Prompt',
                      before: conflict.current.systemPrompt,
                      after: draft.systemPrompt,
                    },
                    {
                      key: 'user',
                      label: 'User Prompt',
                      before: conflict.current.userPrompt,
                      after: draft.userPrompt,
                    },
                  ] as const
                ).map((field) => (
                  <div key={field.key}>
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {field.label}: current → your draft
                    </div>
                    <DiffView before={field.before} after={field.after} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
          <Input
            aria-label="Title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="e.g. Code Review Assistant"
            aria-invalid={submitted && !!titleError}
          />
          {submitted && titleError && <p className="mt-1 text-[11px] text-danger">{titleError}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Input
            aria-label="Description"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="One line on what this Prompt is for"
          />
        </div>

        <FolderField
          value={draft.folder || null}
          onChange={(folder) => setDraft((current) => ({ ...current, folder: folder ?? '' }))}
          options={folderOptions}
          pathPreview={pathPreview}
          hint="Nested paths are allowed; moving the folder moves the repository file on the next sync."
        />
        {submitted && folderError && <p className="mt-1 text-[11px] text-danger">{folderError}</p>}

        <div>
          <label className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            Tags
            <span className="font-normal">Press Enter to add, click × to remove</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((tag) => (
              <Badge key={tag} variant="primary" className="gap-1 py-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="cursor-pointer"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      tags: current.tags.filter((existing) => existing !== tag),
                    }))
                  }
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="Add tag"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={draft.tags.length ? '' : 'Engineering, Writing…'}
              onChange={(event) => setTagInput(event.target.value)}
              onBlur={addTag}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag()
                }
              }}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">System Prompt</label>
          <Textarea
            aria-label="System Prompt"
            rows={4}
            value={draft.systemPrompt}
            onChange={(event) =>
              setDraft((current) => ({ ...current, systemPrompt: event.target.value }))
            }
            placeholder="Set the role and output requirements…"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">User Prompt</label>
          <Textarea
            aria-label="User Prompt"
            rows={5}
            value={draft.userPrompt}
            onChange={(event) =>
              setDraft((current) => ({ ...current, userPrompt: event.target.value }))
            }
            placeholder="Body template; use {{variable}} or {{variable:example}}…"
          />
          {submitted && bodyError && <p className="mt-1 text-[11px] text-danger">{bodyError}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            Detected variables
            <span className="font-normal">
              {detectedVariables.length > 0
                ? `${detectedVariables.length} found in the body`
                : 'None yet'}
            </span>
          </div>
          {detectedVariables.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Write {`{{variable}}`} in a body; a fill-in form appears when copying or testing.
            </p>
          ) : (
            <div className="space-y-2">
              {detectedVariables.map((variable) => (
                <div key={variable.name} className="rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {`{{${variable.name}}}`}
                    </code>
                    <Select
                      aria-label={`${variable.name} type`}
                      className="h-8 w-32 text-xs"
                      value={variable.type}
                      onChange={(event) =>
                        updateVariable(variable.name, {
                          type: event.target.value as PromptVariableType,
                        })
                      }
                    >
                      {VARIABLE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                    <Checkbox
                      checked={!!variable.required}
                      label="Required"
                      onChange={(required) => updateVariable(variable.name, { required })}
                    />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label={`${variable.name} example`}
                      className="h-8 text-xs"
                      value={variable.example ?? ''}
                      placeholder="Example value (shown as a placeholder)"
                      onChange={(event) =>
                        updateVariable(variable.name, {
                          example: event.target.value || undefined,
                        })
                      }
                    />
                    {variable.type === 'select' && (
                      <Input
                        aria-label={`${variable.name} options`}
                        className="h-8 text-xs"
                        value={optionsText[variable.name] ?? ''}
                        placeholder="Option A, Option B"
                        onChange={(event) => {
                          const text = event.target.value
                          setOptionsText((current) => ({ ...current, [variable.name]: text }))
                          updateVariable(variable.name, {
                            options: text
                              .split(',')
                              .map((option) => option.trim())
                              .filter(Boolean),
                          })
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {submitted && variableErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-[11px] text-danger">
              {variableErrors.map((error) => (
                <li key={error} className="flex items-start gap-1.5">
                  <Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className={cn('text-[11px] leading-5 text-muted-foreground')}>
          Press <kbd className="rounded border border-border bg-muted px-1">⌘/Ctrl</kbd> +{' '}
          <kbd className="rounded border border-border bg-muted px-1">Enter</kbd> to save. Variable
          values are never stored; only definitions (type, options, required) sync.
        </p>
      </div>
    </Modal>
  )
}
