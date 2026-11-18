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
            { value: 'overview', label: 'Overview' },
            { value: 'changes', label: 'Changes', count: counts.incoming + counts.outgoing + counts.conflicts + counts.blocked },
            { value: 'deploy', label: 'Dispatch', count: counts.stale + counts.drifted },
            { value: 'history', label: 'History' },
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
              <Badge variant="success" className="shrink-0">Connected</Badge>
            </>
          ) : (
            <Badge variant="warning">No repo connected</Badge>
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
    toast.success(repo.behind > 0 ? `Fetch complete: ${repo.behind} remote commits awaiting confirmation` : 'Fetch complete: already up to date')
  }

  const handleRedetect = () => {
    const next = redetectAgents()
    toast.info(`Detection complete: ${next.length} local Agents found; tools that are not installed are never written to`)
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
                  <Badge variant="secondary">Private repository</Badge>
                  <Badge variant="outline">
                    <Icon name="gitBranch" className="h-3 w-3" />
                    {repo.branch}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connected · Last fetch {relativeTime(repo.lastFetchedAt)} · Last merge {relativeTime(repo.lastSyncedAt)} ·{' '}
                  {repo.auth === 'credential' ? 'System Git credentials' : repo.auth === 'ssh' ? 'SSH Key' : 'Access token'}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{repo.localPath}</p>
              </div>
              <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={handleFetch}>
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  Fetch now
                </Button>
                <Button size="sm" variant="outline" onClick={() => onOpenTab('changes')}>
                  <Icon name="arrowUp" className="h-3.5 w-3.5" />
                  Push…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRepoOpen(true)}>
                  <Icon name="sliders" className="h-3.5 w-3.5" />
                  Settings
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="info">
                <Icon name="arrowUp" className="h-3 w-3" />
                Ahead of remote {repo.ahead}
              </Badge>
              <Badge variant="warning">
                <Icon name="arrowDown" className="h-3 w-3" />
                Behind remote {repo.behind}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {repo.pushMode === 'branch-pr' ? 'Pushes go through a separate branch + PR' : 'Pushes write directly to the current branch'}
                {repo.autoFetch ? ` · read-only fetch every ${repo.fetchIntervalMin} min` : ' · manual fetch only'}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon name="gitBranch" className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-base font-semibold">Connect a Git repository to your local asset library</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            The repo shares Skills, MCP templates, optionally synced Prompts, and Agent Instructions across machines and teams; the app handles review, projection, and dispatch to each Agent.
            After connecting, changes land in "Changes" first and never overwrite your local edits automatically.
          </p>
          <Button className="mt-4" onClick={() => setRepoOpen(true)}>
            <Icon name="gitBranch" />
            Connect Git repository
          </Button>
        </section>
      )}

      {/* Asset policies */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <PolicyCard
          icon="grid"
          title="Skills"
          badge="Two-way sync"
          badgeVariant="primary"
          desc="Written per folder as skills/<folder>/<skill>/SKILL.md; SKILL.md and scripts travel both ways, and are reviewed before dispatch after a pull."
          footer={`${skillCounts.incoming} incoming · ${skillCounts.outgoing} outgoing`}
        />
        <PolicyCard
          icon="server"
          title="MCP"
          badge="Two-way templates · local secrets"
          badgeVariant="info"
          desc="Written per folder as mcp/<folder>/<name>.json; the repo stores only ${VAR} placeholders, while real tokens stay in the local keychain and are injected at dispatch."
          footer={`${mcpCounts.blocked} blocked by security policy`}
        />
        <PolicyCard
          icon="message"
          title="Prompts"
          badge="Opt-in per Prompt"
          badgeVariant="primary"
          desc="Written per folder as prompts/<folder>/<slug>.prompt.md: frontmatter holds metadata and variable definitions, body splits into System / User; private Prompts can be set to local only individually."
          footer={`${promptChanges.length} pending · ${localPrompts} local only`}
        />
        <PolicyCard
          icon="file"
          title="Agent Instructions"
          badge="Opt-in per contract"
          badgeVariant="primary"
          desc="Written per folder as instructions/<folder>/<slug>.contract.md; project projection and local global directory dispatch are confirmed separately, and global paths can be edited per item."
          footer={`${contractChanges.length} pending · ${contractCounts.blocked} blocked · ${localContracts} local only`}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="folder" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Repository structure = platform folders</h3>
          <Badge variant="outline">Browsable without the app</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Each asset's folder path maps directly to a repo directory, and directories can hold nested subfolders; each file keeps the single-file convention.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5">
{`prompts/engineering/code-quality/review.prompt.md
instructions/team/frontend/frontend.contract.md
skills/dev-workflow/git/commit-helper/SKILL.md
mcp/development/github/github.json`}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span>Prompt: one .prompt.md each</span>
          <span>·</span>
          <span>Instructions: one .contract.md each</span>
          <span>·</span>
          <span>Skill: one directory each</span>
          <span>·</span>
          <span>MCP: one .json per server</span>
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
              {counts.blocked} assets contain plaintext credentials; push is blocked
            </div>
            <p className="text-[11px] text-muted-foreground">
              Go to "Changes" to handle plaintext in Prompt / instruction content or MCP env / headers; real values never enter the repo.
            </p>
          </div>
          <Icon name="chevronRight" className="ml-auto h-4 w-4 text-danger" />
        </button>
      )}

      {/* Stats */}
      <section className="grid grid-cols-4 gap-3">
        <StatCard
          label="Incoming"
          value={counts.incoming}
          tone="info"
          hint={`Includes ${promptIncoming} Prompts · ${contractIncoming} instructions · confirm before merge`}
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Outgoing"
          value={counts.outgoing}
          tone="warning"
          hint={
            counts.blocked
              ? `${counts.blocked} blocked · includes ${promptOutgoing} Prompts, ${contractOutgoing} instructions`
              : `Local changes to commit · includes ${promptOutgoing} Prompts, ${contractOutgoing} instructions`
          }
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Conflicts"
          value={counts.conflicts}
          tone="danger"
          hint="Both sides changed; silent overwrite is not allowed"
          onClick={() => onOpenTab('changes')}
        />
        <StatCard
          label="Dispatch pending"
          value={counts.stale + counts.drifted}
          tone="primary"
          hint={`${counts.stale} stale · ${counts.drifted} drifted`}
          onClick={() => onOpenTab('deploy')}
        />
      </section>

      {/* Agent status */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="grid" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Local Agents</h3>
          <Badge variant="success">Detected {detected.length}</Badge>
          <span className="text-[11px] text-muted-foreground">Dispatch only to installed tools to avoid empty directories</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={handleRedetect}>
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Redetect
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenTab('deploy')}>
              Manage dispatch
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
                  {attention ? `${attention} pending` : 'OK'}
                </Badge>
              </div>
            )
          })}
        </div>
      </section>

      {/* Recent sync */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Icon name="history" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Recent sync</h3>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpenTab('history')}>
            All history
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
