import { useStore } from '../../store/store'
import type { ThemeMode } from '../../types'
import { Button } from '../ui/core'
import { ConfirmDialog } from '../ui/modal'
import { useState } from 'react'
import { useToast } from '../ui/toast'
import { cn } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

const THEMES: { v: ThemeMode; label: string; desc: string }[] = [
  { v: 'light', label: '亮色', desc: '固定使用亮色主题' },
  { v: 'dark', label: '暗色', desc: '固定使用暗色主题' },
  { v: 'system', label: '跟随系统', desc: '随操作系统外观自动切换' },
]

const SECTIONS: { id: string; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'sync-policy', label: '同步策略' },
  { id: 'repo-layout', label: '仓库目录结构' },
  { id: 'global-dirs', label: 'Agent 全局目录' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' },
]

export function SettingsView() {
  const { state, setTheme, resetAll } = useStore()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 xl:grid-cols-[160px_minmax(0,1fr)] lg:px-8">
        <aside className="hidden xl:block">
          <nav aria-label="设置目录" className="sticky top-0 space-y-0.5">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">
              设置
            </div>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#settings-${s.id}`}
                className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <SettingsSection
            id="appearance"
            icon="sun"
            title="外观"
            description="主题立即生效并持久化到本机。"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {THEMES.map((t) => {
                const active = state.settings.theme === t.v
                return (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => setTheme(t.v)}
                    aria-pressed={active}
                    className={cn(
                      'relative cursor-pointer rounded-lg border p-3 text-left transition-all',
                      active
                        ? 'border-primary/55 bg-primary-soft/60 ring-1 ring-primary/15'
                        : 'border-border hover:border-border-strong hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      <Icon
                        name={t.v === 'dark' ? 'moon' : t.v === 'light' ? 'sun' : 'refresh'}
                        className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')}
                      />
                      {t.label}
                    </div>
                    <div className="mt-1 text-[10.5px] leading-4 text-muted-foreground">{t.desc}</div>
                    {active && (
                      <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Icon name="check" className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </SettingsSection>

          <SettingsSection
            id="sync-policy"
            icon="gitBranch"
            title="同步策略"
            description="Git 仓库负责跨机器 / 跨团队共享；本机负责审核、投影与向各 Agent 分发。Prompt 与 Agent 指令默认跟随仓库策略，但每条都可以设为仅本机。"
          >
            <dl className="divide-y divide-border/60">
              {[
                { label: 'Skills', value: '双向同步 · 按文件夹映射目录', tone: 'text-primary' },
                { label: 'MCP', value: '一 server 一文件 · 密钥只存本机', tone: 'text-info' },
                { label: 'Prompts', value: '按文件夹映射 · 可设为仅本机', tone: 'text-info' },
                { label: 'Agent 指令', value: '仓库文件夹 + 项目投影 + 全局目录投影', tone: 'text-info' },
              ].map((r) => (
                <div key={r.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <dt className="w-24 shrink-0 text-xs font-medium">{r.label}</dt>
                  <dd className={cn('text-xs', r.tone)}>{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-border/60 pt-3 text-[10.5px] leading-5 text-muted-foreground">
              仓库连接、拉取 / 推送、冲突解决与 Skill / MCP 分发统一在左侧「同步」工作区完成；Agent
              指令的投影与漂移在「Agent 指令」工作区完成。原型不会访问真实 Git 或文件系统。
            </p>
          </SettingsSection>

          <SettingsSection
            id="repo-layout"
            icon="folder"
            title="仓库目录结构"
            description="平台中的文件夹就是仓库目录；目录内可以继续建子文件夹，每个目录里保持单文件约定。这样即使不打开 Prompt Keeper，也能在 Git 仓库中直接浏览和维护。"
          >
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3.5 font-mono text-[11px] leading-5">
{`prompts/<分类>/<子分类>/<slug>.prompt.md
instructions/<分类>/<子分类>/<slug>.contract.md
skills/<分类>/<skill-name>/SKILL.md
mcp/<分类>/<server-name>.json`}
            </pre>
          </SettingsSection>

          <SettingsSection
            id="global-dirs"
            icon="send"
            title="Agent 全局目录"
            description="Agent 指令可以单独投影到本机 Agent 的用户级目录；路径可在「Agent 指令 → 全局分发」中逐项修改，修改后对应投影会标记为待更新。"
          >
            <div className="divide-y divide-border/60">
              {state.globalTargets.map((target) => (
                <div key={target.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="w-32 shrink-0 truncate text-xs font-medium">{target.agentName}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {target.pathMode === 'file' ? '单文件' : '独立文件'}
                  </span>
                  <code className="ml-auto max-w-[55%] truncate font-mono text-[10px] text-muted-foreground">
                    {target.path}
                  </code>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            id="data"
            icon="history"
            title="数据"
            description="原型数据保存在浏览器 localStorage（键 pk_state_v1）。真实产品为 SQLite + 应用托管的 Git 克隆目录 + 系统钥匙串；WebDAV / S3 快照作为 Git 之外的备份选项保留在后续迭代。"
          >
            <Button
              variant="outline"
              className="text-danger hover:border-danger/40 hover:bg-danger-soft"
              onClick={() => setConfirmReset(true)}
            >
              <Icon name="refresh" />
              重置演示数据
            </Button>
          </SettingsSection>

          <SettingsSection
            id="about"
            icon="sparkles"
            title="关于"
            description="Prompt Keeper 原型 v0.5.0"
          >
            <p className="text-xs leading-6 text-muted-foreground">
              在 PromptHub（AGPL-3.0）v0.6.2 的 Prompt / Skill / MCP 管理域之上，增加 Git
              仓库双向同步、多 Agent 分发层与 Agent 指令契约；v0.5 把四类资产统一为「文件夹即仓库目录」，并为
              Agent 指令增加可改写路径的本机全局目录分发。
            </p>
            <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">
              交互设计文档见 docs/interaction-design.md；本原型不含真实后端，Git 操作、投影、分发与 AI 响应均为模拟。
            </p>
          </SettingsSection>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          resetAll()
          toast.success('已重置为初始演示数据')
        }}
        title="重置演示数据？"
        confirmText="重置"
        message="将清除你在原型中做过的全部修改（含版本与分发状态），恢复为初始种子数据。"
      />
    </div>
  )
}

function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string
  icon: IconName
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section
      id={`settings-${id}`}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-muted-foreground">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold leading-5">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}
