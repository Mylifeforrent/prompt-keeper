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
  prompt: Prompt | null // null = 新建
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
      setError('标题必填')
      return
    }
    if (!draft.systemPrompt.trim() && !draft.userPrompt.trim()) {
      setError('System Prompt 与 User Prompt 至少填写一个')
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
      title={prompt ? '编辑 Prompt' : '新建 Prompt'}
      width="max-w-2xl"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存（自动生成版本）</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">标题 *</label>
          <Input aria-label="标题" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="例如：代码审查助手" />
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => set({ folder })}
          options={folders}
          pathPreview={promptFilePath(
            { ...draft, title: draft.title || 'untitled', folder: draft.folder },
            state.repo.layout.prompts,
          )}
          hint="保存后文件夹会成为仓库目录；移动文件夹会同步移动文件路径。"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述</label>
          <Input aria-label="描述" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="一句话说明用途" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">System Prompt</label>
          <Textarea aria-label="System Prompt" rows={4} value={draft.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} placeholder="设定角色与输出要求…" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">User Prompt</label>
          <Textarea aria-label="User Prompt" rows={5} value={draft.userPrompt} onChange={(e) => set({ userPrompt: e.target.value })} placeholder="正文模板，可用 {{变量名}} 或 {{变量名:示例值}}…" />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            标签
            <span className="font-normal">回车添加，点击 × 移除</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2">
            {draft.tags.map((t) => (
              <Badge key={t} variant="primary" className="gap-1 py-1">
                {t}
                <button
                  type="button"
                  aria-label={`移除标签 ${t}`}
                  className="cursor-pointer"
                  onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              aria-label="添加标签"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
              value={tagInput}
              placeholder={draft.tags.length ? '' : '编程、写作…'}
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
            同步范围
            <span className="font-normal">Git 仓库是可选的；私密 Prompt 建议仅本机</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { v: 'inherit', title: '跟随仓库策略', desc: '仓库开启 Prompt 同步时参与' },
                { v: 'sync', title: '参与同步', desc: '显式推送到 Git 仓库' },
                { v: 'local', title: '仅本机', desc: '不进入 Git，也不生成待推送' },
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
              ? '保存后在详情页仍可调整；参与同步的改动会进入「待推送」，不会自动提交。'
              : '当前未连接仓库；同步范围只作为偏好保存。'}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">识别到的模板变量</label>
          {variableDefs.length === 0 ? (
            <p className="text-xs text-muted-foreground">未检测到变量；在正文中写 {`{{变量名}}`} 即可，复制/测试时会弹表单填值。</p>
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
