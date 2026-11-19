import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SkillCreateInput,
  SkillDetail,
  SkillFileEntry,
  SkillFileWrite,
  SkillUpdateInput,
} from '../../../shared/contracts'
import { isSafeRelativePath, normalizeFolder } from '../../../shared/domain/folders'
import { Badge, Button, Input, Spinner, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { FolderField } from '../shared/FolderTree'
import { useToast } from '../ui/toast'
import { Icon } from '../../lib/icons'
import { errorDetails, errorMessage, ipc } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import { cn } from '../../lib/utils'
import {
  SKILL_ENTRY_FILE,
  SCRIPT_ACK_NOTICE,
  formatBytes,
  isScriptFile,
  skillRepoPath,
} from '../../lib/skillView'

interface EditableFile {
  path: string
  content: string
}

interface SkillFormState {
  title: string
  description: string
  folder: string
  icon: string
  author: string
  versionLabel: string
  category: string
  tags: string[]
}

const emptyForm: SkillFormState = {
  title: '',
  description: '',
  folder: '',
  icon: '',
  author: '',
  versionLabel: '1.0.0',
  category: '',
  tags: [],
}

type FieldErrors = Record<string, string>

function initialFiles(): EditableFile[] {
  return [{ path: SKILL_ENTRY_FILE, content: '' }]
}

export function SkillEditModal({
  open,
  skill,
  folderOptions,
  onClose,
  onSaved,
}: {
  open: boolean
  skill?: SkillDetail | null
  folderOptions: string[]
  onClose: () => void
  onSaved: (saved: SkillDetail) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SkillFormState>(emptyForm)
  const [files, setFiles] = useState<EditableFile[]>(initialFiles)
  const [tagInput, setTagInput] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const loadedRevision = useRef<string | null>(null)

  const filesQuery = useQuery({
    queryKey: queryKeys.skills.files({ assetId: skill?.id ?? 'new', includeContent: true }),
    queryFn: () => {
      if (!skill) throw new Error('No Skill selected')
      return ipc.skills.files({ assetId: skill.id, includeContent: true })
    },
    enabled: open && !!skill,
  })

  const lockedFiles = useMemo<SkillFileEntry[]>(() => {
    const data = filesQuery.data
    if (!data) return []
    return data.files.filter(
      (file) => file.mediaKind === 'binary' || data.contents?.[file.path] === undefined,
    )
  }, [filesQuery.data])

  const fileEditingEnabled = !skill || (filesQuery.isSuccess && lockedFiles.length === 0)

  useEffect(() => {
    if (!open) {
      loadedRevision.current = null
      return
    }
    setErrors({})
    setTagInput('')
    if (skill) {
      setForm({
        title: skill.title,
        description: skill.description,
        folder: skill.folder,
        icon: skill.icon,
        author: skill.author,
        versionLabel: skill.versionLabel,
        category: skill.category,
        tags: [...skill.tags],
      })
    } else {
      setForm(emptyForm)
      setFiles(initialFiles())
    }
  }, [open, skill])

  useEffect(() => {
    if (!open || !skill) return
    const data = filesQuery.data
    if (!data) return
    const key = `${data.assetId}:${data.revisionId}`
    if (loadedRevision.current === key) return
    loadedRevision.current = key
    const contents = data.contents ?? {}
    setFiles(
      data.files
        .filter((file) => file.mediaKind === 'text' && contents[file.path] !== undefined)
        .map((file) => ({ path: file.path, content: contents[file.path] ?? '' }))
        .sort((a, b) => {
          if (a.path === SKILL_ENTRY_FILE) return -1
          if (b.path === SKILL_ENTRY_FILE) return 1
          return a.path.localeCompare(b.path, 'en')
        }),
    )
  }, [open, skill, filesQuery.data])

  const update = (patch: Partial<SkillFormState>) => setForm((current) => ({ ...current, ...patch }))

  const tags = form.tags

  const addTag = () => {
    const value = tagInput.trim()
    if (!value) return
    if (!tags.includes(value)) update({ tags: [...tags, value] })
    setTagInput('')
  }

  const folderPreview = skillRepoPath({
    title: form.title.trim() || 'untitled',
    slug: skill && form.title.trim() === skill.title ? skill.slug : undefined,
    folder: normalizeFolder(form.folder),
  })

  const renameWarning =
    !!skill && form.title.trim() !== '' && form.title.trim() !== skill.title
      ? `Renaming moves the repository entry to ${folderPreview} and marks existing Agent installs stale.`
      : null

  const validate = (): FieldErrors | null => {
    const next: FieldErrors = {}
    if (!form.title.trim()) next.title = 'Title is required.'
    if (fileEditingEnabled) {
      const entry = files.find((file) => file.path.trim() === SKILL_ENTRY_FILE)
      if (!entry) next.files = 'SKILL.md is required at the Skill root.'
      else if (!entry.content.trim()) next.files = 'SKILL.md content is required.'
      const seen = new Set<string>()
      for (const file of files) {
        const path = file.path.trim()
        if (!path) {
          next.files = next.files ?? 'Every file needs a path.'
          continue
        }
        if (!isSafeRelativePath(path)) {
          next.files = `"${path}" is not a safe relative path.`
          continue
        }
        const key = path.toLowerCase()
        if (seen.has(key)) {
          next.files = `Duplicate file path "${path}".`
          continue
        }
        seen.add(key)
      }
    }
    setErrors(next)
    return Object.keys(next).length ? next : null
  }

  const buildWrites = (): SkillFileWrite[] =>
    files.map((file) => ({ path: file.path.trim(), content: file.content }))

  const save = useMutation({
    mutationFn: async (): Promise<SkillDetail> => {
      const base = {
        title: form.title.trim(),
        description: form.description.trim(),
        folder: normalizeFolder(form.folder),
        icon: form.icon.trim(),
        author: form.author.trim(),
        versionLabel: form.versionLabel.trim(),
        category: form.category.trim(),
        tags: form.tags,
      }
      if (skill) {
        const input: SkillUpdateInput = {
          id: skill.id,
          expectedRevisionId: skill.currentRevisionId,
          ...base,
          ...(fileEditingEnabled ? { files: buildWrites() } : {}),
        }
        return ipc.skills.update(input)
      }
      const input: SkillCreateInput = { ...base, files: buildWrites() }
      return ipc.skills.create(input)
    },
    onSuccess: (saved) => {
      toast.success(
        skill
          ? `Saved "${saved.title}". Existing Agent installs are now stale until re-installed.`
          : `Created "${saved.title}".`,
      )
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      void queryClient.invalidateQueries({ queryKey: ['dispatch'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      onSaved(saved)
      onClose()
    },
    onError: () => {
      // Rendered inline so revision conflicts and validation details stay visible.
    },
  })

  const submit = () => {
    if (!validate()) save.mutate()
  }

  const mutationError = save.error
  const conflictDetails = errorDetails(mutationError)
  const revisionConflict =
    conflictDetails?.kind === 'revision-conflict' ? conflictDetails : null

  const errorText =
    mutationError && !revisionConflict
      ? errorMessage(mutationError)
      : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={skill ? `Edit Skill — ${skill.title}` : 'New Skill'}
      subtitle={
        skill
          ? `Saving creates revision v${skill.currentVersion + 1}. The complete file set is written as one revision.`
          : 'A Skill is a directory with a required SKILL.md and optional supporting text files.'
      }
      footer={
        <>
          <div className="mr-auto min-w-0">
            {errors.files && <p className="truncate text-xs text-danger">{errors.files}</p>}
            {errors.title && !errors.files && <p className="truncate text-xs text-danger">{errors.title}</p>}
            {revisionConflict && (
              <p className="truncate text-xs text-danger">
                This Skill changed since it was opened (current v{revisionConflict.currentVersion}).
              </p>
            )}
            {errorText && <p className="truncate text-xs text-danger">{errorText}</p>}
          </div>
          {revisionConflict ? (
            <Button
              variant="outline"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['skills'] })
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
                {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" className="h-3.5 w-3.5" />}
                {skill ? 'Save revision' : 'Create Skill'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-3">
          <div className="w-16">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Icon</label>
            <Input
              aria-label="Icon or emoji"
              value={form.icon}
              onChange={(event) => update({ icon: event.target.value })}
              placeholder="🛠"
              className="text-center text-lg"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
            <Input
              aria-label="Title"
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder="Code review helper"
              className={cn(errors.title && 'border-danger')}
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Version label</label>
            <Input
              aria-label="Version label"
              value={form.versionLabel}
              onChange={(event) => update({ versionLabel: event.target.value })}
              placeholder="1.0.0"
            />
          </div>
        </div>

        {renameWarning && (
          <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {renameWarning}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Author</label>
            <Input
              aria-label="Author"
              value={form.author}
              onChange={(event) => update({ author: event.target.value })}
              placeholder="Your name or team"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
            <Input
              aria-label="Category"
              value={form.category}
              onChange={(event) => update({ category: event.target.value })}
              placeholder="Engineering"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Textarea
            aria-label="Description"
            rows={2}
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="One line describing what this Skill helps the Agent do."
          />
        </div>

        <FolderField
          value={form.folder || null}
          onChange={(folder) => update({ folder: folder ?? '' })}
          options={folderOptions}
          pathPreview={folderPreview}
          hint="The folder becomes the repository directory; one Skill per directory."
        />

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tags</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="primary" className="gap-1 py-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="cursor-pointer"
                  onClick={() => update({ tags: tags.filter((value) => value !== tag) })}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="Add tag"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={tags.length ? '' : 'review, testing, docs…'}
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

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">Files</h3>
            <span className="text-[11px] text-muted-foreground">
              {fileEditingEnabled ? `${files.length} text files in this revision` : 'Revision files'}
            </span>
            {fileEditingEnabled && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setFiles((current) => [...current, { path: '', content: '' }])}
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add text file
              </Button>
            )}
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[11px] leading-5 text-info">
            <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {SCRIPT_ACK_NOTICE} Saving replaces the complete file set for the next revision.
          </p>

          {skill && filesQuery.isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" />
              Loading the current revision files…
            </div>
          )}

          {skill && filesQuery.isError && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11px] leading-5 text-warning">
              The current files could not be loaded: {errorMessage(filesQuery.error)}. Metadata can still be
              saved; the existing files are kept unchanged.
            </div>
          )}

          {skill && lockedFiles.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[11px] leading-5 text-warning">
              <p className="font-medium">File editing is disabled for this revision.</p>
              <p className="mt-0.5">
                Binary or oversized files cannot round-trip through the text editor, and saving a partial
                set would drop them. Saving keeps the current files; change metadata only.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {lockedFiles.map((file) => (
                  <li key={file.path} className="flex items-center gap-2 font-mono">
                    <Icon name="file" className="h-3 w-3 shrink-0" />
                    <span className="truncate">{file.path}</span>
                    <span className="ml-auto shrink-0">
                      {file.mediaKind === 'binary' ? 'binary' : formatBytes(file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fileEditingEnabled &&
            files.map((file, index) => {
              const isEntry = file.path.trim() === SKILL_ENTRY_FILE
              const sourceEntry = filesQuery.data?.files.find((entry) => entry.path === file.path)
              const executable = sourceEntry?.isExecutable ?? false
              const looksLikeScript =
                isEntry === false &&
                (isScriptFile({ path: file.path, size: 0, mediaKind: 'text', isExecutable: executable }) ||
                  file.path.split('/').some((segment) => segment.toLowerCase() === 'scripts'))
              return (
                <div key={index} className="rounded-lg border border-border bg-card/60 p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Input
                      aria-label={`File path ${index + 1}`}
                      value={file.path}
                      disabled={isEntry}
                      onChange={(event) =>
                        setFiles((current) =>
                          current.map((entry, i) =>
                            i === index ? { ...entry, path: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="scripts/run.sh"
                      className="font-mono text-xs"
                    />
                    {sourceEntry && (
                      <span className="tabular shrink-0 text-[10px] text-muted-foreground">
                        {formatBytes(sourceEntry.size)}
                      </span>
                    )}
                    {executable && <Badge variant="warning">exec</Badge>}
                    {looksLikeScript && <Badge variant="outline">script</Badge>}
                    {!isEntry && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-danger"
                        aria-label={`Remove file ${file.path || index + 1}`}
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      >
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    aria-label={`Content of ${file.path || `file ${index + 1}`}`}
                    rows={isEntry ? 12 : 6}
                    value={file.content}
                    onChange={(event) =>
                      setFiles((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, content: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder={isEntry ? '# Skill instructions' : 'File content (stored, never executed)'}
                    className="font-mono text-xs leading-5"
                  />
                  {looksLikeScript && (
                    <p className="mt-1 text-[10.5px] text-muted-foreground">
                      This file is stored and listed for review; Prompt Keeper never executes it.
                    </p>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </Modal>
  )
}
