import type { ContractListItem } from '../../../shared/contracts'
import { Badge, Button, EmptyState } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  contractVersionLabel,
  folderLabel,
  contractSyncStateMeta,
} from '../../lib/viewModels/contract'

export function ContractList({
  contracts,
  selectedId,
  onSelect,
  hasFilter,
  onClearFilter,
  onCreate,
}: {
  contracts: ContractListItem[]
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
        title="No matching instruction contracts"
        description="No contract matches the current search, folder, scope, activation, or target filter."
        action={
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon="file"
        title="No instruction contracts yet"
        description="Create one canonical contract for rules that must enter every session, then project it to AGENTS.md, CLAUDE.md, .cursor/rules, and other targets."
        action={
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Create your first contract
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      {contracts.map((contract) => {
        const scope = CONTRACT_SCOPE_META[contract.scope]
        const activation = ACTIVATION_META[contract.activationMode]
        const sync = contractSyncStateMeta(contract)
        const active = selectedId === contract.id
        return (
          <button
            key={contract.id}
            type="button"
            onClick={() => onSelect(contract.id)}
            aria-current={active ? 'true' : undefined}
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
                    {contractVersionLabel(contract.currentVersion)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {contract.description || '(No description)'}
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
                    variant={contract.activationMode === 'always' ? 'primary' : 'info'}
                    className="shrink-0 font-normal"
                  >
                    {activation.short}
                  </Badge>
                  <Badge variant="outline" className="tabular shrink-0 font-normal">
                    {contract.targetIds.length} targets
                  </Badge>
                  <Badge variant={sync.variant} className="shrink-0 font-normal">
                    {sync.label}
                  </Badge>
                </div>
                {contract.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-nowrap items-center gap-1 overflow-hidden">
                    {contract.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="truncate text-[10px] text-muted-foreground">
                        #{tag}
                      </span>
                    ))}
                    {contract.tags.length > 3 && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        +{contract.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
