import { useMemo, useState } from 'react'
import type { Skill, StoreSkill } from '../../types'
import { useStore } from '../../store/store'
import { SKILL_PLATFORMS, SEED_STORE_SKILLS } from '../../data/seed'
import { Badge, Button, EmptyState } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { Markdown } from '../shared/Markdown'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { formatDate, uid, nowIso } from '../../lib/utils'
import { useToast } from '../ui/toast'
import {
  folderLabel,
  folderMatches,
  folderOptions,
  normalizeFolder,
} from '../../lib/folders'
import { skillFilePath } from '../../lib/skills'
import { FolderField, FolderTree } from '../shared/FolderTree'
import { Input, Textarea } from '../ui/core'

const SOURCE_BADGE: Record<Skill['source'], { label: string; variant: 'primary' | 'info' | 'secondary' | 'warning' }> = {
  official: { label: 'Official', variant: 'primary' },
  community: { label: 'Community', variant: 'info' },
  import: { label: 'Imported', variant: 'secondary' },
  scan: { label: 'Local scan', variant: 'warning' },
}

export function skillInstallStatus(skill: Skill, platformId: string): 'installed' | 'external' | 'none' {
  const mode = skill.installs[platformId]
  if (!mode) return 'none'
  return mode === 'external' ? 'external' : 'installed'
}

/* ---------------- My Skills ---------------- */

