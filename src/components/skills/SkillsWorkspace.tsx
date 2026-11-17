import { useState } from 'react'
import type { Skill, StoreSkill } from '../../types'
import { useStore } from '../../store/store'
import { SKILL_PLATFORMS, SEED_STORE_SKILLS } from '../../data/seed'
import { Badge, Button, EmptyState } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { Markdown } from '../shared/Markdown'
import { VersionHistoryModal } from '../shared/VersionHistoryModal'
import { formatDate, uid, nowIso } from '../../lib/utils'
import { useToast } from '../ui/toast'

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
  const { state } = useStore()
  const [detailOf, setDetailOf] = useState<Skill | null>(null)
  const q = query.trim().toLowerCase()
  const list = state.skills.filter(
    (s) => !q || [s.name, s.description, s.tags.join(' ')].join(' ').toLowerCase().includes(q),
  )

  if (list.length === 0) {
    return (
      <EmptyState
        icon="grid"
        title={q ? '未找到匹配技能' : '还没有技能'}
        description={q ? '换个关键词试试' : '去技能商店安装，或从本地扫描导入'}
      />
    )
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3 p-4">
        {list.map((s) => {
          const installed = Object.entries(s.installs).filter(([, m]) => m !== 'external').length
          const external = Object.values(s.installs).filter((m) => m === 'external').length
          const src = SOURCE_BADGE[s.source]
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetailOf(s)}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-lg">{s.emoji}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    v{s.version} · {s.author}
                  </div>
                </div>
                <Badge variant={src.variant} className="ml-auto shrink-0">
                  {src.label}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-5 text-muted-foreground">{s.description}</p>
              <div className="mt-2 flex items-center gap-1">
                {installed > 0 ? (
                  <Badge variant="success">
                    <Icon name="check" className="h-3 w-3" />
                    分发 {installed} 个平台
                  </Badge>
                ) : (
                  <Badge variant="outline">未分发</Badge>
                )}
                {external > 0 && <Badge variant="warning">外部 {external}</Badge>}
                <span className="ml-auto text-[11px] text-muted-foreground">{s.category}</span>
              </div>
            </button>
          )
        })}
      </div>
      {detailOf && <SkillDetailModal skill={detailOf} onClose={() => setDetailOf(null)} />}
    </>
  )
}

/* ---------------- 技能详情 ---------------- */

function SkillDetailModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { setSkillInstall, restoreSkillVersion, deleteSkillVersion } = useStore()
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
          </span>
        }
        subtitle={`${skill.description} · v${skill.version} · ${skill.author}`}
        footer={
          <>
            <span className="mr-auto text-[11px] text-muted-foreground">
              安装于 {skill.installedAt ? formatDate(skill.installedAt, false) : '—'}
            </span>
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
            className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${!category ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground'}`}
          >
            全部分类
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${category === c ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted-foreground'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="search" title="未找到匹配技能" description="换个关键词或来源筛选" />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {list.map((s) => {
            const installed = installedNames.has(s.name)
            return (
              <div key={s.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-lg">{s.emoji}</span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.author} · <Icon name="download" className="inline h-3 w-3" /> {s.downloads.toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={s.source === 'official' ? 'primary' : 'info'} className="ml-auto">
                    {s.source === 'official' ? '官方' : '社区'}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 flex-1 text-xs leading-5 text-muted-foreground">{s.description}</p>
                <div className="mt-3 flex items-center gap-2">
                  {installed ? (
                    <Badge variant="success">
                      <Icon name="check" className="h-3 w-3" />
                      已在我的技能
                    </Badge>
                  ) : (
                    <Button size="sm" onClick={() => setReviewOf(s)}>
                      <Icon name="download" className="h-3.5 w-3.5" />
                      安装
                    </Button>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">{s.category}</span>
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
