import type { AgentContract } from '../../types'
import { Badge, Button } from '../ui/core'
import { Icon } from '../../lib/icons'
import { copyToClipboard, formatDate } from '../../lib/utils'
import { Markdown } from '../shared/Markdown'
import { AssetSyncBadge } from '../sync/AssetSyncBadge'
import { useStore } from '../../store/store'
import { TARGET_BY_ID } from '../../data/contractTargets'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  PROJECTION_META,
  activationSummary,
  contractFilePath,
  contractVersionLabel,
  projectionPath,
} from '../../lib/contracts'
import { useToast } from '../ui/toast'
import { folderLabel } from '../../lib/folders'

export function ContractDetail({
  contract,
  onEdit,
  onDelete,
  onShowVersions,
  onSync,
  onPreview,
}: {
  contract: AgentContract
  onEdit: () => void
  onDelete: () => void
  onShowVersions: () => void
  onSync: () => void
  onPreview: () => void
}) {
  const { state } = useStore()
  const toast = useToast()
  const scope = CONTRACT_SCOPE_META[contract.scope]
  const activation = ACTIVATION_META[contract.activation.mode]
  const projections = state.contractProjections.filter((p) => p.contractId === contract.id)
  const globalProjections = state.globalProjections.filter((p) => p.contractId === contract.id)

  const copyBody = async () => {
    const ok = await copyToClipboard(contract.body)
    toast[ok ? 'success' : 'error'](ok ? `已复制「${contract.title}」正文` : '复制失败，请检查剪贴板权限')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/30">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold leading-6 tracking-tight">{contract.title}</h2>
              <Badge variant="outline" className="tabular">{contractVersionLabel(contract)}</Badge>
              <AssetSyncBadge
                kind="contract"
                name={contract.title}
                assetId={contract.id}
                policy={contract.syncPolicy}
              />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {contract.description || '（无描述）'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="tabular whitespace-nowrap text-[10.5px] text-muted-foreground">
              更新于 {formatDate(contract.updatedAt)}
            </span>
            <span className="mx-0.5 h-4 w-px bg-border/80" />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="删除契约"
              title="删除"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">
            <Icon name="folder" className="h-3 w-3" />
            {folderLabel(contract.folder)}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {scope.label}
            {contract.scope === 'path' && contract.path ? ` · ${contract.path}/` : ''}
          </Badge>
          <Badge variant={contract.activation.mode === 'always' ? 'primary' : 'info'} className="font-normal">
            <Icon name="file" className="h-3 w-3" />
            {activation.label}
          </Badge>
          <Badge variant="outline" className="tabular font-normal">优先级 {contract.priority}</Badge>
          {contract.tags.map((t) => (
            <Badge key={t} variant="primary" className="font-normal">
              #{t}
            </Badge>
          ))}
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={copyBody} className="shadow-sm">
            <Icon name="copy" />
            复制正文
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Icon name="pencil" />
            编辑
          </Button>
          <Button variant="outline" onClick={onPreview}>
            <Icon name="eye" />
            生效预览
          </Button>
          <Button variant="outline" onClick={onShowVersions}>
            <Icon name="history" />
            版本
          </Button>
          <Button variant="outline" onClick={onSync}>
            <Icon name="gitBranch" />
            同步
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section className="grid grid-cols-2 gap-3">
          <InfoCard label="生效范围" value={scope.desc} />
          <InfoCard label="激活方式" value={`${activation.desc} 当前：${activationSummary(contract.activation)}`} />
          <InfoCard
            label="仓库文件"
            value={contractFilePath(contract, state.repo.layout.contracts)}
            mono
            hint={contract.syncPolicy === 'local' ? '仅本机：不写入仓库' : 'frontmatter 存文件夹 / 范围 / 激活 / 目标，正文即规范内容'}
          />
          <InfoCard
            label="全局目录投影"
            value={
              globalProjections.length
                ? globalProjections
                    .map(
                      (p) =>
                        `${state.globalTargets.find((t) => t.id === p.targetId)?.label ?? p.targetId} · ${PROJECTION_META[p.status].label}`,
                    )
                    .join('\n')
                : '尚未投影到本机 Agent 全局目录'
            }
            hint="在「全局分发」中可勾选多条指令与多个工具，并修改工具全局目录路径"
          />
          <InfoCard
            label="Claude @import"
            value={contract.imports.length ? contract.imports.map((i) => `@${i}`).join('\n') : '未配置'}
            mono
            hint="仅 CLAUDE.md 目标支持；其他目标会忽略导入行"
          />
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              目标与投影状态
              <span className="h-px w-8 bg-border/70" />
            </h3>
            <Badge variant="outline">{contract.targets.length} 个目标</Badge>
            <span className="text-[10.5px] text-muted-foreground">
              单文件目标会与其他契约合并写入；漂移不会被自动覆盖
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {contract.targets.map((targetId) => {
              const target = TARGET_BY_ID[targetId]
              if (!target) return null
              const projection = projections.find((p) => p.targetId === targetId)
              const status = projection?.status ?? 'missing'
              const meta = PROJECTION_META[status]
              const modeIncompatible =
                (contract.activation.mode === 'glob' && !target.supports.globs) ||
                (contract.activation.mode === 'model' && !target.supports.modelDecision) ||
                (contract.activation.mode === 'manual' && !target.supports.manual)
              return (
                <div key={targetId} className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{target.label}</span>
                    <Badge variant={meta.variant} className="ml-auto">
                      <Icon name={meta.icon} className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{target.agentName}</div>
                  <code className="mt-1 block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                    {projectionPath(contract, targetId)}
                  </code>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      {target.merge === 'single-file' ? '合并写入' : '独立文件'}
                    </span>
                    {modeIncompatible && <Badge variant="warning">激活方式不兼容，投影时会跳过</Badge>}
                  </div>
                  {projection?.note && (
                    <p className="mt-1 text-[10px] leading-4 text-warning">{projection.note}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              契约正文
              <span className="h-px w-8 bg-border/70" />
            </h3>
            <Badge variant="outline">每次会话可能进入上下文</Badge>
          </div>
          <Markdown
            text={contract.body}
            className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
          />
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-[10.5px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          指令会被 Agent 自动读取。拉取、恢复与手动合并都必须逐条预览；推送前会扫描正文中的高置信度凭据。删除本地契约不会删除已投影的目标文件。
        </div>
      </div>
    </div>
  )
}

function InfoCard({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div
        className={
          mono
            ? 'mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground/90'
            : 'mt-1 whitespace-pre-line text-xs leading-5 text-foreground/90'
        }
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  )
}
