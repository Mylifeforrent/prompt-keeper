import { useStore } from '../../store/store'
import type { ThemeMode } from '../../types'
import { Button } from '../ui/core'
import { ConfirmDialog } from '../ui/modal'
import { useState } from 'react'
import { useToast } from '../ui/toast'
import { cn } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

const THEMES: { v: ThemeMode; label: string; desc: string }[] = [
  { v: 'light', label: 'Light', desc: 'Always use the light theme' },
  { v: 'dark', label: 'Dark', desc: 'Always use the dark theme' },
  { v: 'system', label: 'System', desc: 'Follow the OS appearance automatically' },
]

const SECTIONS: { id: string; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'sync-policy', label: 'Sync policy' },
  { id: 'repo-layout', label: 'Repo structure' },
  { id: 'global-dirs', label: 'Agent global directories' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' },
]

export function SettingsView() {
  const { state, setTheme, resetAll } = useStore()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 xl:grid-cols-[160px_minmax(0,1fr)] lg:px-8">
        <aside className="hidden xl:block">
          <nav aria-label="Settings sections" className="sticky top-0 space-y-0.5">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">
              Settings
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
            title="Appearance"
            description="Theme changes apply immediately and persist on this machine."
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
            title="Sync policy"
            description="The Git repo handles sharing across machines and teams; this machine handles review, projection, and dispatch to each Agent. Prompts and Agent Instructions follow the repo policy by default, but each can be set to local only."
          >
            <dl className="divide-y divide-border/60">
              {[
                { label: 'Skills', value: 'Two-way sync · folders map to directories', tone: 'text-primary' },
                { label: 'MCP', value: 'One file per server · secrets stay local', tone: 'text-info' },
                { label: 'Prompts', value: 'Mapped by folder · can be local only', tone: 'text-info' },
                { label: 'Agent Instructions', value: 'Repo folders + project projection + global directory projection', tone: 'text-info' },
              ].map((r) => (
                <div key={r.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <dt className="w-24 shrink-0 text-xs font-medium">{r.label}</dt>
                  <dd className={cn('text-xs', r.tone)}>{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-border/60 pt-3 text-[10.5px] leading-5 text-muted-foreground">
              Repo connection, pull / push, conflict resolution, and Skill / MCP dispatch all happen in the "Sync" workspace on the left; instruction
              projection and drift happen in the "Agent Instructions" workspace. The prototype never touches real Git or the filesystem.
            </p>
          </SettingsSection>

          <SettingsSection
            id="repo-layout"
            icon="folder"
            title="Repo structure"
            description="Folders in the platform are repo directories; directories can hold nested subfolders, and each keeps the single-file convention. So you can browse and maintain everything directly in the Git repo without opening Prompt Keeper."
          >
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3.5 font-mono text-[11px] leading-5">
{`prompts/<category>/<subcategory>/<slug>.prompt.md
instructions/<category>/<subcategory>/<slug>.contract.md
skills/<category>/<skill-name>/SKILL.md
mcp/<category>/<server-name>.json`}
            </pre>
          </SettingsSection>

          <SettingsSection
            id="global-dirs"
            icon="send"
            title="Agent global directories"
            description="Agent Instructions can be projected separately to each local Agent's user-level directory; paths can be edited per item under Agent Instructions → Global dispatch, and affected projections are marked stale after a change."
          >
            <div className="divide-y divide-border/60">
              {state.globalTargets.map((target) => (
                <div key={target.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="w-32 shrink-0 truncate text-xs font-medium">{target.agentName}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {target.pathMode === 'file' ? 'Single file' : 'Standalone file'}
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
            title="Data"
            description="Prototype data lives in browser localStorage (key pk_state_v1). The real product uses SQLite + an app-managed Git clone directory + the system keychain; WebDAV / S3 snapshots remain a post-Git backup option for later iterations."
          >
            <Button
              variant="outline"
              className="text-danger hover:border-danger/40 hover:bg-danger-soft"
              onClick={() => setConfirmReset(true)}
            >
              <Icon name="refresh" />
              Reset demo data
            </Button>
          </SettingsSection>

          <SettingsSection
            id="about"
            icon="sparkles"
            title="About"
            description="Prompt Keeper prototype v0.5.0"
          >
            <p className="text-xs leading-6 text-muted-foreground">
              Built on the Prompt / Skill / MCP management domain of PromptHub (AGPL-3.0) v0.6.2, adding two-way Git
              repo sync, a multi-Agent dispatch layer, and Agent instruction contracts; v0.5 unifies the four asset types under "folders are repo directories" and adds
              editable-path local global directory dispatch for Agent Instructions.
            </p>
            <p className="mt-2 text-[10.5px] leading-5 text-muted-foreground">
              See docs/interaction-design.md for the interaction design; this prototype has no real backend, so Git operations, projection, dispatch, and AI responses are all simulated.
            </p>
          </SettingsSection>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          resetAll()
          toast.success('Reset to initial demo data')
        }}
        title="Reset demo data?"
        confirmText="Reset"
        message="Clears every change you made in the prototype (including versions and dispatch state) and restores the initial seed data."
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
