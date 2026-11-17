import { useStore } from '../../store/store'
import type { ThemeMode } from '../../types'
import { Button } from '../ui/core'
import { ConfirmDialog } from '../ui/modal'
import { useState } from 'react'
import { useToast } from '../ui/toast'
import { cn } from '../../lib/utils'
import { Icon } from '../../lib/icons'

const THEMES: { v: ThemeMode; label: string; desc: string }[] = [
  { v: 'light', label: '亮色', desc: '固定使用亮色主题' },
  { v: 'dark', label: '暗色', desc: '固定使用暗色主题' },
  { v: 'system', label: '跟随系统', desc: '默认；随操作系统外观自动切换' },
]

export function SettingsView() {
  const { state, setTheme, resetAll } = useStore()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">外观</h2>
          <p className="mt-1 text-xs text-muted-foreground">主题立即生效并持久化到本机。</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setTheme(t.v)}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                  state.settings.theme === t.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                )}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon name={t.v === 'dark' ? 'moon' : t.v === 'light' ? 'sun' : 'refresh'} className="h-4 w-4" />
                  {t.label}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{t.desc}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">同步策略</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Git 仓库负责跨机器 / 跨团队共享；本机负责审核与向各 Agent 分发。Prompt 默认不进入这条链路。
          </p>
          <div className="mt-3 space-y-1.5">
            {[
              { label: 'Skills', value: '双向同步 · 审核后分发', tone: 'text-primary' },
              { label: 'MCP', value: '模板双向 · 密钥只存本机', tone: 'text-info' },
              { label: 'Prompts', value: '不参与仓库同步 · 平台发现', tone: 'text-muted-foreground' },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="w-16 font-medium">{r.label}</span>
                <span className={r.tone}>{r.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            仓库连接、拉取 / 推送、冲突解决与 Agent 分发统一在左侧「同步」工作区完成。原型不会访问真实 Git 或文件系统。
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">数据</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            原型数据保存在浏览器 localStorage（键 pk_state_v1）。真实产品为 SQLite + 应用托管的 Git 克隆目录 + 系统钥匙串；
            WebDAV / S3 快照作为 Git 之外的备份选项保留在后续迭代。
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setConfirmReset(true)}>
            <Icon name="refresh" />
            重置演示数据
          </Button>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">关于</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Prompt Keeper 原型 v0.2.0 · 在 PromptHub（AGPL-3.0）v0.6.2 的 Prompt / Skill / MCP 管理域之上，
            增加 Git 仓库双向同步与多 Agent 分发层。
            <br />
            交互设计文档见 docs/interaction-design.md；本原型不含真实后端，Git 操作、分发与 AI 响应均为模拟。
          </p>
        </section>
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