export function MySkills({ query }: { query: string }) {
  const { state, saveSkill, deleteSkill } = useStore()
  const toast = useToast()
  const [detailOf, setDetailOf] = useState<Skill | null>(null)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [deleteOf, setDeleteOf] = useState<Skill | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const q = query.trim().toLowerCase()

  const list = state.skills.filter((s) => {
    if (folderFilter && !folderMatches(s.folder, folderFilter)) return false
    if (!q) return true
    return [s.name, s.description, s.tags.join(' '), s.folder ?? ''].join(' ').toLowerCase().includes(q)
  })

  const sorted = useMemo(() => {
    return [...list].sort((a, b) => {
      const fa = a.folder ?? '\uffff'
      const fb = b.folder ?? '\uffff'
      return fa === fb ? a.name.localeCompare(b.name) : fa.localeCompare(fb, 'en')
    })
  }, [list])

  return (
    <div className="flex h-full min-h-0">
      <FolderTree
        items={state.skills}
        getFolder={(s) => s.folder}
        selected={folderFilter}
        onSelect={setFolderFilter}
        className="hidden w-[180px] shrink-0 border-r border-border bg-card/40 xl:flex"
        title="Skill folders"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState
            icon="grid"
            title={q || folderFilter ? 'No matching skills' : 'No skills yet'}
            description={q || folderFilter ? 'Try another keyword or folder' : 'Install from the Skill Store, or import from a local scan'}
          />
        ) : (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Icon name="grid" className="h-3.5 w-3.5" />
              <span>
                <span className="tabular font-medium text-foreground">{list.length}</span> skills
              </span>
              {folderFilter && (
                <>
                  <span className="text-border">/</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                    <Icon name="folder" className="h-3 w-3" />
                    {folderLabel(folderFilter)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFolderFilter('')}
                    className="cursor-pointer rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary-soft"
                  >
                    Show all
                  </button>
                </>
              )}
              <span className="ml-auto hidden items-center gap-1.5 sm:flex">
                <Icon name="layers" className="h-3 w-3" />
                One skill per directory · skills/&lt;folder&gt;/&lt;name&gt;/
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((s) => {
                const installed = Object.entries(s.installs).filter(([, m]) => m !== 'external').length
                const external = Object.values(s.installs).filter((m) => m === 'external').length
                const src = SOURCE_BADGE[s.source]
                const pending = state.syncChanges.some(
                  (c) =>
                    c.kind === 'skill' &&
                    !c.resolved &&
                    (c.assetId ? c.assetId === s.id : c.assetName === s.name),
                )
                return (
                  <div
                    key={s.id}
                    className="group relative flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:-translate-y-px hover:border-primary/35 hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => setDetailOf(s)}
                      className="flex min-w-0 cursor-pointer flex-col text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/70 text-lg">
                          {s.emoji}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium leading-5">{s.name}</div>
                          <div className="truncate text-[10.5px] text-muted-foreground">
                            v{s.version} · {s.author}
                          </div>
                        </div>
                        <Badge variant={src.variant} className="shrink-0 font-normal">
                          {src.label}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-8 text-[11.5px] leading-4 text-muted-foreground">
                        {s.description}
                      </p>
                    </button>
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2.5">
                      <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <Icon name="folder" className="h-3 w-3 shrink-0" />
                        <span className="truncate">{folderLabel(s.folder)}</span>
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {installed > 0 ? (
                          <Badge variant="success" className="gap-1 font-normal">
                            <Icon name="check" className="h-3 w-3" />
                            {installed} platforms
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="font-normal">Not dispatched</Badge>
                        )}
                        {external > 0 && <Badge variant="warning" className="font-normal">External {external}</Badge>}
                        {pending && <Badge variant="warning" className="font-normal">Pending push</Badge>}
                        <button
                          type="button"
                          onClick={() => setEditing(s)}
                          aria-label={`Edit ${s.name}`}
                          title="Edit"
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Icon name="pencil" className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {detailOf && (
        <SkillDetailModal
          skill={detailOf}
          onClose={() => setDetailOf(null)}
          onEdit={() => {
            setEditing(detailOf)
            setDetailOf(null)
          }}
          onDelete={() => {
            setDeleteOf(detailOf)
            setDetailOf(null)
          }}
        />
      )}
      {editing && <SkillEditModal skill={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={() => {
          if (deleteOf) {
            deleteSkill(deleteOf.id)
            toast.success(`Deleted "${deleteOf.name}"`)
          }
        }}
        title="Delete skill?"
        message={
          <>
            This removes the local skill "<b className="text-foreground">{deleteOf?.name}</b>" and all of its version history.
            Files already installed in Agent directories are not removed automatically, and repo files are not deleted.
          </>
        }
      />
    </div>
  )
}

/* ---------------- Skill details ---------------- */

function SkillDetailModal({
  skill,
  onClose,
  onEdit,
  onDelete,
}: {
  skill: Skill
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { state, setSkillInstall, restoreSkillVersion, deleteSkillVersion } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<'content' | 'platforms'>('content')
  const [installTarget, setInstallTarget] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const src = SOURCE_BADGE[skill.source]

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width="max-w-3xl"
        title={
          <span className="flex items-center gap-2">
            <span className="text-base">{skill.emoji}</span>
            {skill.name}
            <Badge variant={src.variant}>{src.label}</Badge>
            <AssetSyncBadge kind="skill" name={skill.name} />
          </span>
        }
        subtitle={`${skill.description} · v${skill.version} · ${skill.author}`}
        footer={
          <>
            <span className="mr-auto text-[11px] text-muted-foreground">
              Installed {skill.installedAt ? formatDate(skill.installedAt, false) : '—'}
            </span>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={onDelete}>
              <Icon name="trash" className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowVersions(true)}>
              <Icon name="history" className="h-3.5 w-3.5" />
              Version history ({skill.versions.length})
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="secondary">
            <Icon name="folder" className="h-3 w-3" />
            {folderLabel(skill.folder)}
          </Badge>
          <span className="flex items-center gap-1">
            <Icon name="gitBranch" className="h-3 w-3" />
            Repo file
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {skillFilePath(skill, state.repo.layout.skills)}
          </code>
        </div>
        <div className="mb-3 flex items-center gap-1">
          {(
            [
              { v: 'content', label: 'Instructions (SKILL.md)' },
              { v: 'platforms', label: `Platforms (${Object.values(skill.installs).filter((m) => m !== 'external').length}/${SKILL_PLATFORMS.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTab(t.v)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium ${
                tab === t.v ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'content' ? (
          <Markdown text={skill.instructions} />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              In symlink mode, multiple tools share one file and edits sync instantly; in copy mode, each platform keeps its own copy. The real product writes to each platform's directory following its conventions.
            </p>
            {SKILL_PLATFORMS.map((p) => {
              const status = skillInstallStatus(skill, p.id)
              const mode = skill.installs[p.id]
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <Icon name="folder" className="text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{p.dir}/{skill.name}/</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {status === 'installed' && <Badge variant="success">Installed · {mode === 'symlink' ? 'symlink' : 'copy'}</Badge>}
                    {status === 'external' && <Badge variant="warning">External install</Badge>}
                    {status === 'none' && <Badge variant="outline">Not installed</Badge>}
                    {status === 'none' ? (
                      <Button size="sm" variant="outline" onClick={() => setInstallTarget(p.id)}>
                        Install
                      </Button>
                    ) : status === 'installed' ? (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoveTarget(p.id)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* Install mode selection */}
      <Modal
        open={!!installTarget}
        onClose={() => setInstallTarget(null)}
        title={`Install to ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name ?? ''}`}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setInstallTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (installTarget) {
                  setSkillInstall(skill.id, installTarget, 'symlink')
                  toast.success(`Installed to ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name} via symlink`)
                }
                setInstallTarget(null)
              }}
            >
              Confirm install
            </Button>
          </>
        }
      >
        <ModeChooser
          onConfirm={(mode) => {
            if (installTarget) {
              setSkillInstall(skill.id, installTarget, mode)
              toast.success(`Installed to ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name} via ${mode}`)
            }
            setInstallTarget(null)
          }}
        />
      </Modal>

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            setSkillInstall(skill.id, removeTarget, null)
            toast.success(`Removed from ${SKILL_PLATFORMS.find((p) => p.id === removeTarget)?.name}`)
          }
        }}
        title="Remove from platform?"
        confirmText="Remove"
        message={`This deletes ${skill.name}/ from the skill directory for ${SKILL_PLATFORMS.find((p) => p.id === removeTarget)?.name ?? ''} (in copy mode it removes the separate copy and leaves this library untouched).`}
      />

      {showVersions && (
        <VersionHistoryModal
          open
          onClose={() => setShowVersions(false)}
          title={`Version history — ${skill.name}`}
          versions={skill.versions}
          fields={[{ key: 'instructions', label: 'SKILL.md' }]}
          onRestore={(v) => {
            restoreSkillVersion(skill.id, v.id)
            toast.success(`Restored v${v.version}`)
          }}
          onDeleteVersion={(vid) => {
            deleteSkillVersion(skill.id, vid)
            toast.success('Version deleted')
          }}
        />
      )}
    </>
  )
}

function ModeChooser({ onConfirm }: { onConfirm: (mode: 'symlink' | 'copy') => void }) {
  const [mode, setMode] = useState<'symlink' | 'copy'>('symlink')
  return (
    <div className="space-y-3">
      {(
        [
          { v: 'symlink', title: 'symlink (recommended)', desc: 'Creates a symlink in the platform directory so multiple tools share one copy; edits in this library take effect immediately' },
          { v: 'copy', title: 'copy', desc: 'Copies the whole directory to the platform directory; each platform gets its own copy and must be re-dispatched after library updates' },
        ] as const
      ).map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => setMode(o.v)}
          className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
            mode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
          }`}
        >
          <Icon name={o.v === 'symlink' ? 'link' : 'copy'} className={mode === o.v ? 'mt-0.5 text-primary' : 'mt-0.5 text-muted-foreground'} />
          <span>
            <span className="block text-sm font-medium">{o.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{o.desc}</span>
          </span>
        </button>
      ))}
      <Button className="w-full" onClick={() => onConfirm(mode)}>
        Install in {mode} mode
      </Button>
    </div>
  )
}

/* ---------------- Skill editing ---------------- */

function SkillEditModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { state, saveSkill } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<Skill>({ ...skill, tags: [...skill.tags] })
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const folders = folderOptions(state.skills, (s) => s.folder)

  const submit = () => {
    if (!draft.name.trim()) {
      setError('Skill name is required')
      return
    }
    const dup = state.skills.find(
      (s) => s.name === draft.name.trim() && s.id !== draft.id,
    )
    if (dup) {
      setError(`Name already used by existing skill "${dup.name}"; repo directories would conflict`)
      return
    }
    if (!draft.instructions.trim()) {
      setError('SKILL.md content is required')
      return
    }
    saveSkill({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      folder: normalizeFolder(draft.folder),
      instructions: draft.instructions.trim(),
    })
    toast.success(`Saved "${draft.name}"; local changes are pending push`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`Edit skill — ${skill.name}`}
      subtitle="The skill directory maps to the repo by folder; saving creates a version and marks it pending push"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="w-16">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Icon</label>
            <Input
              aria-label="Icon"
              value={draft.emoji}
              onChange={(e) => setDraft((d) => ({ ...d, emoji: e.target.value }))}
              className="text-center text-lg"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
            <Input
              aria-label="Name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="font-mono text-xs"
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Version</label>
            <Input
              aria-label="Version"
              value={draft.version}
              onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
            />
          </div>
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => setDraft((d) => ({ ...d, folder }))}
          options={folders}
          pathPreview={skillFilePath(
            { ...draft, name: draft.name || 'untitled', folder: draft.folder },
            state.repo.layout.skills,
          )}
          hint="One skill per directory, containing SKILL.md and scripts/; the folder becomes the repo directory as-is."
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <Input
            aria-label="Description"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </div>

        <div>
          <label className="mb-1.5 text-xs font-medium text-muted-foreground">Tags</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((tag) => (
              <Badge key={tag} variant="primary" className="gap-1 py-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="cursor-pointer"
                  onClick={() => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== tag) }))}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="Add tag"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={draft.tags.length ? '' : 'git, testing, docs…'}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault()
                  if (!draft.tags.includes(tagInput.trim())) {
                    setDraft((d) => ({ ...d, tags: [...d.tags, tagInput.trim()] }))
                  }
                  setTagInput('')
                }
              }}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">SKILL.md *</label>
          <Textarea
            aria-label="SKILL.md content"
            rows={14}
            value={draft.instructions}
            onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
            className="font-mono text-xs leading-5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            The content syncs as SKILL.md; when scripts are included, pull review flags it as "Contains executable scripts".
          </p>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Skill Store ---------------- */

