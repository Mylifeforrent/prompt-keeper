import { useEffect, useMemo, useState } from 'react'
import type { AgentContract, ContractActivationMode, ContractScope, PromptSyncPolicy } from '../../types'
import { Badge, Button, Input, Select, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn, nowIso, uid } from '../../lib/utils'
import { useStore } from '../../store/store'
import { useToast } from '../ui/toast'
import { CONTRACT_TARGETS, TARGET_BY_ID } from '../../data/contractTargets'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  CONTRACT_SYNC_POLICY_META,
  activationSummary,
  contractFilePath,
} from '../../lib/contracts'
import { folderOptions, normalizeFolder } from '../../lib/folders'
import { FolderField } from '../shared/FolderTree'

const emptyDraft = (): AgentContract => ({
  id: '',
  title: '',
  description: '',
  body: '',
  folder: null,
  scope: 'project',
  path: '',
  activation: { mode: 'always', globs: [] },
  priority: 50,
  imports: [],
  targets: ['agents-md'],
  tags: [],
  syncPolicy: 'inherit',
  versions: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
})

export function ContractEditModal({
  open,
  contract,
  onClose,
}: {
  open: boolean
  contract: AgentContract | null
  onClose: () => void
}) {
  const { state, saveContract } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<AgentContract>(emptyDraft)
  const [globsText, setGlobsText] = useState('')
  const [importsText, setImportsText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const next = contract
      ? {
          ...contract,
          activation: { ...contract.activation, globs: [...contract.activation.globs] },
          imports: [...contract.imports],
          targets: [...contract.targets],
          tags: [...contract.tags],
        }
      : emptyDraft()
    setDraft(next)
    setGlobsText(next.activation.globs.join('\n'))
    setImportsText(next.imports.join('\n'))
    setTagInput('')
    setError(null)
  }, [open, contract])

  const set = (patch: Partial<AgentContract>) => setDraft((d) => ({ ...d, ...patch }))

  const setGlobs = (text: string) => {
    setGlobsText(text)
    const globs = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft((d) => ({ ...d, activation: { ...d.activation, globs } }))
  }

  const setImports = (text: string) => {
    setImportsText(text)
    setDraft((d) => ({
      ...d,
      imports: text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    }))
  }

  const setMode = (mode: ContractActivationMode) =>
    setDraft((d) => ({ ...d, activation: { ...d.activation, mode } }))

  const toggleTarget = (targetId: string) =>
    setDraft((d) => ({
      ...d,
      targets: d.targets.includes(targetId)
        ? d.targets.filter((t) => t !== targetId)
        : [...d.targets, targetId],
    }))

  const selectedTargets = useMemo(
    () => draft.targets.map((id) => TARGET_BY_ID[id]).filter(Boolean),
    [draft.targets],
  )
  const folders = folderOptions(state.contracts, (c) => c.folder)

  const incompatible = selectedTargets.filter((t) => {
    if (draft.activation.mode === 'glob') return !t.supports.globs
    if (draft.activation.mode === 'model') return !t.supports.modelDecision
    if (draft.activation.mode === 'manual') return !t.supports.manual
    return false
  })
  const importIncompatible =
    draft.imports.length > 0 ? selectedTargets.filter((t) => !t.supports.imports) : []

  const submit = () => {
    if (!draft.title.trim()) {
      setError('标题必填')
      return
    }
    if (!draft.body.trim()) {
      setError('契约正文必填')
      return
    }
    if (draft.targets.length === 0) {
      setError('至少选择一个目标；否则契约无法投影')
      return
    }
    if (draft.activation.mode === 'glob' && draft.activation.globs.length === 0) {
      setError('按路径生效时必须填写至少一个 glob')
      return
    }
    if (draft.activation.mode === 'model' && !draft.activation.description?.trim()) {
      setError('模型判断模式必须填写「何时应用」的描述')
      return
    }
    const next: AgentContract = {
      ...draft,
      id: draft.id || uid(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      folder: normalizeFolder(draft.folder),
      body: draft.body.trim(),
      path: draft.scope === 'path' ? draft.path?.trim() : undefined,
      tags: draft.tags,
      updatedAt: nowIso(),
    }
    saveContract(next)
    toast.success(contract ? `已保存「${next.title}」，等待重新投影` : `已创建「${next.title}」`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contract ? '编辑 Agent 指令契约' : '新建 Agent 指令契约'}
      width="max-w-3xl"
      subtitle="一份规范源，按目标工具编译为 AGENTS.md / CLAUDE.md / .cursor/rules 等原生格式"
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
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">标题 *</label>
            <Input aria-label="标题" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="例如：前端代码规范" />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">优先级</label>
            <Input
              aria-label="优先级"
              type="number"
              value={draft.priority}
              onChange={(e) => set({ priority: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述</label>
          <Input
            aria-label="描述"
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="一句话说明这条契约约束什么"
          />
        </div>

        <FolderField
          value={draft.folder}
          onChange={(folder) => set({ folder })}
          options={folders}
          pathPreview={contractFilePath(
            { ...draft, title: draft.title || 'untitled', folder: draft.folder },
            state.repo.layout.contracts,
          )}
          hint="一条契约一个 .contract.md，文件夹会原样成为仓库目录。"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">生效范围</label>
            <Select aria-label="生效范围" value={draft.scope} onChange={(e) => set({ scope: e.target.value as ContractScope })}>
              {(Object.keys(CONTRACT_SCOPE_META) as ContractScope[]).map((s) => (
                <option key={s} value={s}>
                  {CONTRACT_SCOPE_META[s].label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">{CONTRACT_SCOPE_META[draft.scope].desc}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">路径前缀</label>
            <Input
              aria-label="路径前缀"
              value={draft.path ?? ''}
              disabled={draft.scope !== 'path'}
              onChange={(e) => set({ path: e.target.value })}
              placeholder="src"
              className="font-mono text-xs disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">仅「路径级」需要；只在该目录及子目录生效。</p>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">激活方式</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ACTIVATION_META) as ContractActivationMode[]).map((mode) => {
              const meta = ACTIVATION_META[mode]
              const active = draft.activation.mode === mode
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
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{meta.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {draft.activation.mode === 'glob' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">生效 glob *</label>
            <Textarea
              aria-label="生效 glob"
              rows={3}
              value={globsText}
              onChange={(e) => setGlobs(e.target.value)}
              className="font-mono text-xs"
              placeholder={'src/**/*.{ts,tsx}\npackages/**'}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              每行一个，也支持逗号分隔；支持 ** / * / ? / {'{a,b}'}。当前：{activationSummary(draft.activation)}
            </p>
          </div>
        )}

        {draft.activation.mode === 'model' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">何时应用（给模型判断）*</label>
            <Input
              aria-label="何时应用"
              value={draft.activation.description ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, activation: { ...d.activation, description: e.target.value } }))
              }
              placeholder="例如：当用户要求代码评审、review 或检查改动时应用"
            />
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">投影目标 *</label>
            <span className="text-[11px] text-muted-foreground">选择多个目标时，按各自格式分别编译</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CONTRACT_TARGETS.map((target) => {
              const active = draft.targets.includes(target.id)
              const unsupported =
                (draft.activation.mode === 'glob' && !target.supports.globs) ||
                (draft.activation.mode === 'model' && !target.supports.modelDecision) ||
                (draft.activation.mode === 'manual' && !target.supports.manual)
              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => toggleTarget(target.id)}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    active
                      ? unsupported
                        ? 'border-warning bg-warning-soft/60'
                        : 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {active && <Icon name="check" className="h-3 w-3" />}
                    </span>
                    <span className="text-xs font-medium">{target.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{target.agentName}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline">{target.merge === 'single-file' ? '合并' : '独立文件'}</Badge>
                    {target.supports.globs && <Badge variant="outline">glob</Badge>}
                    {target.supports.modelDecision && <Badge variant="outline">模型</Badge>}
                    {target.supports.manual && <Badge variant="outline">手动</Badge>}
                    {target.supports.imports && <Badge variant="outline">@import</Badge>}
                  </div>
                  {active && unsupported && (
                    <div className="mt-1 text-[10px] text-warning">不支持当前激活方式，投影时会跳过</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Claude @import（可选）</label>
          <Textarea
            aria-label="Claude @import"
            rows={2}
            value={importsText}
            onChange={(e) => setImports(e.target.value)}
            className="font-mono text-xs"
            placeholder={'docs/interaction-design.md'}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">每行一个相对路径；只有 CLAUDE.md 目标会写入，最多 4 跳。</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">契约正文 *</label>
          <Textarea
            aria-label="契约正文"
            rows={12}
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            className="font-mono text-xs leading-5"
            placeholder={'# 前端代码规范\n\n- 函数组件 + hooks\n- 使用 Tailwind token\n...'}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            正文会原样写入单文件目标；per-contract 目标会自动加 frontmatter（applyTo / globs / trigger）。
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">标签</label>
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
              placeholder={draft.tags.length ? '' : '仓库、前端、评审…'}
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
            <span className="font-normal">指令会进入每次会话；私密内容建议仅本机</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CONTRACT_SYNC_POLICY_META) as PromptSyncPolicy[]).map((policy) => {
              const meta = CONTRACT_SYNC_POLICY_META[policy]
              const disabled = policy === 'sync' && !state.repo.policies.contracts
              const active = draft.syncPolicy === policy
              return (
                <button
                  key={policy}
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ syncPolicy: policy })}
                  className={cn(
                    'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                  )}
                >
                  <div className="text-xs font-medium">{meta.label}</div>
                  <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{meta.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {(incompatible.length > 0 || importIncompatible.length > 0) && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {incompatible.length > 0 && (
                <p>
                  以下目标不支持「{ACTIVATION_META[draft.activation.mode].label}」：
                  {incompatible.map((t) => t.label).join('、')}。保存不会静默丢弃，生效预览会显示为跳过。
                </p>
              )}
              {importIncompatible.length > 0 && (
                <p>
                  @import 只会写入 CLAUDE.md；以下目标会忽略：
                  {importIncompatible.map((t) => t.label).join('、')}。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
