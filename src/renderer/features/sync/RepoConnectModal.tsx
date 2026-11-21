import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  RepoAuthInput,
  RepoConnectInput,
  RepoConnectPreview,
  RepoLayout,
  RepoPolicies,
  RepoProvider,
  RepoStatus,
  RepoUpdateInput,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner, Switch } from '../../components/ui/primitives'
import { ConfirmDialog, Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { cn } from '../../lib/cn'
import { useToast } from '../../components/ui/toast'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  AUTH_MODE_LABEL,
  CLONE_MODE_LABEL,
  KIND_META,
  POLICY_KEYS,
  POLICY_META,
  REPO_PROVIDER_LABEL,
  errorDetailLines,
  policyLabelList,
  type PolicyKey,
} from '../../lib/viewModels/sync'

const STEPS = ['Connect', 'Directory mapping', 'Sync policy', 'Preflight'] as const

const DEFAULT_LAYOUT: RepoLayout = {
  prompts: 'prompts',
  contracts: 'instructions',
  skills: 'skills',
  mcp: 'mcp',
}

const DEFAULT_POLICIES: RepoPolicies = {
  skills: true,
  mcp: true,
  prompts: true,
  contracts: true,
}

const INTERVALS = [5, 15, 30, 60]

function normalizeRoot(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function layoutError(layout: RepoLayout): string | null {
  for (const key of POLICY_KEYS) {
    const value = normalizeRoot(layout[key])
    if (!value) return `${POLICY_META[key].label} directory is required.`
    if (value.split('/').includes('..') || /^[A-Za-z]:/.test(value)) {
      return 'Directory roots must be relative repository paths without "..".'
    }
  }
  return null
}

function hasEmbeddedCredentials(url: string): boolean {
  const scheme = /^([a-z+]+):\/\//i.exec(url)
  // An SSH URL legitimately carries the `git` user, but HTTP(S) or generic
  // URLs must not embed a username, token, or password.
  if (!scheme || scheme[1].toLowerCase() === 'ssh') return false
  return /^[a-z+]+:\/\/[^/@\s]+@/i.test(url)
}

function PolicySwitch({
  policyKey,
  checked,
  onChange,
}: {
  policyKey: PolicyKey
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const meta = POLICY_META[policyKey]
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon name={KIND_META[meta.kind].icon} className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{meta.label}</span>
          <Badge variant={checked ? 'primary' : 'outline'}>{checked ? 'Sync on' : 'Local only'}</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{meta.description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={`Sync ${meta.label}`} />
    </div>
  )
}

function ErrorPanel({ message, details }: { message: string; details: string[] }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
      <div className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{message}</p>
          {details.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
              {details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function RepoConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [step, setStep] = useState(1)
  const [url, setUrl] = useState('')
  const [provider, setProvider] = useState<'auto' | RepoProvider>('auto')
  const [branch, setBranch] = useState('main')
  const [cloneMode, setCloneMode] = useState<'managed' | 'bound'>('bound')
  const [localPath, setLocalPath] = useState('')
  const [authMode, setAuthMode] = useState<'credential' | 'ssh' | 'token'>('credential')
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [token, setToken] = useState('')
  const [policies, setPolicies] = useState<RepoPolicies>(DEFAULT_POLICIES)
  const [layout, setLayout] = useState<RepoLayout>(DEFAULT_LAYOUT)
  const [autoFetch, setAutoFetch] = useState(true)
  const [interval, setInterval] = useState(15)
  const [preview, setPreview] = useState<RepoConnectPreview | null>(null)
  const [scriptAck, setScriptAck] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setStep(1)
    setUrl('')
    setProvider('auto')
    setBranch('main')
    setCloneMode('bound')
    setLocalPath('')
    setAuthMode('credential')
    setSshKeyPath('')
    setToken('')
    setPolicies(DEFAULT_POLICIES)
    setLayout(DEFAULT_LAYOUT)
    setAutoFetch(true)
    setInterval(15)
    setPreview(null)
    setScriptAck(false)
    setError(null)
    setDetails([])
  }, [open])

  const prepare = useMutation({
    mutationFn: (input: RepoConnectInput) => ipc.sync.repoConnect(input),
  })
  const apply = useMutation({
    mutationFn: (input: RepoConnectInput) => ipc.sync.repoConnect(input),
  })

  function buildAuth(): RepoAuthInput {
    if (authMode === 'credential') return { mode: 'credential' }
    if (authMode === 'ssh') {
      return { mode: 'ssh', ...(sshKeyPath.trim() ? { keyPath: sshKeyPath.trim() } : {}) }
    }
    return { mode: 'token', ...(token.trim() ? { token: token.trim() } : {}) }
  }

  function buildInput(confirm: boolean): RepoConnectInput {
    const local = cloneMode === 'bound'
    return {
      cloneMode,
      ...(local
        ? { localPath: localPath.trim() }
        : {
            url: url.trim(),
            ...(provider === 'auto' ? {} : { provider }),
            branch: branch.trim() || 'main',
            auth: buildAuth(),
          }),
      policies,
      layout,
      autoFetch,
      fetchIntervalMin: interval,
      confirm,
      ...(confirm && preview
        ? {
            previewToken: preview.previewToken,
            ...(preview.scripts.length > 0 ? { acknowledgeScripts: scriptAck } : {}),
          }
        : {}),
    }
  }

  function validateStep(stepToCheck: number): boolean {
    setError(null)
    setDetails([])
    if (stepToCheck === 1) {
      if (cloneMode === 'bound') {
        if (!localPath.trim()) {
          setError('A local repository path is required.')
          return false
        }
      } else {
        if (!url.trim()) {
          setError('Repository URL is required.')
          return false
        }
        if (hasEmbeddedCredentials(url.trim())) {
          setError('The repository URL must not contain credentials. Use the authentication field instead.')
          return false
        }
        if (!branch.trim()) {
          setError('Branch is required.')
          return false
        }
        if (authMode === 'token' && !token.trim()) {
          setError('An access token is required for token authentication.')
          return false
        }
      }
    }
    if (stepToCheck === 2) {
      const problem = layoutError(layout)
      if (problem) {
        setError(problem)
        return false
      }
    }
    return true
  }

  async function loadPreview(): Promise<void> {
    if (!validateStep(1) || !validateStep(2)) return
    setError(null)
    setDetails([])
    try {
      const result = await prepare.mutateAsync(buildInput(false))
      if (result.phase === 'preview') {
        setPreview(result)
        setScriptAck(false)
        setStep(4)
      } else {
        setError('The repository was connected before a preview could be reviewed. Refresh the Sync Center.')
      }
    } catch (caught) {
      setPreview(null)
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  function next(): void {
    if (step === 1 && !validateStep(1)) return
    if (step === 2 && !validateStep(2)) return
    if (step === 3) {
      void loadPreview()
      return
    }
    setStep((current) => Math.min(3, current + 1))
  }

  async function connect(): Promise<void> {
    if (!preview) return
    setError(null)
    setDetails([])
    try {
      const result = await apply.mutateAsync(buildInput(true))
      if (result.phase === 'applied') {
        await queryClient.invalidateQueries()
        toast.success('Repository connected. Fetched differences will land in Changes for review.')
        onClose()
        return
      }
      setError('The connection did not reach the applied phase. Review the preview and try again.')
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  const needsScriptAck = !!preview && preview.scripts.length > 0
  const busy = prepare.isPending || apply.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title="Connect Git repository"
      subtitle={`Step ${step} of 4 · ${STEPS[step - 1]}`}
      footer={
        <>
          {error && step < 4 && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={step === 1 ? onClose : () => setStep((current) => Math.max(1, current - 1))} disabled={busy}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 && (
            <Button onClick={next} disabled={busy}>
              Next
              <Icon name="chevronRight" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={next} disabled={busy}>
              {prepare.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="eye" />}
              {prepare.isPending ? 'Preparing preview…' : 'Preview connection'}
            </Button>
          )}
          {step === 4 && (
            <Button
              onClick={() => void connect()}
              disabled={
                !preview ||
                busy ||
                preview.duplicateIds.length > 0 ||
                (needsScriptAck && !scriptAck)
              }
            >
              {apply.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="gitBranch" />}
              {apply.isPending ? 'Connecting…' : 'Connect repository'}
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-4 flex items-center gap-1">
        {STEPS.map((label, index) => {
          const number = index + 1
          return (
            <li key={label} className="flex flex-1 items-center gap-1">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  number <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {number < step ? <Icon name="check" className="h-3 w-3" /> : number}
              </span>
              <span
                className={cn(
                  'text-[11px]',
                  number === step ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {index < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-border" aria-hidden />}
            </li>
          )
        })}
      </ol>

      {error && step < 4 && (
        <div className="mb-4">
          <ErrorPanel message={error} details={details} />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs leading-5 text-info">
            <Icon name="gitBranch" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The repository shares Skills, MCP templates, and optionally Prompts and Agent Instructions.
              Remote changes always land in Changes first and never overwrite your local edits automatically.
            </span>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Repository source</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: 'bound',
                    title: 'Use a local repository (recommended)',
                    description:
                      'Point at a Git worktree you already cloned. Prompt Keeper reads its origin and checked-out branch and reuses your Git configuration, so no token is needed.',
                  },
                  {
                    value: 'managed',
                    title: 'Clone from a remote',
                    description:
                      'Clones into the Prompt Keeper data directory. Choose the repository URL and authentication method.',
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCloneMode(option.value)}
                  aria-pressed={cloneMode === option.value}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                    cloneMode === option.value
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <div className="text-sm font-medium">{option.title}</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          {cloneMode === 'bound' ? (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-local-path">
                  Local repository path *
                </label>
                <Input
                  id="repo-local-path"
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  className="font-mono text-xs"
                  placeholder="/Users/you/code/ai-assets"
                />
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Must be the root of an existing Git worktree with an "origin" remote. The app never deletes it.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Icon name="shield" className="h-3.5 w-3.5 text-primary" />
                  No token required
                </div>
                <p className="mt-1">
                  Prompt Keeper runs the system Git command with your existing credential helper or SSH agent. It reads
                  the origin URL and checked-out branch from the repository and never asks for or stores an access
                  token.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-url">
                  Repository URL *
                </label>
                <Input
                  id="repo-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
                />
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  HTTPS or SSH. Never put a token or password in the URL.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-provider">
                    Provider
                  </label>
                  <Select
                    id="repo-provider"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as 'auto' | RepoProvider)}
                  >
                    <option value="auto">Detect automatically</option>
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                    <option value="generic">Generic Git</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-branch">
                    Branch
                  </label>
                  <Input
                    id="repo-branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="main"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-auth">
                    Authentication
                  </label>
                  <Select
                    id="repo-auth"
                    value={authMode}
                    onChange={(event) => setAuthMode(event.target.value as 'credential' | 'ssh' | 'token')}
                  >
                    <option value="credential">System Git configuration</option>
                    <option value="ssh">SSH key</option>
                    <option value="token">Access token</option>
                  </Select>
                </div>
              </div>

              {authMode === 'ssh' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-ssh-key">
                    SSH key path (optional)
                  </label>
                  <Input
                    id="repo-ssh-key"
                    value={sshKeyPath}
                    onChange={(event) => setSshKeyPath(event.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Leave blank to use the SSH agent or the default key.
                  </p>
                </div>
              )}

              {authMode === 'token' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="repo-token">
                    Access token *
                  </label>
                  <Input
                    id="repo-token"
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Write-only; stored with OS safe storage"
                  />
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    The token is write-only. It is never displayed again and never written to the repository or logs.
                  </p>
                </div>
              )}

              <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                Prompt Keeper chooses the clone path inside its data directory and keeps it in sync with the app.
              </p>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs leading-5 text-info">
            <Icon name="folder" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Folders map directly to repository directories. Nested subfolders are allowed; the last level keeps the
              single-file or single-skill-directory convention. Unmatched files are reported during preflight and are
              never silently dropped or rewritten.
            </span>
          </div>

          <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3 font-mono text-[11px] leading-5">
{`prompts/engineering/code-quality/review.prompt.md
instructions/team/frontend/frontend.contract.md
skills/dev-workflow/git/commit-helper/SKILL.md
mcp/development/github/github.json`}
          </pre>

          {(POLICY_KEYS.map((key) => ({ key, value: layout[key] })) as Array<{
            key: PolicyKey
            value: string
          }>).map(({ key, value }) => (
            <div key={key}>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor={`repo-layout-${key}`}
              >
                {POLICY_META[key].label} directory
              </label>
              <Input
                id={`repo-layout-${key}`}
                value={value}
                onChange={(event) =>
                  setLayout((current) => ({ ...current, [key]: event.target.value }))
                }
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {key === 'skills' &&
                  'One folder per Skill containing SKILL.md and optional scripts.'}
                {key === 'mcp' &&
                  'One <name>.json per server. Credentials must use ${VAR} placeholders only.'}
                {key === 'prompts' &&
                  'One .prompt.md per Prompt. Frontmatter holds metadata and variables; the body splits into System and User sections.'}
                {key === 'contracts' &&
                  'One .contract.md per instruction. Frontmatter holds folder, scope, activation, and targets; the body is the instruction content.'}
              </p>
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Scheduled fetch</div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Read-only. It reports remote differences and never merges or rewrites local assets.
              </p>
            </div>
            <Select
              aria-label="Fetch interval"
              className="w-32"
              value={String(interval)}
              onChange={(event) => setInterval(Number(event.target.value))}
              disabled={!autoFetch}
            >
              {INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 60 ? 'Hourly' : `Every ${minutes} min`}
                </option>
              ))}
            </Select>
            <Switch checked={autoFetch} onChange={setAutoFetch} label="Scheduled fetch" />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Asset policies</div>
            {POLICY_KEYS.map((key) => (
              <PolicySwitch
                key={key}
                policyKey={key}
                checked={policies[key]}
                onChange={(value) => setPolicies((current) => ({ ...current, [key]: value }))}
              />
            ))}
            <p className="text-[11px] leading-5 text-muted-foreground">
              Individual Prompts and instructions can still choose local-only. Turning a policy off later may withdraw
              pending changes.
            </p>
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon name="lock" className="h-3.5 w-3.5" />
              Credential policy
            </div>
            <p className="mt-1 leading-5">
              MCP config accepts credentials only as ${'{'}VAR{'}'} placeholders; Prompts and instructions use{' '}
              {'{{variable}}'}. Every push scans MCP env and headers plus Prompt and instruction bodies and blocks
              plaintext findings. Real values stay in the local keychain or are entered temporarily when you use a
              Prompt.
            </p>
          </div>

          {error && <ErrorPanel message={error} details={details} />}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {prepare.isPending && (
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-6 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" />
              Reading the repository and building the preflight. Nothing has been written.
            </div>
          )}

          {!prepare.isPending && !preview && (
            <ErrorPanel
              message={error ?? 'The preview could not be loaded.'}
              details={details}
            />
          )}

          {preview && (
            <>
              <div className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Icon name="gitBranch" className="text-primary" />
                  <span className="text-sm font-medium">{preview.repo.url}</span>
                  <Badge variant="outline">
                    <Icon name="gitBranch" className="h-3 w-3" />
                    {preview.repo.branch}
                  </Badge>
                  <Badge variant="secondary">{REPO_PROVIDER_LABEL[preview.repo.provider]}</Badge>
                  <Badge variant="outline">{CLONE_MODE_LABEL[preview.repo.cloneMode]}</Badge>
                </div>
                <div className="grid gap-2 px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <div className="break-all font-mono">{preview.repo.localPath}</div>
                  <div className="font-mono">
                    HEAD {preview.repo.headCommit ? preview.repo.headCommit.slice(0, 12) : 'unknown'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {POLICY_KEYS.map((key) => {
                  const meta = POLICY_META[key]
                  return (
                    <div key={key} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Icon name={KIND_META[meta.kind].icon} className="h-3 w-3" />
                        {meta.label}
                      </div>
                      <div className="tabular mt-0.5 text-lg font-semibold">{preview.counts[meta.kind]}</div>
                    </div>
                  )
                })}
              </div>

              {preview.malformed.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
                  <div className="font-medium">{preview.malformed.length} malformed file(s) reported</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                    {preview.malformed.map((entry) => (
                      <li key={entry.path}>
                        <span className="font-mono">{entry.path}</span> — {entry.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 leading-5">Malformed files are reported, never rewritten.</p>
                </div>
              )}

              {preview.duplicateIds.length > 0 && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
                  <div className="font-medium">{preview.duplicateIds.length} duplicate asset ID(s)</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                    {preview.duplicateIds.map((entry) => (
                      <li key={entry.id}>
                        <span className="font-mono">{entry.id}</span> — {entry.paths.join(', ')}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 leading-5">Duplicate IDs are blocking. Fix them in the repository and refresh the preview.</p>
                </div>
              )}

              {preview.scripts.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Icon name="terminal" className="h-3.5 w-3.5" />
                    {preview.scripts.length} script file(s) detected
                  </div>
                  <ul className="mt-1 max-h-32 overflow-y-auto pl-4 font-mono text-[11px] leading-5">
                    {preview.scripts.map((script) => (
                      <li key={script.path}>
                        {script.path} · {script.kind}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <Checkbox
                      checked={scriptAck}
                      onChange={setScriptAck}
                      label={
                        <span className="text-[11px] leading-5">
                          I have verified the repository source and understand that scripts and MCP commands may run on
                          this machine.
                        </span>
                      }
                    />
                  </div>
                </div>
              )}

              {preview.credentialFindings.length > 0 && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Icon name="lock" className="h-3.5 w-3.5" />
                    {preview.credentialFindings.length} credential finding(s)
                  </div>
                  <ul className="mt-1 space-y-1 leading-5">
                    {preview.credentialFindings.map((finding, index) => (
                      <li key={`${finding.ruleId}-${index}`}>
                        <span className="font-mono">
                          {finding.path ?? 'content'}
                          {finding.line ? `:${finding.line}` : ''}
                        </span>{' '}
                        — {finding.preview}. Replace with {finding.replacement}.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
                  <div className="font-medium">Warnings</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                Connecting writes repository metadata and the base manifest only. Nothing is written to any Agent
                directory, and remote assets stay in Changes until you review them. Your layout roots are{' '}
                {POLICY_KEYS.map((key) => `${POLICY_META[key].label}: ${preview.layout[key]}`).join(' · ')}.
              </div>

              {error && <ErrorPanel message={error} details={details} />}

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => void loadPreview()} disabled={busy}>
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  Refresh preview
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

export function RepoEditModal({
  open,
  onClose,
  repo,
}: {
  open: boolean
  onClose: () => void
  repo: RepoStatus
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [policies, setPolicies] = useState<RepoPolicies>(repo.policies)
  const [layout, setLayout] = useState<RepoLayout>(repo.layout)
  const [autoFetch, setAutoFetch] = useState(repo.autoFetch)
  const [interval, setInterval] = useState(repo.fetchIntervalMin)
  const [pushMode, setPushMode] = useState<'direct' | 'branch'>(repo.pushMode)
  const [authMode, setAuthMode] = useState<'credential' | 'ssh' | 'token'>(repo.auth.mode)
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [withdrawal, setWithdrawal] = useState<{
    keys: PolicyKey[]
    total: number
    counts: Partial<Record<PolicyKey, number>>
    message?: string
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setPolicies(repo.policies)
    setLayout(repo.layout)
    setAutoFetch(repo.autoFetch)
    setInterval(repo.fetchIntervalMin)
    setPushMode(repo.pushMode)
    setAuthMode(repo.auth.mode)
    setSshKeyPath('')
    setToken('')
    setClearToken(false)
    setError(null)
    setDetails([])
    setWithdrawal(null)
    // Reset only when the dialog opens; a background refetch must not discard edits.
  }, [open])

  const turnedOff = useMemo(
    () => POLICY_KEYS.filter((key) => repo.policies[key] && !policies[key]),
    [policies, repo.policies],
  )

  async function pendingCounts(
    keys: PolicyKey[],
  ): Promise<{ total: number; counts: Partial<Record<PolicyKey, number>> } | null> {
    try {
      const counts: Partial<Record<PolicyKey, number>> = {}
      let total = 0
      for (const key of keys) {
        const [openPage, reviewedPage] = await Promise.all([
          ipc.sync.changes({ kind: POLICY_META[key].kind, status: 'open', limit: 1 }),
          ipc.sync.changes({ kind: POLICY_META[key].kind, status: 'reviewed', limit: 1 }),
        ])
        counts[key] = openPage.total + reviewedPage.total
        total += openPage.total + reviewedPage.total
      }
      return { total, counts }
    } catch {
      return null
    }
  }

  function buildAuth(): RepoAuthInput {
    if (authMode === 'credential') return { mode: 'credential' }
    if (authMode === 'ssh') {
      return { mode: 'ssh', ...(sshKeyPath.trim() ? { keyPath: sshKeyPath.trim() } : {}) }
    }
    return {
      mode: 'token',
      ...(token.trim() ? { token: token.trim() } : {}),
      ...(clearToken && !token.trim() ? { clearToken: true } : {}),
    }
  }

  async function save(confirmWithdrawal: boolean): Promise<void> {
    setError(null)
    setDetails([])
    const problem = layoutError(layout)
    if (problem) {
      setError(problem)
      return
    }
    if (authMode === 'token' && !token.trim() && !repo.auth.hasToken && !clearToken) {
      setError('Enter an access token, or choose another authentication mode.')
      return
    }
    if (!confirmWithdrawal && turnedOff.length > 0) {
      const pending = await pendingCounts(turnedOff)
      if (pending && pending.total > 0) {
        setWithdrawal({ keys: turnedOff, total: pending.total, counts: pending.counts })
        return
      }
    }
    const input: RepoUpdateInput = {
      policies,
      layout: {
        prompts: normalizeRoot(layout.prompts),
        contracts: normalizeRoot(layout.contracts),
        skills: normalizeRoot(layout.skills),
        mcp: normalizeRoot(layout.mcp),
      },
      autoFetch,
      fetchIntervalMin: interval,
      pushMode,
      auth: buildAuth(),
      ...(confirmWithdrawal ? { confirmPolicyWithdrawal: true } : {}),
    }
    setSaving(true)
    try {
      const result = await ipc.sync.repoUpdate(input)
      queryClient.setQueryData(queryKeys.sync.repo, result)
      void queryClient.invalidateQueries({ queryKey: ['sync'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success(
        confirmWithdrawal
          ? 'Repository settings saved. Pending changes for the disabled policy were withdrawn.'
          : 'Repository settings saved.',
      )
      onClose()
    } catch (caught) {
      if (
        isIpcError(caught) &&
        caught.code === 'CONFLICT' &&
        !confirmWithdrawal &&
        turnedOff.length > 0
      ) {
        const pending = await pendingCounts(turnedOff)
        setError(caught.message)
        setWithdrawal({
          keys: turnedOff,
          total: pending?.total ?? 0,
          counts: pending?.counts ?? {},
          message: caught.message,
        })
      } else {
        setError(errorMessage(caught))
        setDetails(errorDetailLines(errorDetails(caught)))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-2xl"
        title="Repository settings"
        subtitle={`${repo.url} · ${repo.branch}`}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save(false)} disabled={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <ErrorPanel message={error} details={details} />}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Asset policies</div>
            {POLICY_KEYS.map((key) => (
              <PolicySwitch
                key={key}
                policyKey={key}
                checked={policies[key]}
                onChange={(value) => setPolicies((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Repository layout</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {POLICY_KEYS.map((key) => (
                <div key={key}>
                  <label
                    className="mb-1 block text-[11px] text-muted-foreground"
                    htmlFor={`edit-layout-${key}`}
                  >
                    {POLICY_META[key].label}
                  </label>
                  <Input
                    id={`edit-layout-${key}`}
                    value={layout[key]}
                    onChange={(event) =>
                      setLayout((current) => ({ ...current, [key]: event.target.value }))
                    }
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Changing layout roots recomputes pending changes. Existing base paths are invalidated.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Scheduled fetch</div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Read-only; reports differences without merging.
              </p>
            </div>
            <Select
              aria-label="Fetch interval"
              className="w-32"
              value={String(interval)}
              onChange={(event) => setInterval(Number(event.target.value))}
              disabled={!autoFetch}
            >
              {INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 60 ? 'Hourly' : `Every ${minutes} min`}
                </option>
              ))}
            </Select>
            <Switch checked={autoFetch} onChange={setAutoFetch} label="Scheduled fetch" />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Push method</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: 'branch',
                    title: 'Separate branch (recommended)',
                    description: 'Reviewable and revertible; the main branch is not modified directly.',
                  },
                  {
                    value: 'direct',
                    title: 'Current branch',
                    description: 'Creates commits directly on the checked-out branch.',
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPushMode(option.value)}
                  aria-pressed={pushMode === option.value}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                    pushMode === option.value
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <div className="text-sm font-medium">{option.title}</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Authentication</div>
            <Select
              aria-label="Authentication mode"
              value={authMode}
              onChange={(event) => setAuthMode(event.target.value as 'credential' | 'ssh' | 'token')}
            >
              <option value="credential">System Git configuration (no token)</option>
              <option value="ssh">SSH key</option>
              <option value="token">Access token</option>
            </Select>
            {authMode === 'credential' && (
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                Fetch and push reuse the credential helper or SSH agent already configured on this machine. A bound
                local repository needs no token.
              </p>
            )}
            {authMode === 'ssh' && (
              <div className="mt-2">
                <Input
                  aria-label="SSH key path"
                  value={sshKeyPath}
                  onChange={(event) => setSshKeyPath(event.target.value)}
                  placeholder="~/.ssh/id_ed25519 (optional)"
                  className="font-mono text-xs"
                />
              </div>
            )}
            {authMode === 'token' && (
              <div className="mt-2 space-y-2">
                <Input
                  aria-label="Access token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => {
                    setToken(event.target.value)
                    if (event.target.value) setClearToken(false)
                  }}
                  placeholder={
                    repo.auth.hasToken
                      ? 'A token is stored. Leave blank to keep it.'
                      : 'Enter an access token'
                  }
                />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Tokens are write-only and never displayed. {repo.auth.hasToken ? 'A token is currently stored.' : 'No token is stored.'}
                </p>
                {repo.auth.hasToken && (
                  <Checkbox
                    checked={clearToken}
                    onChange={(value) => {
                      setClearToken(value)
                      if (value) setToken('')
                    }}
                    label={<span className="text-xs">Clear the stored token when saving</span>}
                  />
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            Current authentication: {AUTH_MODE_LABEL[repo.auth.mode]}
            {repo.auth.mode === 'token'
              ? ` · ${repo.auth.hasToken ? 'token stored' : 'no token stored'}. The token value is never returned to the interface.`
              : '.'}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!withdrawal}
        onClose={() => setWithdrawal(null)}
        onConfirm={() => {
          setWithdrawal(null)
          void save(true)
        }}
        title={
          withdrawal
            ? `Turn off sync for ${policyLabelList(withdrawal.keys)}?`
            : 'Turn off repository sync?'
        }
        confirmText="Save and withdraw"
        message={
          withdrawal ? (
            <div className="space-y-2">
              {withdrawal.message && (
                <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
                  {withdrawal.message}
                </p>
              )}
              <p>
                Turning off this policy withdraws{' '}
                <span className="font-semibold text-foreground">
                  {withdrawal.total} pending change{withdrawal.total === 1 ? '' : 's'}
                </span>
                . Repository files are not deleted.
              </p>
              <ul className="list-disc pl-4">
                {withdrawal.keys.map((key) => (
                  <li key={key}>
                    {POLICY_META[key].label}: {withdrawal.counts[key] ?? 0} open
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
      />
    </>
  )
}