export function StoreTab({ query }: { query: string }) {
  const { state, addSkillFromStore } = useStore()
  const toast = useToast()
  const [source, setSource] = useState<'all' | 'official' | 'community'>('all')
  const [category, setCategory] = useState('')
  const [reviewOf, setReviewOf] = useState<StoreSkill | null>(null)
  const q = query.trim().toLowerCase()

  const categories = [...new Set(SEED_STORE_SKILLS.map((s) => s.category))]

  const list = SEED_STORE_SKILLS.filter((s) => {
    if (source !== 'all' && s.source !== source) return false
    if (category && s.category !== category) return false
    if (q && ![s.name, s.description].join(' ').toLowerCase().includes(q)) return false
    return true
  })

  const installedNames = new Set(state.skills.map((s) => s.name))

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { v: 'all', label: 'All' },
              { v: 'official', label: 'Official' },
              { v: 'community', label: 'Community' },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setSource(t.v)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium ${
                source === t.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => setCategory('')}
            className={`cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors ${!category ? 'border-primary/40 bg-primary-soft font-medium text-primary' : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted'}`}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`cursor-pointer rounded-md border px-2.5 py-[3px] text-[11px] transition-colors ${category === c ? 'border-primary/40 bg-primary-soft font-medium text-primary' : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="search" title="No matching skills" description="Try another keyword or source filter" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const installed = installedNames.has(s.name)
            return (
              <div key={s.id} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/70 text-lg">{s.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-5">{s.name}</div>
                    <div className="tabular flex items-center gap-1 text-[10.5px] text-muted-foreground">
                      <span className="truncate">{s.author}</span>
                      <span>·</span>
                      <Icon name="download" className="h-3 w-3" />
                      {s.downloads.toLocaleString('en-US')}
                    </div>
                  </div>
                  <Badge variant={s.source === 'official' ? 'primary' : 'info'} className="ml-auto shrink-0 font-normal">
                    {s.source === 'official' ? 'Official' : 'Community'}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">{s.description}</p>
                <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2.5">
                  {installed ? (
                    <Badge variant="success">
                      <Icon name="check" className="h-3 w-3" />
                      In My Skills
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-primary/25 text-primary hover:border-primary/40 hover:bg-primary-soft"
                      onClick={() => setReviewOf(s)}
                      aria-label={`Install ${s.name}`}
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      Install
                    </Button>
                  )}
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s.category}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reviewOf && (
        <InstallReviewModal
          item={reviewOf}
          onClose={() => setReviewOf(null)}
          onInstalled={(platforms, mode) => {
            addSkillFromStore({
              id: uid(),
              name: reviewOf.name,
              emoji: reviewOf.emoji,
              description: reviewOf.description,
              author: reviewOf.author,
              version: reviewOf.version,
              source: reviewOf.source,
              category: reviewOf.category,
              folder: reviewOf.category,
              tags: [reviewOf.category],
              instructions: reviewOf.instructions,
              installs: Object.fromEntries(platforms.map((p) => [p, mode])),
              versions: [
                {
                  id: uid(),
                  version: 1,
                  note: `From the store v${reviewOf.version}`,
                  createdAt: nowIso(),
                  data: { instructions: reviewOf.instructions },
                },
              ],
              installedAt: nowIso(),
            })
            toast.success(`Installed "${reviewOf.name}" and dispatched to ${platforms.length} platforms`)
            setReviewOf(null)
          }}
        />
      )}
    </div>
  )
}

/* ---------------- Three-step install review ---------------- */

function InstallReviewModal({
  item,
  onClose,
  onInstalled,
}: {
  item: StoreSkill
  onClose: () => void
  onInstalled: (platforms: string[], mode: 'symlink' | 'copy') => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [platforms, setPlatforms] = useState<string[]>(['claude'])
  const [mode, setMode] = useState<'symlink' | 'copy'>('symlink')
  const [installing, setInstalling] = useState(false)
  const [results, setResults] = useState<{ id: string; ok: boolean }[]>([])
  const totalSize = item.files.reduce((acc, f) => acc + parseFloat(f.size), 0).toFixed(1)

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`Install review — ${item.name}`}
      subtitle={
        ['Step 1 · Review skill content', 'Step 2 · Choose target platforms', 'Step 3 · Install results'][step - 1]
      }
      footer={
        step === 1 ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setStep(2)}>
              Content looks good, continue
              <Icon name="chevronRight" />
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="outline" onClick={() => setStep(1)}>
              Back to review
            </Button>
            <Button disabled={platforms.length === 0 || installing} onClick={() => {
              setInstalling(true)
              setTimeout(() => {
                setResults(platforms.map((id) => ({ id, ok: true })))
                setInstalling(false)
                setStep(3)
              }, 700)
            }}>
              {installing ? 'Installing…' : `Confirm install (${platforms.length} platforms)`}
            </Button>
          </>
        ) : (
          <Button onClick={() => onInstalled(platforms, mode)}>Done</Button>
        )
      }
    >
      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
            <Icon name="shield" />
            Review is required before installing: the following content is written verbatim to the target platform directory.
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">v{item.version}</Badge>
            <Badge variant="outline">{item.files.length} files</Badge>
            <Badge variant="outline">{totalSize} KB total</Badge>
          </div>
          <div className="rounded-lg border border-border">
            {item.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs last:border-0">
                <Icon name="file" className="text-muted-foreground" />
                <span className="font-mono">{f.path}</span>
                <span className="ml-auto text-muted-foreground">{f.size}</span>
              </div>
            ))}
          </div>
          <Markdown text={item.instructions} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Target platforms (multi-select)</div>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_PLATFORMS.map((p) => {
                const active = platforms.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatforms((prev) => (active ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {active && <Icon name="check" className="mr-1 inline h-3 w-3" />}
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Install mode</div>
            <ModeChooser onConfirm={(m) => setMode(m)} />
            <p className="mt-1 text-[11px] text-muted-foreground">This choice applies in step 3; currently selected: {mode}</p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          {results.map((r) => {
            const p = SKILL_PLATFORMS.find((x) => x.id === r.id)
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                {r.ok ? <Icon name="check" className="text-success" /> : <Icon name="x" className="text-danger" />}
                {p?.name}
                <span className="ml-auto text-xs text-muted-foreground">{r.ok ? `Written in ${mode} mode to ${p?.dir}/${item.name}/` : 'Failed'}</span>
              </div>
            )
          })}
          <p className="pt-1 text-xs text-muted-foreground">In the real product, when symlink falls back to copy because the filesystem does not support it, each fallback is reported individually.</p>
        </div>
      )}
    </Modal>
  )
}
