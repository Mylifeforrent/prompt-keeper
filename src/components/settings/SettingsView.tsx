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
          <h2 className="text-sm font-semibold">数据</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            原型数据保存在浏览器 localStorage（键 pk_state_v1）。真实产品为 SQLite + 工作区文件，支持 WebDAV / S3 同步与 .phub.gz 全量备份（后续迭代）。
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setConfirmReset(true)}>
            <Icon name="refresh" />
            重置演示数据
          </Button>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">关于</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Prompt Keeper 原型 v0.1.0 · 功能提取自 PromptHub（AGPL-3.0）v0.6.2 的 Prompt / Skill / MCP 管理域。
            <br />
            交互设计文档见 docs/interaction-design.md；本原型不含真实后端，所有分发与 AI 响应均为模拟。
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
