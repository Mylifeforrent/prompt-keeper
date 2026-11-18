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
  official: { label: '官方精选', variant: 'primary' },
  community: { label: '社区', variant: 'info' },
  import: { label: '导入', variant: 'secondary' },
  scan: { label: '本地扫描', variant: 'warning' },
}

export function skillInstallStatus(skill: Skill, platformId: string): 'installed' | 'external' | 'none' {
  const mode = skill.installs[platformId]
  if (!mode) return 'none'
  return mode === 'external' ? 'external' : 'installed'
}

/* ---------------- 我的技能 ---------------- */

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
      return fa === fb ? a.name.localeCompare(b.name) : fa.localeCompare(fb, 'zh')
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
        title="技能文件夹"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState
            icon="grid"
            title={q || folderFilter ? '未找到匹配技能' : '还没有技能'}
            description={q || folderFilter ? '换个关键词或文件夹试试' : '去技能商店安装，或从本地扫描导入'}
          />
        ) : (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Icon name="grid" className="h-3.5 w-3.5" />
              <span>
                共 <span className="tabular font-medium text-foreground">{list.length}</span> 个技能
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
                    返回全部
                  </button>
                </>
              )}
              <span className="ml-auto hidden items-center gap-1.5 sm:flex">
                <Icon name="layers" className="h-3 w-3" />
                一个技能一个目录 · skills/&lt;folder&gt;/&lt;name&gt;/
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
                            {installed} 平台
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="font-normal">未分发</Badge>
                        )}
                        {external > 0 && <Badge variant="warning" className="font-normal">外部 {external}</Badge>}
                        {pending && <Badge variant="warning" className="font-normal">待推送</Badge>}
                        <button
                          type="button"
                          onClick={() => setEditing(s)}
                          aria-label={`编辑 ${s.name}`}
                          title="编辑"
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
            toast.success(`已删除「${deleteOf.name}」`)
          }
        }}
        title="删除技能？"
        message={
          <>
            将删除本地技能「<b className="text-foreground">{deleteOf?.name}</b>」及其全部历史版本。
            已安装到 Agent 目录的文件不会被自动移除；仓库文件也不会被删除。
          </>
        }
      />
    </div>
  )
}

