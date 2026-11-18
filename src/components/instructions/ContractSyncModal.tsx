import { useEffect, useState } from 'react'
import type { AgentContract, PromptSyncPolicy } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import {
  CONTRACT_SYNC_POLICY_META,
  contractFilePath,
  contractSyncEnabled,
} from '../../lib/contracts'
import { assetRepoState, REPO_STATE_META } from '../../lib/sync'

const OPTIONS: PromptSyncPolicy[] = ['inherit', 'sync', 'local']

export function ContractSyncModal({
  open,
  contract,
  onClose,
}: {
  open: boolean
  contract: AgentContract
  onClose: () => void
}) {
  const { state, setContractSyncPolicy } = useStore()
  const toast = useToast()
  const [policy, setPolicy] = useState<PromptSyncPolicy>(contract.syncPolicy)

  useEffect(() => {
    if (open) setPolicy(contract.syncPolicy)
  }, [open, contract])

  const globalOn = state.repo.policies.contracts
  const connected = state.repo.connected
  const effective = contractSyncEnabled(state.repo, { syncPolicy: policy })
  const stateNow = assetRepoState(state.syncChanges, 'contract', contract.title, effective, contract.id)
  const stateMeta = REPO_STATE_META[stateNow]
  const pending = state.syncChanges.filter(
    (c) =>
      c.kind === 'contract' &&
      !c.resolved &&
      (c.assetId ? c.assetId === contract.id : c.assetName === contract.title),
  ).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={`同步设置 — ${contract.title}`}
      subtitle="指令契约只通过 Git 在机器 / 团队之间流转；投影由「投影与漂移」单独控制"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              setContractSyncPolicy(contract.id, policy)
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
          <Badge variant={effective ? 'info' : 'outline'}>{effective ? '参与仓库同步' : '仅本机'}</Badge>
          <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {connected
              ? globalOn
                ? '仓库已连接 · 指令同步已开启'
                : '仓库已连接 · 指令同步未开启'
              : '未连接仓库'}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">{pending} 条待处理变更</span>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const meta = CONTRACT_SYNC_POLICY_META[option]
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
                    {option === 'local' && <Badge variant="outline">推荐给个人上下文</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {meta.desc}
                    {disabled ? ' 需先在同步中心开启 Agent 指令同步。' : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">仓库文件</div>
          <div className="mt-0.5 break-all font-mono text-xs">
            {contractFilePath(contract, state.repo.layout.contracts)}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            frontmatter 存 folder / scope / activation / priority / targets / imports，正文即规范内容；不把各工具生成物提交为第二个事实源。
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
            指令同步目前由仓库设置统一关闭；这里的选择只会保存为本机偏好。
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          同步不等于投影：指令只在本地库与仓库之间流转；写入 AGENTS.md / CLAUDE.md / .cursor/rules 需要显式投影，
          目标文件被手工修改时会标记漂移。
        </div>
      </div>
    </Modal>
  )
}
