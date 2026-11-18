import { useEffect, useState } from 'react'
import type { RepoConfig } from '../../types'
import { useStore } from '../../store/store'
import { Badge, Button, Checkbox, Input, Select, Switch } from '../ui/core'
import { Modal, ConfirmDialog } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { useToast } from '../ui/toast'

const STEPS = ['Connect repository', 'Directory mapping', 'Sync policy', 'Preflight'] as const

export function RepoConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, connectRepo, disconnectRepo } = useStore()
  const toast = useToast()

  const [step, setStep] = useState(1)
  const [url, setUrl] = useState(state.repo.url)
  const [branch, setBranch] = useState(state.repo.branch)
  const [auth, setAuth] = useState<RepoConfig['auth']>(state.repo.auth)
  const [cloneMode, setCloneMode] = useState<'managed' | 'existing'>('managed')
  const [localPath, setLocalPath] = useState(state.repo.localPath)
  const [skillsDir, setSkillsDir] = useState(state.repo.layout.skills)
  const [mcpDir, setMcpDir] = useState(state.repo.layout.mcp)
  const [promptsDir, setPromptsDir] = useState(state.repo.layout.prompts)
  const [contractsDir, setContractsDir] = useState(state.repo.layout.contracts)
  const [syncPrompts, setSyncPrompts] = useState(state.repo.policies.prompts)
  const [syncContracts, setSyncContracts] = useState(state.repo.policies.contracts)
  const [autoFetch, setAutoFetch] = useState(state.repo.autoFetch)
  const [interval, setInterval] = useState(String(state.repo.fetchIntervalMin))
  const [pushMode, setPushMode] = useState<RepoConfig['pushMode']>(state.repo.pushMode)
  const [trusted, setTrusted] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setUrl(state.repo.url)
    setBranch(state.repo.branch)
    setAuth(state.repo.auth)
    setCloneMode('managed')
    setLocalPath(state.repo.localPath)
    setSkillsDir(state.repo.layout.skills)
    setMcpDir(state.repo.layout.mcp)
    setPromptsDir(state.repo.layout.prompts)
    setContractsDir(state.repo.layout.contracts)
    setSyncPrompts(state.repo.policies.prompts)
    setSyncContracts(state.repo.policies.contracts)
    setAutoFetch(state.repo.autoFetch)
    setInterval(String(state.repo.fetchIntervalMin))
    setPushMode(state.repo.pushMode)
    setTrusted(false)
    setError(null)
  }, [open, state.repo])

  const next = () => {
    if (step === 1) {
      if (!url.trim() || !branch.trim() || !localPath.trim()) {
        setError('Repository URL, branch, and local clone path are all required')
        return
      }
    }
    if (
      step === 2 &&
      (!skillsDir.trim() || !mcpDir.trim() || !promptsDir.trim() || !contractsDir.trim())
    ) {
      setError('Skill, MCP, Prompt, and Agent Instructions directory paths are required')
      return
    }
    setError(null)
    setStep((s) => Math.min(4, s + 1))
  }

  const finish = () => {
    connectRepo({
      ...state.repo,
      connected: true,
      provider: url.includes('gitlab') ? 'gitlab' : url.includes('github') || /^[\w.-]+\/[\w.-]+$/.test(url) ? 'github' : 'generic',
      url: url.trim(),
      branch: branch.trim(),
      auth,
      localPath: localPath.trim(),
      autoFetch,
      fetchIntervalMin: Number(interval),
      pushMode,
      layout: {
        skills: skillsDir.trim(),
        mcp: mcpDir.trim(),
        prompts: promptsDir.trim(),
        contracts: contractsDir.trim(),
      },
      policies: { skills: true, mcp: true, prompts: syncPrompts, contracts: syncContracts },
    })
    toast.success(
      state.repo.connected
        ? 'Repository settings saved; sync status and history are unchanged'
        : 'Repository connected. Remote changes land in "Changes" for your review first and never overwrite local files automatically',
    )
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-2xl"
        title={state.repo.connected ? 'Repository settings' : 'Connect Git repository'}
        subtitle={`Step ${step} of 4 · ${STEPS[step - 1]}`}
        footer={
          <>
            {state.repo.connected && step === 1 && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
            {error && <span className="mr-auto text-xs text-danger">{error}</span>}
            <Button variant="outline" onClick={step === 1 ? onClose : () => setStep((s) => Math.max(1, s - 1))}>
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step < 4 ? (
              <Button onClick={next}>
                Next
                <Icon name="chevronRight" />
              </Button>
            ) : (
              <Button disabled={!trusted} onClick={finish}>
                {state.repo.connected ? 'Save settings' : 'Finish connection'}
              </Button>
            )}
          </>
        }
      >
        <div className="mb-4 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  i + 1 <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {i + 1 < step ? <Icon name="check" className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn('text-[11px]', i + 1 === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Repository URL *</label>
              <Input aria-label="Repository URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="owner/repo or full Git URL" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Supports GitHub / GitLab / self-hosted Git. Example: tony/ai-assets. Private repos use the Git credentials or SSH key already on your machine; tokens are never stored in the app.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Branch</label>
                <Input aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Authentication</label>
                <Select aria-label="Authentication" value={auth} onChange={(e) => setAuth(e.target.value as RepoConfig['auth'])}>
                  <option value="credential">System Git credentials (recommended)</option>
                  <option value="ssh">SSH Key</option>
                  <option value="token">Access token (this session only)</option>
                </Select>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Local clone</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'managed', title: 'Managed by the app (recommended)', desc: 'Clones into the app data directory without touching your existing work repos' },
                    { v: 'existing', title: 'Use an existing clone', desc: 'Reuses a directory you already cloned; warns first if it has uncommitted changes' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setCloneMode(o.v)}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                      cloneMode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="text-sm font-medium">{o.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Local path *</label>
              <Input
                aria-label="Local clone path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="font-mono text-xs"
                placeholder="~/Library/Application Support/Prompt Keeper/repos/ai-assets"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              <Icon name="gitBranch" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Repository structure detected automatically. If your repo uses different directories, edit the mapping here; unmatched assets go to "Unfiled" and prompt you to choose.
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5">
{`prompts/engineering/code-quality/review.prompt.md
instructions/team/frontend/frontend.contract.md
skills/dev-workflow/git/commit-helper/SKILL.md
mcp/development/github/github.json`}
            </pre>
            {(
              [
                { label: 'Skills directory', value: skillsDir, set: setSkillsDir, hint: 'One folder per category; one subfolder per Skill containing SKILL.md and optional scripts/' },
                { label: 'MCP directory', value: mcpDir, set: setMcpDir, hint: 'One folder per category; one <name>.json per server; credentials must use ${VAR} placeholders' },
                { label: 'Prompts directory', value: promptsDir, set: setPromptsDir, hint: 'Nested folders allowed; one .prompt.md per Prompt; frontmatter holds metadata and variable definitions, body splits into System / User sections' },
                { label: 'Agent Instructions directory', value: contractsDir, set: setContractsDir, hint: 'Nested folders allowed; one .contract.md per contract; frontmatter holds folder / scope / activation / targets' },
              ] as const
            ).map((f) => (
              <div key={f.label}>
                <div className="mb-1 flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <Badge variant="success">Detected</Badge>
                </div>
                <Input aria-label={f.label} value={f.value} onChange={(e) => f.set(e.target.value)} className="font-mono text-xs" />
                <p className="mt-1 text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">Sync Prompts with the repository (recommended)</div>
                <p className="text-[11px] text-muted-foreground">
                  Team Prompt templates are shared through the repo; each Prompt can still be set to local only, so private content is never force-pushed.
                </p>
              </div>
              <Switch checked={syncPrompts} onChange={setSyncPrompts} label="Sync Prompts with the repository" />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">Sync Agent Instructions with the repository (recommended)</div>
                <p className="text-[11px] text-muted-foreground">
                  The source of truth for AGENTS.md / CLAUDE.md / .cursor/rules is shared through the repo; each contract can still be set to local only.
                </p>
              </div>
              <Switch checked={syncContracts} onChange={setSyncContracts} label="Sync Agent Instructions with the repository" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">Scheduled fetch (read-only)</div>
                <p className="text-[11px] text-muted-foreground">Only fetches remote metadata and flags differences; never merges or rewrites local assets automatically.</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Select aria-label="Fetch interval" className="h-8 w-24 text-xs" value={interval} onChange={(e) => setInterval(e.target.value)}>
                  <option value="5">Every 5 minutes</option>
                  <option value="15">Every 15 minutes</option>
                  <option value="30">Every 30 minutes</option>
                  <option value="60">Hourly</option>
                </Select>
                <Switch checked={autoFetch} onChange={setAutoFetch} label="Scheduled fetch" />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Push method</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'branch-pr', title: 'Push branch + PR (recommended)', desc: 'Reviewable in team repos; personal repos still get one last confirmation' },
                    { v: 'direct', title: 'Push directly to current branch', desc: 'Best for personal repos; creates commits directly and never rewrites the remote on failure' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setPushMode(o.v)}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                      pushMode === o.v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="text-sm font-medium">{o.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              <div className="flex items-center gap-1.5 font-medium">
                <Icon name="lock" className="h-3.5 w-3.5" />
                MCP secret policy (required)
              </div>
              <p className="mt-1 leading-5">
                Only ${'{'}VAR{'}'} placeholders are allowed in the repo. Push scans env / headers, Prompt and instruction content, and blocks any plaintext token;
                real values live only in the local keychain or are filled in temporarily as Prompt variables, then injected per target tool at dispatch time.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-lg border border-border">
              {(
                [
                  { icon: 'download' as const, label: 'Remote assets', value: '5 Skills · 3 MCP templates · 4 Prompt changes · 2 instruction changes · 2 conflicts', tone: 'text-foreground' },
                  { icon: 'folder' as const, label: 'Directory structure', value: 'Folder hierarchies for all four asset types resolve; empty directories are not written, unknown files go to "Unfiled"', tone: 'text-success' },
                  { icon: 'alert' as const, label: 'Executable scripts', value: '1 new Skill includes scripts/collect.sh and must be reviewed before writing', tone: 'text-warning' },
                  { icon: 'message' as const, label: 'Prompt format', value: '4 .prompt.md files pass structure validation; each must be previewed individually before pull', tone: 'text-success' },
                  { icon: 'file' as const, label: 'Instruction format', value: '2 .contract.md files pass structure validation; frontmatter and content parse correctly', tone: 'text-success' },
                  { icon: 'shield' as const, label: 'Credential scan', value: '1 suspected credential in Prompt content and 1 in MCP will be blocked or require conversion', tone: 'text-warning' },
                  { icon: 'folder' as const, label: 'Local uncommitted changes', value: 'None (app-managed clone directory)', tone: 'text-muted-foreground' },
                ] as const
              ).map((r) => (
                <div key={r.label} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0">
                  <Icon name={r.icon} className="text-muted-foreground" />
                  <span className="w-28 shrink-0 text-muted-foreground">{r.label}</span>
                  <span className={r.tone}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
              Nothing is written to any Agent directory on connect: changes go to "Changes" for review and merge into the local library first, then you pick target Agents in "Dispatch".
              Prompt and Agent Instructions changes require a full preview each and are never batch-accepted. First dispatch uses symlinks by default; if the filesystem does not support them, it falls back to copy with per-item prompts.
            </div>
            <Checkbox
              checked={trusted}
              onChange={setTrusted}
              label={
                <span className="text-xs">
                  I have verified the repository source and understand that scripts in Skills and MCP commands will run on my machine
                </span>
              }
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          disconnectRepo()
          toast.warning('Repository disconnected; local assets and Agent dispatch are unaffected')
          onClose()
        }}
        title="Disconnect repository?"
        confirmText="Disconnect"
        message="Only the sync relationship is removed; local assets, version history, and already dispatched files are kept. Sync resumes after reconnecting."
      />
    </>
  )
}