/* ---------------- 技能详情 ---------------- */

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
              安装于 {skill.installedAt ? formatDate(skill.installedAt, false) : '—'}
            </span>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
              编辑
            </Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={onDelete}>
              <Icon name="trash" className="h-3.5 w-3.5" />
              删除
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowVersions(true)}>
              <Icon name="history" className="h-3.5 w-3.5" />
              版本历史（{skill.versions.length}）
            </Button>
            <Button size="sm" onClick={onClose}>
              完成
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
            仓库文件
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {skillFilePath(skill, state.repo.layout.skills)}
          </code>
        </div>
        <div className="mb-3 flex items-center gap-1">
          {(
            [
              { v: 'content', label: '指令内容（SKILL.md）' },
              { v: 'platforms', label: `分发平台（${Object.values(skill.installs).filter((m) => m !== 'external').length}/${SKILL_PLATFORMS.length}）` },
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
              symlink 模式多工具共享同一份文件、改动即时同步；copy 模式各平台保留独立副本。真实产品按平台规范写入对应目录。
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
                    {status === 'installed' && <Badge variant="success">已安装 · {mode === 'symlink' ? 'symlink' : 'copy'}</Badge>}
                    {status === 'external' && <Badge variant="warning">外部安装</Badge>}
                    {status === 'none' && <Badge variant="outline">未安装</Badge>}
                    {status === 'none' ? (
                      <Button size="sm" variant="outline" onClick={() => setInstallTarget(p.id)}>
                        安装
                      </Button>
                    ) : status === 'installed' ? (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoveTarget(p.id)}>
                        移除
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* 安装模式选择 */}
      <Modal
        open={!!installTarget}
        onClose={() => setInstallTarget(null)}
        title={`安装到 ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name ?? ''}`}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setInstallTarget(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (installTarget) {
                  setSkillInstall(skill.id, installTarget, 'symlink')
                  toast.success(`已通过 symlink 安装到 ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name}`)
                }
                setInstallTarget(null)
              }}
            >
              确认安装
            </Button>
          </>
        }
      >
        <ModeChooser
          onConfirm={(mode) => {
            if (installTarget) {
              setSkillInstall(skill.id, installTarget, mode)
              toast.success(`已通过 ${mode} 安装到 ${SKILL_PLATFORMS.find((p) => p.id === installTarget)?.name}`)
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
            toast.success(`已从 ${SKILL_PLATFORMS.find((p) => p.id === removeTarget)?.name} 移除`)
          }
        }}
        title="从平台移除？"
        confirmText="移除"
        message={`将从 ${SKILL_PLATFORMS.find((p) => p.id === removeTarget)?.name ?? ''} 的技能目录删除 ${skill.name}/（copy 模式删除独立副本，不影响本库）。`}
      />

      {showVersions && (
        <VersionHistoryModal
          open
          onClose={() => setShowVersions(false)}
          title={`版本历史 — ${skill.name}`}
          versions={skill.versions}
          fields={[{ key: 'instructions', label: 'SKILL.md' }]}
          onRestore={(v) => {
            restoreSkillVersion(skill.id, v.id)
            toast.success(`已恢复 v${v.version}`)
          }}
          onDeleteVersion={(vid) => {
            deleteSkillVersion(skill.id, vid)
            toast.success('已删除该历史版本')
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
          { v: 'symlink', title: 'symlink（推荐）', desc: '在平台目录创建符号链接，多工具共享同一份内容，本库内编辑即时生效' },
          { v: 'copy', title: 'copy', desc: '复制完整目录到平台目录，各平台独立副本；本库更新后需重新分发' },
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
        确认以 {mode} 模式安装
      </Button>
    </div>
  )
}

/* ---------------- 技能编辑 ---------------- */

function SkillEditModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { state, saveSkill } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<Skill>({ ...skill, tags: [...skill.tags] })
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const folders = folderOptions(state.skills, (s) => s.folder)

  const submit = () => {
    if (!draft.name.trim()) {
      setError('技能名称必填')
      return
    }
    const dup = state.skills.find(
      (s) => s.name === draft.name.trim() && s.id !== draft.id,
    )
    if (dup) {
      setError(`名称与现有技能「${dup.name}」重复；仓库目录会冲突`)
      return
    }
    if (!draft.instructions.trim()) {
      setError('SKILL.md 内容必填')
      return
    }
    saveSkill({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      folder: normalizeFolder(draft.folder),
      instructions: draft.instructions.trim(),
    })
    toast.success(`已保存「${draft.name}」，本地改动已进入待推送`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`编辑技能 — ${skill.name}`}
      subtitle="技能目录会按文件夹映射到仓库；保存后生成版本并进入待推送"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="w-16">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">图标</label>
            <Input
              aria-label="图标"
              value={draft.emoji}
              onChange={(e) => setDraft((d) => ({ ...d, emoji: e.target.value }))}
              className="text-center text-lg"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">名称 *</label>
            <Input
              aria-label="名称"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="font-mono text-xs"
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">版本</label>
            <Input
              aria-label="版本"
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
          hint="一个技能一个目录，目录内放 SKILL.md 与 scripts/；文件夹会原样成为仓库目录。"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述</label>
          <Input
            aria-label="描述"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </div>

        <div>
          <label className="mb-1.5 text-xs font-medium text-muted-foreground">标签</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((tag) => (
              <Badge key={tag} variant="primary" className="gap-1 py-1">
                {tag}
                <button
                  type="button"
                  aria-label={`移除标签 ${tag}`}
                  className="cursor-pointer"
                  onClick={() => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== tag) }))}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="添加标签"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={draft.tags.length ? '' : 'git、测试、文档…'}
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
            aria-label="SKILL.md 内容"
            rows={14}
            value={draft.instructions}
            onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
            className="font-mono text-xs leading-5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            内容会作为 SKILL.md 同步；含脚本时拉取审核会标记为「含可执行脚本」。
          </p>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- 技能商店 ---------------- */

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
              { v: 'all', label: '全部' },
              { v: 'official', label: '官方精选' },
              { v: 'community', label: '社区' },
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
            全部分类
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
        <EmptyState icon="search" title="未找到匹配技能" description="换个关键词或来源筛选" />
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
                      {s.downloads.toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={s.source === 'official' ? 'primary' : 'info'} className="ml-auto shrink-0 font-normal">
                    {s.source === 'official' ? '官方' : '社区'}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-[11.5px] leading-4 text-muted-foreground">{s.description}</p>
                <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2.5">
                  {installed ? (
                    <Badge variant="success">
                      <Icon name="check" className="h-3 w-3" />
                      已在我的技能
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-primary/25 text-primary hover:border-primary/40 hover:bg-primary-soft"
                      onClick={() => setReviewOf(s)}
                      aria-label={`安装 ${s.name}`}
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      安装
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
                  note: `来自商店 v${reviewOf.version}`,
                  createdAt: nowIso(),
                  data: { instructions: reviewOf.instructions },
                },
              ],
              installedAt: nowIso(),
            })
            toast.success(`「${reviewOf.name}」已安装并分发到 ${platforms.length} 个平台`)
            setReviewOf(null)
          }}
        />
      )}
    </div>
  )
}

/* ---------------- 三步安装审核流 ---------------- */

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
      title={`安装审核 — ${item.name}`}
      subtitle={
        ['第 1 步 · 审核技能内容', '第 2 步 · 选择目标平台', '第 3 步 · 安装结果'][step - 1]
      }
      footer={
        step === 1 ? (
          <>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => setStep(2)}>
              内容无问题，继续
              <Icon name="chevronRight" />
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="outline" onClick={() => setStep(1)}>
              返回审核
            </Button>
            <Button disabled={platforms.length === 0 || installing} onClick={() => {
              setInstalling(true)
              setTimeout(() => {
                setResults(platforms.map((id) => ({ id, ok: true })))
                setInstalling(false)
                setStep(3)
              }, 700)
            }}>
              {installing ? '安装中…' : `确认安装（${platforms.length} 个平台）`}
            </Button>
          </>
        ) : (
          <Button onClick={() => onInstalled(platforms, mode)}>完成</Button>
        )
      }
    >
      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
            <Icon name="shield" />
            安装前必须审核：以下内容将原样写入目标平台目录。
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">v{item.version}</Badge>
            <Badge variant="outline">{item.files.length} 个文件</Badge>
            <Badge variant="outline">共 {totalSize} KB</Badge>
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
            <div className="mb-2 text-xs font-medium text-muted-foreground">目标平台（多选）</div>
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
            <div className="mb-2 text-xs font-medium text-muted-foreground">安装模式</div>
            <ModeChooser onConfirm={(m) => setMode(m)} />
            <p className="mt-1 text-[11px] text-muted-foreground">这里的选择会在第 3 步生效；当前选中：{mode}</p>
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
                <span className="ml-auto text-xs text-muted-foreground">{r.ok ? `已以 ${mode} 模式写入 ${p?.dir}/${item.name}/` : '失败'}</span>
              </div>
            )
          })}
          <p className="pt-1 text-xs text-muted-foreground">真实产品在 symlink 因文件系统不支持而回退 copy 时，会给出逐条回退警告。</p>
        </div>
      )}
    </Modal>
  )
}
