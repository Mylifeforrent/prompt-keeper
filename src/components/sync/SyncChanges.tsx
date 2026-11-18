import { useEffect, useState } from 'react'
import type { SyncChange } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Input, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'
import { Tabs } from '../ui/tabs'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { ASSET_META, CHANGE_META, RISK_META, activeChanges } from '../../lib/sync'
import { parsePromptFile } from '../../lib/promptSync'
import { parseContractFile } from '../../lib/contracts'
import { Markdown } from '../shared/Markdown'
import { DiffView } from '../shared/DiffView'

type ChangeTab = 'incoming' | 'outgoing' | 'conflict'

export function SyncChanges() {
  const { state, pullIncoming } = useStore()
  const toast = useToast()
  const [tab, setTab] = useState<ChangeTab>('incoming')
  const [selected, setSelected] = useState<string[]>([])
  const [reviewOf, setReviewOf] = useState<SyncChange | null>(null)
  const [conflictOf, setConflictOf] = useState<SyncChange | null>(null)
  const [secretOf, setSecretOf] = useState<SyncChange | null>(null)
  const [pushIds, setPushIds] = useState<string[] | null>(null)

  const incoming = activeChanges(state.syncChanges, 'incoming')
  const outgoing = activeChanges(state.syncChanges, 'outgoing')
  const conflicts = activeChanges(state.syncChanges, 'conflict')
  const rows = tab === 'incoming' ? incoming : tab === 'outgoing' ? outgoing : conflicts

  useEffect(() => setSelected([]), [tab])

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const accept = (change: SyncChange) => {
    if (change.kind === 'prompt' || change.kind === 'contract' || change.risk !== 'none') {
      setReviewOf(change)
      return
    }
    pullIncoming([change.id])
    toast.success(`Accepted ${change.kind}:${change.assetName}; a new version was created in the local library`)
  }

  const batchAccept = () => {
    const ids = selected.filter((id) =>
      incoming.some(
        (c) => c.id === id && c.risk === 'none' && c.kind !== 'prompt' && c.kind !== 'contract',
      ),
    )
    if (ids.length === 0) return
    pullIncoming(ids)
    toast.success(`Accepted ${ids.length} low-risk changes and created versions; Prompts and instructions require individual preview`)
    setSelected([])
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3.5 py-2.5 text-xs leading-5 text-info">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Sync between the repo and the local library is a three-way merge: <b>remote (repo)</b>, <b>local (local library)</b>, and <b>base (last sync)</b>.
          Changes from either side alone advance automatically; when both sides change, it becomes a "conflict" and silent overwrite is never allowed.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Tabs
          tabs={[
            { value: 'incoming', label: 'Incoming', count: incoming.length },
            { value: 'outgoing', label: 'Outgoing', count: outgoing.length },
            { value: 'conflict', label: 'Conflicts', count: conflicts.length },
          ]}
          value={tab}
          onChange={(v) => setTab(v as ChangeTab)}
        />
        <span className="text-[11px] text-muted-foreground">
          {tab === 'incoming' && 'Prompts and Agent Instructions must be fully previewed and accepted one by one; assets with scripts or new Skills also need review'}
          {tab === 'outgoing' && 'Push rescans Prompt / instruction content and MCP env / headers; blocked items never enter the commit'}
          {tab === 'conflict' && 'Choose the repo version, keep local, or merge manually before writing'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'incoming' && (
            <Button size="sm" disabled={selected.length === 0} onClick={batchAccept}>
              <Icon name="check" className="h-3.5 w-3.5" />
              Accept selected ({selected.length})
            </Button>
          )}
          {tab === 'outgoing' && (
            <Button
              size="sm"
              disabled={selected.length === 0}
              onClick={() => setPushIds(selected)}
            >
              <Icon name="arrowUp" className="h-3.5 w-3.5" />
              Push selected ({selected.length})
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon name={tab === 'conflict' ? 'check' : tab === 'incoming' ? 'arrowDown' : 'arrowUp'} className="h-5 w-5" />
          </div>
          <p className="mt-2 text-sm font-medium">
            {tab === 'incoming' ? 'No incoming changes' : tab === 'outgoing' ? 'No local changes to push' : 'No conflicts'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === 'conflict' ? 'Sync is healthy; conflicts appear here when both sides change the same file.' : 'New remote differences appear here after a fetch.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              selected={selected.includes(c.id)}
              onToggle={() => toggle(c.id)}
              onAccept={() => accept(c)}
              onReview={() => setReviewOf(c)}
              onPush={() => setPushIds([c.id])}
              onConflict={() => setConflictOf(c)}
              onSecret={() => setSecretOf(c)}
            />
          ))}
        </div>
      )}

      {reviewOf && (
        <ReviewIncomingModal
          change={reviewOf}
          onClose={() => setReviewOf(null)}
          onAccepted={() => {
            pullIncoming([reviewOf.id])
            toast.success(
              reviewOf.kind === 'prompt'
                ? `Accepted Prompt "${reviewOf.assetName}"; a new version was created in the local library`
                : reviewOf.kind === 'contract'
                  ? `Accepted instruction "${reviewOf.assetName}"; a new version was created and related projections are marked stale`
                  : `Reviewed and accepted ${reviewOf.assetName}; scripts will be written along with the Skill`,
            )
            setReviewOf(null)
            setSelected([])
          }}
        />
      )}

      {pushIds && <PushModal ids={pushIds} onClose={() => setPushIds(null)} onDone={() => setSelected([])} />}

      {secretOf && (
        <SecretFixModal
          change={secretOf}
          onClose={() => setSecretOf(null)}
        />
      )}

      {conflictOf && <ConflictModal change={conflictOf} onClose={() => setConflictOf(null)} />}
    </div>
  )
}

