import { useEffect, useState } from 'react'
import type { Prompt, PromptSyncPolicy } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import {
  PROMPT_SYNC_POLICY_META,
  promptEffectiveSync,
  promptFilePath,
} from '../../lib/promptSync'
import { assetRepoState, REPO_STATE_META } from '../../lib/sync'

const OPTIONS: PromptSyncPolicy[] = ['inherit', 'sync', 'local']

export function PromptSyncModal({
  open,
  prompt,
  onClose,
}: {
  open: boolean
  prompt: Prompt
  onClose: () => void
}) {
  const { state, setPromptSyncPolicy } = useStore()
  const toast = useToast()
  const [policy, setPolicy] = useState<PromptSyncPolicy>(prompt.syncPolicy)

  useEffect(() => {
    if (open) setPolicy(prompt.syncPolicy)
  }, [open, prompt])

  const globalOn = state.repo.policies.prompts
  const connected = state.repo.connected
  const effective = promptEffectiveSync(state.repo, { syncPolicy: policy })
  const stateNow = assetRepoState(
    state.syncChanges,
    'prompt',
    prompt.title,
    effective,
    prompt.id,
  )
  const stateMeta = REPO_STATE_META[stateNow]
  const pending = state.syncChanges.filter(
    (c) =>
      c.kind === 'prompt' &&
      !c.resolved &&
      (c.assetId ? c.assetId === prompt.id : c.assetName === prompt.title),
  ).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={`同步设置 — ${prompt.title}`}
      subtitle="Prompt 只通过 Git 在机器 / 团队之间流转；不会写入 Agent 默认目录"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              setPromptSyncPolicy(prompt.id, policy)
              toast.success(
                policy === 'local'
                  ? '已设为仅本机；后续编辑不会产生待推送'
                  : policy === 'sync'
                    ? '已加入仓库同步；推送仍需在同步中心确认'
                    : '已跟随仓库策略',
              )
              onClose()
            }}
          >
            <Icon name="check" />
            保存范围
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5">
          <Badge variant={effective ? 'info' : 'outline'}>
            {effective ? '参与仓库同步' : '仅本机'}
          </Badge>
          <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {connected
              ? globalOn
                ? '仓库已连接 · Prompt 同步已开启'
                : '仓库已连接 · Prompt 同步未开启'
              : '未连接仓库'}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">{pending} 条待处理变更</span>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const meta = PROMPT_SYNC_POLICY_META[option]
            const disabled = option === 'sync' && !globalOn
            const active = policy === option
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => setPolicy(option)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-primary bg-primary' : 'border-input',
                  )}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {meta.label}
                    {option === 'local' && <Badge variant="outline">推荐给私密 Prompt</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {meta.desc}
                    {disabled ? ' 需先在同步中心开启 Prompt 同步。' : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">仓库文件</div>
          <div className="mt-0.5 break-all font-mono text-xs">{promptFilePath(prompt, state.repo.layout.prompts)}</div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            元数据（标题 / 标签 / 变量定义）在 frontmatter，正文分 System / User 两段；变量填值永远不落盘。
          </p>
        </div>

        {policy === 'local' && pending > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            当前有 {pending} 条未处理变更。保存后会撤回这些待同步项，但不会删除仓库中已有的文件。
          </div>
        )}

        {!globalOn && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            <Icon name="cloud" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Prompt 同步目前由仓库设置统一关闭；这里的选择只会保存为本机偏好。
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          同步不等于分发：Prompt 只写入本机资产库；规则型内容请使用独立的「Agent 指令」工作区，按项目投影或全局目录分发。
        </div>
      </div>
    </Modal>
  )
}
