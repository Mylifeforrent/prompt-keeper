import { useEffect, useState } from 'react'
import type { Prompt, PromptSyncPolicy } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button } from '../ui/core'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import {
  PROMPT_SYNC_POLICY_META,
  promptEffectiveSync,
  promptFilePath,
} from '../../lib/promptSync'
import { assetRepoState, REPO_STATE_META } from '../../lib/sync'

const OPTIONS: PromptSyncPolicy[] = ['inherit', 'sync', 'local']

export function PromptSyncModal({
  open,
  prompt,
  onClose,
}: {
  open: boolean
  prompt: Prompt
  onClose: () => void
}) {
  const { state, setPromptSyncPolicy } = useStore()
  const toast = useToast()
  const [policy, setPolicy] = useState<PromptSyncPolicy>(prompt.syncPolicy)

  useEffect(() => {
    if (open) setPolicy(prompt.syncPolicy)
  }, [open, prompt])

  const globalOn = state.repo.policies.prompts
  const connected = state.repo.connected
  const effective = promptEffectiveSync(state.repo, { syncPolicy: policy })
  const stateNow = assetRepoState(
    state.syncChanges,
    'prompt',
    prompt.title,
    effective,
    prompt.id,
  )
  const stateMeta = REPO_STATE_META[stateNow]
  const pending = state.syncChanges.filter(
    (c) =>
      c.kind === 'prompt' &&
      !c.resolved &&
      (c.assetId ? c.assetId === prompt.id : c.assetName === prompt.title),
  ).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={`Sync settings — ${prompt.title}`}
      subtitle="Prompts travel between machines and teammates only through Git; they are never written to default Agent directories"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setPromptSyncPolicy(prompt.id, policy)
              toast.success(
                policy === 'local'
                  ? 'Set to local only; future edits create no pending pushes'
                  : policy === 'sync'
                    ? 'Added to repo sync; pushes still need confirmation in Sync Center'
                    : 'Following repo policy',
              )
              onClose()
            }}
          >
            <Icon name="check" />
            Save scope
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5">
          <Badge variant={effective ? 'info' : 'outline'}>
            {effective ? 'In repo sync' : 'Local only'}
          </Badge>
          <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {connected
              ? globalOn
                ? 'Repo connected · Prompt sync on'
                : 'Repo connected · Prompt sync off'
              : 'No repo connected'}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">{pending} pending changes</span>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const meta = PROMPT_SYNC_POLICY_META[option]
            const disabled = option === 'sync' && !globalOn
            const active = policy === option
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => setPolicy(option)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                  disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-primary bg-primary' : 'border-input',
                  )}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {meta.label}
                    {option === 'local' && <Badge variant="outline">Recommended for private prompts</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
                    {meta.desc}
                    {disabled ? ' Enable Prompt sync in Sync Center first.' : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Repo file</div>
          <div className="mt-0.5 break-all font-mono text-xs">{promptFilePath(prompt, state.repo.layout.prompts)}</div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Metadata (title / tags / variable definitions) lives in frontmatter; the body is split into System and User sections; variable values are never written to disk.
          </p>
        </div>

        {policy === 'local' && pending > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {pending} unresolved changes. Saving withdraws these pending items, but existing repo files are not deleted.
          </div>
        )}

        {!globalOn && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            <Icon name="cloud" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Prompt sync is currently turned off in repo settings; your choice here is saved as a local preference only.
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Sync is not dispatch: prompts are written only to the local asset library. For rule-like content, use the separate Agent Instructions workspace and distribute via project projection or the global directory.
        </div>
      </div>
    </Modal>
  )
}