function ChangeRow({
  change,
  selected,
  onToggle,
  onAccept,
  onReview,
  onPush,
  onConflict,
  onSecret,
}: {
  change: SyncChange
  selected: boolean
  onToggle: () => void
  onAccept: () => void
  onReview: () => void
  onPush: () => void
  onConflict: () => void
  onSecret: () => void
}) {
  const asset = ASSET_META[change.kind]
  const changeMeta = CHANGE_META[change.change]
  const risk = RISK_META[change.risk]
  const selectable =
    change.direction !== 'conflict' &&
    !change.blocked &&
    change.risk === 'none' &&
    change.kind !== 'prompt' &&
    change.kind !== 'contract'
  const needsReview = change.risk !== 'none' || change.kind === 'prompt' || change.kind === 'contract'

  const versionLine =
    change.direction === 'conflict'
      ? `Repo ${change.remoteVersion ?? '—'} / Local ${change.localVersion ?? '—'} / Base ${change.baseVersion ?? '—'}`
      : change.direction === 'incoming'
        ? change.localVersion && change.remoteVersion
          ? `${change.localVersion} → ${change.remoteVersion}`
          : change.versionLabel
        : change.baseVersion && change.localVersion
          ? `${change.baseVersion} → ${change.localVersion}`
          : change.localVersion

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-colors',
        change.direction === 'conflict'
          ? 'border-danger/30'
          : change.blocked
            ? 'border-danger/30 bg-danger-soft/30'
            : selected
              ? 'border-primary ring-2 ring-ring/15'
              : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-4 shrink-0">
          {selectable ? (
            <Checkbox checked={selected} onChange={onToggle} />
          ) : change.direction === 'conflict' ? (
            <Icon name="alert" className="h-4 w-4 text-danger" />
          ) : change.blocked ? (
            <Icon name="lock" className="h-4 w-4 text-danger" />
          ) : change.kind === 'prompt' || change.kind === 'contract' ? (
            <Icon name="eye" className="h-4 w-4 text-info" />
          ) : (
            <Icon name="shield" className="h-4 w-4 text-warning" />
          )}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name={asset.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{change.assetName}</span>
            <Badge variant="secondary">{asset.label}</Badge>
            <Badge variant={changeMeta.variant}>{changeMeta.label}</Badge>
            {versionLine && <span className="text-[11px] text-muted-foreground">{versionLine}</span>}
            {change.risk !== 'none' && (
              <Badge variant={risk.variant}>
                <Icon name={risk.icon} className="h-3 w-3" />
                {risk.label}
              </Badge>
            )}
            {change.blocked && <Badge variant="danger">Push blocked</Badge>}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{change.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{change.path}</code>
            <span className="text-success">+{change.additions}</span>
            <span className="text-danger">−{change.deletions}</span>
            {change.files && <span>· {change.files.length} files</span>}
          </div>
        </div>
        <div className="ml-2 shrink-0">
          {change.direction === 'incoming' && (
            <Button size="sm" variant={needsReview ? 'outline' : 'default'} onClick={needsReview ? onReview : onAccept}>
              {change.kind === 'prompt' || change.kind === 'contract'
                ? 'Preview & accept'
                : needsReview
                  ? 'Review & accept'
                  : 'Accept'}
              <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Button>
          )}
          {change.direction === 'outgoing' &&
            (change.blocked ? (
              <Button size="sm" variant="danger" onClick={onSecret}>
                <Icon name="lock" className="h-3.5 w-3.5" />
                Fix secret
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onPush}>
                <Icon name="arrowUp" className="h-3.5 w-3.5" />
                Push
              </Button>
            ))}
          {change.direction === 'conflict' && (
            <Button size="sm" variant="danger" onClick={onConflict}>
              <Icon name="alert" className="h-3.5 w-3.5" />
              Resolve conflict
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Review incoming asset ---------------- */

function ReviewIncomingModal({
  change,
  onClose,
  onAccepted,
}: {
  change: SyncChange
  onClose: () => void
  onAccepted: () => void
}) {
  const [trusted, setTrusted] = useState(false)
  const risk = RISK_META[change.risk]
  const isPrompt = change.kind === 'prompt'
  const isContract = change.kind === 'contract'
  const isInstruction = isPrompt || isContract
  const showDiff = isInstruction && !!change.localContent && !!change.remoteContent

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={`${isInstruction ? 'Preview & accept' : 'Review & accept'} — ${ASSET_META[change.kind].label} ${change.assetName}`}
      subtitle={
        isPrompt
          ? 'Prompts become instruction input; confirm the content, source, and that it contains no private information of yours'
          : isContract
            ? 'Agent Instructions enter the context of every session automatically; confirm the content, source, and that it contains no private information of yours'
            : 'Repo content is written verbatim into the local library; scripts in Skills may be executed, so read everything first'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Reject
          </Button>
          <Button disabled={!trusted} onClick={onAccepted}>
            {isPrompt ? 'Accept Prompt' : isContract ? 'Accept instruction' : 'Trust & accept'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isInstruction ? (
          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-info">
            <Icon name="eye" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <b>{isPrompt ? 'Prompts must be previewed individually' : 'Agent Instructions must be previewed individually'}</b>
              <p className="mt-0.5 leading-5">
                {isPrompt
                  ? 'Prompts shape the output of later AI requests. Even without scripts they are excluded from batch accept; accepting writes only to the local library and never dispatches to Agents automatically.'
                  : 'Instructions are read automatically by Agents and affect every session. Even without scripts they are excluded from batch accept; accepting writes only to the local library and never projects into Agent directories automatically.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
            <Icon name={risk.icon} className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <b>{risk.label}</b>
              <p className="mt-0.5 leading-5">
                This item contains executable content. Accepting writes only to the local asset library and never dispatches to Agents automatically; dispatch confirms the target path and mode again.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{change.versionLabel ?? change.remoteVersion ?? '—'}</Badge>
          <Badge variant="outline">{change.files?.length ?? 1} files</Badge>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{change.path}</code>
        </div>

        {change.files && (
          <div className="rounded-lg border border-border">
            {change.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs last:border-0">
                <Icon name="file" className="text-muted-foreground" />
                <span className="font-mono">{f.path}</span>
                <span className="ml-auto text-muted-foreground">{f.size}</span>
              </div>
            ))}
          </div>
        )}

        {showDiff ? (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Local version → repo version</div>
            <DiffView before={change.localContent ?? ''} after={change.remoteContent ?? ''} />
          </div>
        ) : change.remoteContent ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border p-3">
            <Markdown text={change.remoteContent} />
          </div>
        ) : (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            This item has no previewable content; inspect the full file in the repo before accepting.
          </p>
        )}

        <Checkbox
          checked={trusted}
          onChange={setTrusted}
          label={
            <span className="text-xs">
              {isInstruction
                ? 'I have previewed the full content and confirmed it is safe and contains no private information of mine'
                : 'I have read the above and confirm the source is trustworthy'}
            </span>
          }
        />
      </div>
    </Modal>
  )
}

/* ---------------- Push ---------------- */

function PushModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { state, pushOutgoing } = useStore()
  const toast = useToast()
  const rows = state.syncChanges.filter((c) => ids.includes(c.id) && c.direction === 'outgoing' && !c.blocked && !c.resolved)
  const [message, setMessage] = useState(
    'chore: sync prompts, instructions, skills and MCP templates from Prompt Keeper',
  )
  const [createPr, setCreatePr] = useState(state.repo.pushMode === 'branch-pr')

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title={`Push to repo — ${rows.length} items`}
      subtitle={`${state.repo.url} · ${state.repo.branch}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!message.trim() || rows.length === 0}
            onClick={() => {
              pushOutgoing(
                rows.map((r) => r.id),
                message.trim(),
                createPr,
              )
              toast.success(
                createPr
                  ? `Pushed ${rows.length} items to a separate branch and created a PR (prototype simulation)`
                  : `Pushed ${rows.length} items to ${state.repo.branch} (prototype simulation)`,
              )
              onDone()
              onClose()
            }}
          >
            <Icon name="arrowUp" />
            Push
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <Icon name={ASSET_META[r.kind].icon} className="text-muted-foreground" />
              <span className="font-medium">{r.assetName}</span>
              <Badge variant="secondary">{ASSET_META[r.kind].label}</Badge>
              <code className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{r.path}</code>
            </div>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Commit message *</label>
          <Input aria-label="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Push method</div>
          {(
            [
              { v: true, title: 'Separate branch + PR (recommended)', desc: 'Reviewable and revertible; the main branch is never modified directly' },
              { v: false, title: 'Push directly to the current branch', desc: 'Best for personal repos; a failure never rewrites the remote' },
            ] as const
          ).map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setCreatePr(o.v)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                createPr === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
              )}
            >
              <Icon name={o.v ? 'gitBranch' : 'arrowUp'} className={cn('mt-0.5 h-4 w-4', createPr === o.v ? 'text-primary' : 'text-muted-foreground')} />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Push rescans Prompt / instruction content and MCP env / headers and blocks the entire commit on plaintext credentials. Credentials may only enter the repo as
          {` {{variable}} `}or ${'{'}VAR{'}'} placeholders.
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Plaintext secret handling ---------------- */

function SecretFixModal({ change, onClose }: { change: SyncChange; onClose: () => void }) {
  const { convertSecretToVar } = useStore()
  const toast = useToast()
  const isPrompt = change.kind === 'prompt'
  const isContract = change.kind === 'contract'
  const isInstruction = isPrompt || isContract

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-lg"
      title={
        isPrompt
          ? 'Prompt content may contain a plaintext credential'
          : isContract
            ? 'Instruction content may contain a plaintext credential'
            : 'Plaintext secret blocks push'
      }
      subtitle={`${ASSET_META[change.kind].label} · ${change.assetName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              convertSecretToVar(change.id)
              toast.success(
                isInstruction
                  ? 'Replaced with the {{api_key}} variable; fill in the value when copying or projecting — the real value is never written to disk'
                  : 'Converted to a ${AMAP_API_KEY} placeholder; the real value remains only in the local keychain',
              )
              onClose()
            }}
          >
            <Icon name="lock" />
            {isInstruction ? 'Replace with template variable' : 'Convert to variable reference'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          {isPrompt
            ? 'A possible token was detected in the Prompt content. Committing it would write the credential permanently into Git history for anyone with repo access to see.'
            : isContract
              ? 'A possible token was detected in the Agent Instructions content. Committing it would write the credential permanently into Git history, and the instruction is read in every session.'
              : 'A plaintext credential was detected in an env field. Committing it would write the secret permanently into Git history, where it stays recoverable even after deletion.'}
        </div>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
{isPrompt
  ? `userPrompt:
  "Test token: {{api_key}}"   ← raw value will be replaced by a variable`
  : isContract
    ? `## Frontend code standards
- Headers: Authorization: Bearer {{api_key}}   ← raw value will be replaced by a variable`
    : `"env": {
  "AMAP_API_KEY": "***"   ← will be replaced with "\${AMAP_API_KEY}"
}`}
        </pre>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {isInstruction ? (
            <>
              <li>The raw token in the content is replaced with the {`{{api_key}}`} template variable, and the variable definition syncs with the file.</li>
              <li>The real value is never written into Prompts / instructions, version snapshots, or the repo; you fill it in temporarily when copying or projecting.</li>
              <li>After replacement you can push normally; this commit still records a "plaintext found" audit event.</li>
            </>
          ) : (
            <>
              <li>Only variable names remain in the repo config, so no machine gets the real value when pulling.</li>
              <li>The real value stays in the local keychain and is injected per target tool at dispatch.</li>
              <li>After conversion you can push normally, but this commit still records a "plaintext found" audit event.</li>
            </>
          )}
        </ul>
      </div>
    </Modal>
  )
}

/* ---------------- Conflict resolution ---------------- */

function ConflictModal({ change, onClose }: { change: SyncChange; onClose: () => void }) {
  const { resolveConflict } = useStore()
  const toast = useToast()
  const [strategy, setStrategy] = useState<'remote' | 'local' | 'manual'>('remote')
  const [merged, setMerged] = useState(change.localContent ?? '')
  const isPrompt = change.kind === 'prompt'
  const isContract = change.kind === 'contract'
  const manualInvalid =
    strategy === 'manual' &&
    ((isPrompt && !parsePromptFile(merged)) || (isContract && !parseContractFile(merged)))

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title={`Resolve conflict — ${change.assetName}`}
      subtitle={`${ASSET_META[change.kind].label} · Repo and local both modified the same file`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Later
          </Button>
          <Button
            disabled={strategy === 'manual' && (!merged.trim() || manualInvalid)}
            onClick={() => {
              resolveConflict(change.id, strategy, merged)
              toast.success(
                strategy === 'remote'
                  ? 'Took the repo version; local library updated'
                  : strategy === 'local'
                    ? 'Kept the local version; the result was added to outgoing changes'
                    : 'Wrote the manual merge result and added it to outgoing changes',
              )
              onClose()
            }}
          >
            <Icon name="check" />
            Apply and mark resolved
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { label: 'Base (last sync)', value: change.baseVersion ?? '—', tone: 'text-muted-foreground' },
              { label: 'Repo version', value: change.remoteVersion ?? '—', tone: 'text-info' },
              { label: 'Local version', value: change.localVersion ?? '—', tone: 'text-warning' },
            ] as const
          ).map((v) => (
            <div key={v.label} className="rounded-lg border border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{v.label}</div>
              <div className={cn('mt-0.5 text-sm font-semibold', v.tone)}>{v.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: 'remote', title: 'Take repo', desc: 'Discard local changes; the repo becomes the new base' },
              { v: 'local', title: 'Keep local', desc: 'Keep local content; the result goes to outgoing changes' },
              { v: 'manual', title: 'Merge manually', desc: 'Edit section by section; safest but slower' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setStrategy(o.v)}
              className={cn(
                'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                strategy === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
              )}
            >
              <div className="text-xs font-medium">{o.title}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{o.desc}</div>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border p-3">
          {strategy === 'remote' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Repo changes vs base</div>
              <DiffView before={change.baseContent ?? ''} after={change.remoteContent ?? ''} />
            </>
          )}
          {strategy === 'local' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Local changes vs base</div>
              <DiffView before={change.baseContent ?? ''} after={change.localContent ?? ''} />
            </>
          )}
          {strategy === 'manual' && (
            <>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Merge result (editable)</div>
              <Textarea aria-label="Manual merge result" rows={14} value={merged} onChange={(e) => setMerged(e.target.value)} className="font-mono text-xs leading-5" />
              <p
                className={cn(
                  'mt-1 text-[11px]',
                  manualInvalid ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {manualInvalid
                  ? isContract
                    ? 'Incomplete structure: keep the frontmatter and contract body, and title and content must not be empty.'
                    : 'Incomplete structure: keep the frontmatter and both "## System Prompt" / "## User Prompt" headings.'
                  : 'Starts from the local version. Applying writes it to the local library and creates a new version; you can then push the result back from "Outgoing".'}
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
