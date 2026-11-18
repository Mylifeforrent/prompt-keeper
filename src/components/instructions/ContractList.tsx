import type { AgentContract } from '../../types'
import { Badge, Button, EmptyState } from '../ui/core'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { ACTIVATION_META, CONTRACT_SCOPE_META, contractVersionLabel } from '../../lib/contracts'
import { folderLabel } from '../../lib/folders'

export function ContractList({
  contracts,
  selectedId,
  onSelect,
  hasFilter,
  onClearFilter,
  onCreate,
}: {
  contracts: AgentContract[]
  selectedId: string | null
  onSelect: (id: string) => void
  hasFilter: boolean
  onClearFilter: () => void
  onCreate: () => void
}) {
  if (contracts.length === 0) {
    return hasFilter ? (
      <EmptyState
        icon="search"
        title="未找到匹配的指令契约"
        description="当前搜索或筛选条件下没有结果。"
        action={
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            清除筛选
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon="file"
        title="还没有 Agent 指令契约"
        description="把 AGENTS.md、CLAUDE.md、.cursor/rules 这类每次会话都要遵守的规则收进来，统一编辑与投影。"
        action={
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            新建第一条契约
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      {contracts.map((contract) => {
        const scope = CONTRACT_SCOPE_META[contract.scope]
        const activation = ACTIVATION_META[contract.activation.mode]
        const active = selectedId === contract.id
        return (
          <button
            key={contract.id}
            type="button"
            onClick={() => onSelect(contract.id)}
            className={cn(
              'group w-full cursor-pointer rounded-xl border px-3 py-3 text-left transition-all duration-150',
              'hover:-translate-y-px hover:border-primary/30 hover:shadow-sm',
              active
                ? 'border-primary/55 bg-primary-soft/40 ring-1 ring-primary/15'
                : 'border-border bg-card',
            )}
          >
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                  active
                    ? 'border-primary/20 bg-primary/10 text-primary'
                    : 'border-border/70 bg-muted/70 text-muted-foreground',
                )}
              >
                <Icon name="file" className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium leading-5">{contract.title}</span>
                  <span className="tabular ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {contractVersionLabel(contract)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {contract.description || '（无描述）'}
                </p>
                <div className="mt-2 flex flex-nowrap items-center gap-1.5 overflow-hidden">
                  <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                    <Icon name="folder" className="h-3 w-3" />
                    {folderLabel(contract.folder)}
                  </Badge>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {scope.short}
                  </Badge>
                  <Badge
                    variant={contract.activation.mode === 'always' ? 'primary' : 'info'}
                    className="shrink-0 font-normal"
                  >
                    {activation.short}
                  </Badge>
                  <Badge variant="outline" className="tabular shrink-0 font-normal">
                    {contract.targets.length} 目标
                  </Badge>
                  <AssetSyncBadge
                    kind="contract"
                    name={contract.title}
                    assetId={contract.id}
                    policy={contract.syncPolicy}
                    compact
                  />
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
