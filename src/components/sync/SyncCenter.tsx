import { useState } from 'react'
import { useStore } from '../../store/store'
import { Tabs } from '../ui/tabs'
import { Badge, Button } from '../ui/core'
import { Icon } from '../../lib/icons'
import { useToast } from '../ui/toast'
import { AGENT_RUNTIMES } from '../../data/syncSeed'
import { EVENT_META, syncCounts } from '../../lib/sync'
import { promptEffectiveSync } from '../../lib/promptSync'
import { cn, relativeTime } from '../../lib/utils'
import { RepoConnectModal } from './RepoConnectModal'
import { SyncChanges } from './SyncChanges'
import { SyncDeploy } from './SyncDeploy'
import { SyncHistory } from './SyncHistory'

type SyncTab = 'overview' | 'changes' | 'deploy' | 'history'

export function SyncCenter() {
  const { state } = useStore()
  const [tab, setTab] = useState<SyncTab>('overview')
  const counts = syncCounts(state.syncChanges, state.deployments, state.mcps)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <Tabs
          tabs={[
            { value: 'overview', label: '概览' },
            { value: 'changes', label: '变更', count: counts.incoming + counts.outgoing + counts.conflicts + counts.blocked },
            { value: 'deploy', label: '分发', count: counts.stale + counts.drifted },
            { value: 'history', label: '历史' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as SyncTab)}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <Icon name="gitBranch" className="h-3.5 w-3.5 shrink-0" />
          {state.repo.connected ? (
            <>
              <span className="truncate font-mono text-[10.5px]">
                {state.repo.url} · {state.repo.branch}
              </span>
              <Badge variant="success" className="shrink-0">已连接</Badge>
            </>
          ) : (
            <Badge variant="warning">未连接仓库</Badge>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <SyncOverview onOpenTab={(t) => setTab(t)} />}
        {tab === 'changes' && <SyncChanges />}
        {tab === 'deploy' && <SyncDeploy />}
        {tab === 'history' && <SyncHistory />}
      </div>
    </div>
  )
}

function SyncOverview({ onOpenTab }: { onOpenTab: (tab: SyncTab) => void }) {
  const { state, fetchRepo, redetectAgents } = useStore()
  const toast = useToast()
  const [repoOpen, setRepoOpen] = useState(false)
  const repo = state.repo
  const counts = syncCounts(state.syncChanges, state.deployments, state.mcps)
  const detected = AGENT_RUNTIMES.filter((a) => state.detectedAgents.includes(a.id))
  const promptChanges = state.syncChanges.filter((c) => c.kind === 'prompt' && !c.resolved)
  const promptIncoming = promptChanges.filter((c) => c.direction === 'incoming').length
  const promptOutgoing = promptChanges.filter((c) => c.direction === 'outgoing' && !c.blocked).length
  const localPrompts = state.prompts.filter((p) => !promptEffectiveSync(state.repo, p)).length
  const contractChanges = state.syncChanges.filter((c) => c.kind === 'contract' && !c.resolved)
  const contractIncoming = contractChanges.filter((c) => c.direction === 'incoming').length
  const contractOutgoing = contractChanges.filter((c) => c.direction === 'outgoing' && !c.blocked).length
  const localContracts = state.contracts.filter(
    (c) => c.syncPolicy === 'local' || !state.repo.policies.contracts,
  ).length
  const kindCounts = (kind: 'skill' | 'mcp' | 'contract') => {
    const rows = state.syncChanges.filter((c) => c.kind === kind && !c.resolved)
    return {
      incoming: rows.filter((c) => c.direction === 'incoming').length,
      outgoing: rows.filter((c) => c.direction === 'outgoing' && !c.blocked).length,
      blocked: rows.filter((c) => c.blocked).length,
    }
  }
  const skillCounts = kindCounts('skill')
  const mcpCounts = kindCounts('mcp')
  const contractCounts = kindCounts('contract')

  const handleFetch = () => {
    fetchRepo()
    toast.success(repo.behind > 0 ? `fetch 完成：远端有 ${repo.behind} 个提交待确认` : 'fetch 完成：已是最新')
  }

  const handleRedetect = () => {
    const next = redetectAgents()
    toast.info(`检测完成：发现 ${next.length} 个本机 Agent，未安装的工具不会写入`)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      {repo.connected ? (
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-soft/70 via-transparent to-transparent" />
          <div className="relative">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Icon name="gitBranch" className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{repo.url}</h2>
                  <Badge variant="secondary">私有仓库</Badge>
                  <Badge variant="outline">
                    <Icon name="gitBranch" className="h-3 w-3" />
                    {repo.branch}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  已连接 · 上次 fetch {relativeTime(repo.lastFetchedAt)} · 上次合入 {relativeTime(repo.lastSyncedAt)} ·{' '}
                  {repo.auth === 'credential' ? '系统 Git 凭据' : repo.auth === 'ssh' ? 'SSH Key' : '访问令牌'}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{repo.localPath}</p>
              </div>
              <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={handleFetch}>
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  立即 fetch
                </Button>
                <Button size="sm" variant="outline" onClick={() => onOpenTab('changes')}>
                  <Icon name="arrowUp" className="h-3.5 w-3.5" />
                  推送…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRepoOpen(true)}>
                  <Icon name="sliders" className="h-3.5 w-3.5" />
                  设置
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="info">
                <Icon name="arrowUp" className="h-3 w-3" />
                领先远程 {repo.ahead}
              </Badge>
              <Badge variant="warning">
                <Icon name="arrowDown" className="h-3 w-3" />
                落后远程 {repo.behind}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {repo.pushMode === 'branch-pr' ? '推送走独立分支 + PR' : '推送直接写当前分支'}
                {repo.autoFetch ? ` · 每 ${repo.fetchIntervalMin} 分钟只读 fetch` : ' · 仅手动 fetch'}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon name="gitBranch" className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-base font-semibold">把 Git 仓库接到本机资产库</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            仓库负责跨机器、跨团队共享技能、MCP 模板、可选同步的 Prompt 与 Agent 指令；本应用负责审核、投影与分发到各 Agent。
            连接后先拉到「变更」，不会自动覆盖你的本地修改。
          </p>
          <Button className="mt-4" onClick={() => setRepoOpen(true)}>
            <Icon name="gitBranch" />
            连接 Git 仓库
          </Button>
        </section>
      )}

      {/* 资产策略 */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <PolicyCard
          icon="grid"
          title="Skills"
          badge="双向同步"
          badgeVariant="primary"
          desc="按文件夹写入 skills/<folder>/<skill>/SKILL.md；SKILL.md 与脚本随仓库双向进出，拉取后审核再分发。"
          footer={`${skillCounts.incoming} 待拉取 · ${skillCounts.outgoing} 待推送`}
        />
        <PolicyCard
          icon="server"
          title="MCP"
          badge="模板双向 · 密钥本机"
          badgeVariant="info"
          desc="按文件夹写入 mcp/<folder>/<name>.json；仓库只存 ${VAR} 占位，真实 Token 留在本机钥匙串，分发时注入。"
          footer={`${mcpCounts.blocked} 项被安全策略阻断`}
        />
        <PolicyCard
          icon="message"
          title="Prompts"
          badge="按 Prompt 参与"
          badgeVariant="primary"
          desc="按文件夹写入 prompts/<folder>/<slug>.prompt.md：frontmatter 存元数据与变量定义，正文分 System / User；私密 Prompt 可逐条设为仅本机。"
          footer={`${promptChanges.length} 条待处理 · ${localPrompts} 条仅本机`}
        />
        <PolicyCard
          icon="file"
          title="Agent 指令"
          badge="按契约参与"
          badgeVariant="primary"
          desc="按文件夹写入 instructions/<folder>/<slug>.contract.md；项目投影与「本机全局目录」分发分开确认，全局路径可逐项改写。"
          footer={`${contractChanges.length} 条待处理 · ${contractCounts.blocked} 项阻断 · ${localContracts} 条仅本机`}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="folder" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">仓库目录结构 = 平台文件夹</h3>
          <Badge variant="outline">不使用平台也能直接浏览</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          每条资产的文件夹路径直接映射为仓库目录，目录内还可以继续建子文件夹；文件本身保持单文件约定。
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5">
{`prompts/编程/代码质量/review.prompt.md
instructions/团队/前端/frontend.contract.md
skills/开发流程/Git/commit-helper/SKILL.md
mcp/开发/GitHub/github.json`}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span>Prompt：一条一个 .prompt.md</span>
          <span>·</span>
          <span>指令：一条一个 .contract.md</span>
          <span>·</span>
          <span>Skill：一个技能一个目录</span>
          <span>·</span>
          <span>MCP：一个 server 一个 .json</span>
        </div>
      </section>

      {counts.blocked > 0 && (
        <button
          type="button"
          onClick={() => onOpenTab('changes')}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-left"
        >
          <Icon name="lock" className="h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-danger">
              {counts.blocked} 项资产包含明文凭据，推送已被阻断
            </div>
            <p className="text-[11px] text-muted-foreground">
              前往「变更」处理 Prompt / 指令正文或 MCP env / headers 中的明文；真实值不会进入仓库。
            </p>
          </div>
          <Icon name="chevronRight" className="ml-auto h-4 w-4 text-danger" />
        </button>
      )}

      {/* 统计 */}
      <section className="grid grid-cols-4 gap-3">
        <StatCard
          label="待拉取"
          value={counts.incoming}
          tone="info"
          hint={`含 ${promptIncoming} 条 Prompt · ${contractIncoming} 条指令 · 合入前需确认`}
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="待推送"
          value={counts.outgoing}
          tone="warning"
          hint={
            counts.blocked
              ? `${counts.blocked} 项被阻断 · 含 ${promptOutgoing} 条 Prompt、${contractOutgoing} 条指令`
              : `本地改动待提交 · 含 ${promptOutgoing} 条 Prompt、${contractOutgoing} 条指令`
          }
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="冲突"
          value={counts.conflicts}
          tone="danger"
          hint="双方都改过，禁止静默覆盖"
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="分发待处理"
          value={counts.stale + counts.drifted}
          tone="primary"
          hint={`${counts.stale} 过时 · ${counts.drifted} 漂移`}
          onClick={() => onOpenTab('deploy')}
        />
      </section>

      {/* Agent 状态 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="grid" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">本机 Agent</h3>
          <Badge variant="success">已检测 {detected.length}</Badge>
          <span className="text-[11px] text-muted-foreground">只向已安装的工具分发，避免制造空目录</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={handleRedetect}>
              <Icon name="refresh" className="h-3.5 w-3.5" />
              重新检测
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenTab('deploy')}>
              管理分发
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {detected.map((a) => {
            const deps = state.deployments.filter((d) => d.agentId === a.id)
            const attention = deps.filter((d) => d.status === 'stale' || d.status === 'drifted').length
            return (
              <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                  {a.name.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{a.name}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{a.skillDir || a.mcpFile}</div>
                </div>
                <Badge variant={attention ? 'warning' : 'success'} className="ml-auto shrink-0">
                  {attention ? `${attention} 待处理` : '正常'}
                </Badge>
              </div>
            )
          })}
        </div>
      </section>

      {/* 最近同步 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="history" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">最近同步</h3>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenTab('history')}>
            全部历史
            <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-2 divide-y divide-border/60">
          {state.syncEvents.slice(0, 5).map((ev) => {
            const meta = EVENT_META[ev.type]
            return (
              <div key={ev.id} className="flex items-start gap-2.5 py-2">
                <Icon name={meta.icon} className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.tone)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{ev.title}</div>
                  {ev.detail && <div className="truncate text-[11px] text-muted-foreground">{ev.detail}</div>}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(ev.at)}</span>
              </div>
            )
          })}
        </div>
      </section>

      <RepoConnectModal open={repoOpen} onClose={() => setRepoOpen(false)} />
    </div>
  )
}

function PolicyCard({
  icon,
  title,
  badge,
  badgeVariant,
  desc,
  footer,
}: {
  icon: 'grid' | 'server' | 'message' | 'file'
  title: string
  badge: string
  badgeVariant: 'primary' | 'info' | 'outline'
  desc: string
  footer: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold">{title}</span>
        <Badge variant={badgeVariant} className="ml-auto shrink-0 font-normal">
          {badge}
        </Badge>
      </div>
      <p className="mt-2 min-h-10 text-[10.5px] leading-5 text-muted-foreground">{desc}</p>
      <div className="tabular mt-2 border-t border-border/60 pt-2 text-[10.5px] text-muted-foreground">{footer}</div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string
  value: number
  hint: string
  tone: 'info' | 'warning' | 'danger' | 'primary'
  onClick: () => void
}) {
  const toneCls = {
    info: 'text-info bg-info-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
    primary: 'text-primary bg-primary-soft',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-sm font-semibold', toneCls)}>
          {value}
        </span>
        <span className="text-xs font-medium">{label}</span>
        <Icon name="chevronRight" className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{hint}</div>
    </button>
  )
}
