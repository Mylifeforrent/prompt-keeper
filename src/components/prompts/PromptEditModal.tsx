import { useEffect, useState } from 'react'
import type { Prompt, PromptVariable } from '../../types'
import { Badge, Button, Input, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, nowIso, uid } from '../../lib/utils'
import { mergeVariableDefs } from '../../lib/variables'
import { useStore } from '../../store/store'
import { promptFilePath } from '../../lib/promptSync'
import { folderOptions, normalizeFolder } from '../../lib/folders'
import { FolderField } from '../shared/FolderTree'

const emptyDraft = (): Prompt => ({
  id: '',
  title: '',
  description: '',
  systemPrompt: '',
  userPrompt: '',
  folder: null,
  tags: [],
  isFavorite: false,
  isPinned: false,
  usageCount: 0,
  variables: [],
  syncPolicy: 'inherit',
  inRepo: false,
  versions: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
})

export function PromptEditModal({
  open,
  prompt,
  onClose,
}: {
  open: boolean
  prompt: Prompt | null // null = create new
  onClose: () => void
}) {
  const { state, savePrompt } = useStore()
  const [draft, setDraft] = useState<Prompt>(emptyDraft)
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(prompt ? { ...prompt } : emptyDraft())
      setTagInput('')
      setError(null)
    }
  }, [open, prompt])

  const variableDefs = mergeVariableDefs([draft.systemPrompt, draft.userPrompt], draft.variables)
  const folders = folderOptions(state.prompts, (p) => p.folder)
  const set = (patch: Partial<Prompt>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = () => {
    if (!draft.title.trim()) {
      setError('Title is required')
      return
    }
    if (!draft.systemPrompt.trim() && !draft.userPrompt.trim()) {
      setError('Fill in at least one of System Prompt or User Prompt')
      return
    }
    const next: Prompt = {
      ...draft,
      id: draft.id || uid(),
      title: draft.title.trim(),
      folder: normalizeFolder(draft.folder),
      variables: variableDefs,
      updatedAt: nowIso(),
    }
    savePrompt(next)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prompt ? 'Edit Prompt' : 'New Prompt'}
      width="max-w-2xl"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save (auto-creates version)</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
          <Input aria-label="Title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Code Review Assistant" />
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => set({ folder })}
          options={folders}
          pathPreview={promptFilePath(
            { ...draft, title: draft.title || 'untitled', folder: draft.folder },
            state.repo.layout.prompts,
          )}
          hint="After saving, the folder becomes a repo directory; moving folders moves the file paths too."
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Input aria-label="Description" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="One line on what this is for" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">System Prompt</label>
          <Textarea aria-label="System Prompt" rows={4} value={draft.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} placeholder="Set the role and output requirements…" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">User Prompt</label>
          <Textarea aria-label="User Prompt" rows={5} value={draft.userPrompt} onChange={(e) => set({ userPrompt: e.target.value })} placeholder="Body template; use {{variable}} or {{variable:example}}…" />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Tags
            <span className="font-normal">Press Enter to add, click × to remove</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((t) => (
              <Badge key={t} variant="primary" className="gap-1 py-1">
                {t}
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  className="cursor-pointer"
                  onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}
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
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault()
                  if (!draft.tags.includes(tagInput.trim())) set({ tags: [...draft.tags, tagInput.trim()] })
                  setTagInput('')
                }
              }}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Sync scope
            <span className="font-normal">Git sync is optional; keep private prompts local only</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { v: 'inherit', title: 'Follow repository policy', desc: 'Included when the repo enables Prompt sync' },
                { v: 'sync', title: 'Participate in sync', desc: 'Explicitly push to the Git repo' },
                { v: 'local', title: 'Local only', desc: 'Never enters Git or pending pushes' },
              ] as const
            ).map((o) => {
              const disabled = o.v === 'sync' && !state.repo.policies.prompts
              const active = draft.syncPolicy === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ syncPolicy: o.v })}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                  )}
                >
                  <div className="text-xs font-medium">{o.title}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{o.desc}</div>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {state.repo.connected
              ? 'You can still adjust this on the detail page; changes in sync scope become pending pushes and are never committed automatically.'
              : 'No repo connected; the sync scope is saved as a preference only.'}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Detected template variables</label>
          {variableDefs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No variables detected. Write {`{{variable}}`} in the body; a form appears when copying or testing.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {variableDefs.map((v) => (
                <VariableChip key={v.name} v={v} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function VariableChip({ v }: { v: PromptVariable }) {
  const [showDetail, setShowDetail] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={showDetail}
      onClick={() => setShowDetail((s) => !s)}
      className={cn(
        'cursor-pointer rounded-md border px-2 py-1 text-left text-[11px] transition-colors',
        showDetail ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
      )}
    >
      <span className="font-mono">{`{{${v.name}}}`}</span>
      <span className="ml-1.5 text-muted-foreground">{v.type}</span>
      {v.options && <span className="ml-1 text-muted-foreground">({v.options.join('/')})</span>}
    </button>
  )
}
