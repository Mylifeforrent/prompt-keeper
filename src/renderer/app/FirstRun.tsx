import type { AssetKind } from '../../shared/contracts'
import { Button } from '../components/ui/core'
import { Icon, type IconName } from '../lib/icons'

const ASSETS: Array<{ kind: AssetKind; title: string; description: string; icon: IconName }> = [
  {
    kind: 'prompt',
    title: 'Prompts',
    description: 'Reusable prompt text with {{variables}}. Stored locally and synced to Git when you turn it on.',
    icon: 'message',
  },
  {
    kind: 'contract',
    title: 'Agent Instructions',
    description: 'One contract, projected into AGENTS.md, CLAUDE.md, Cursor rules, and other agent formats.',
    icon: 'file',
  },
  {
    kind: 'skill',
    title: 'Skills',
    description: 'SKILL.md plus supporting files, dispatched to each agent by symlink or copy.',
    icon: 'grid',
  },
  {
    kind: 'mcp',
    title: 'MCP',
    description: 'Server configuration with encrypted secrets. Repository files contain only placeholders.',
    icon: 'server',
  },
]

export function FirstRun({
  onCreate,
  onConnect,
  onOpenSettings,
  onDismiss,
}: {
  onCreate: (kind: AssetKind) => void
  onConnect: () => void
  onOpenSettings: () => void
  onDismiss: () => void
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-[680px] rounded-2xl border border-border bg-card p-6 shadow-popover">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon name="sparkles" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Welcome to Prompt Keeper</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              One local control plane for four AI coding asset types. Nothing is written to an Agent directory
              or pushed to Git without a preview and your confirmation.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ASSETS.map((asset) => (
            <button
              key={asset.kind}
              type="button"
              onClick={() => onCreate(asset.kind)}
              className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-muted/50"
            >
              <Icon name={asset.icon} className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-xs font-medium">{asset.title}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                  {asset.description}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={onConnect} variant="default" size="sm">
            <Icon name="gitBranch" className="h-3.5 w-3.5" />
            Connect a repository
          </Button>
          <Button onClick={onOpenSettings} variant="outline" size="sm">
            <Icon name="sliders" className="h-3.5 w-3.5" />
            Open settings
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Or start with an empty library and create an asset above.
          </span>
          <Button onClick={onDismiss} variant="ghost" size="sm" className="ml-auto">
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
