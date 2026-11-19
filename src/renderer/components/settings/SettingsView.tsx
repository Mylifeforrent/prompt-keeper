import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AiProviderInfo,
  AiProviderSaveInput,
  DataLocationId,
  Density,
  DiagnosticExportResult,
  GlobalTargetDetail,
  RepoStatus,
  ResetPreview,
  RestorePreview,
  SettingsSnapshot,
  SettingsUpdateInput,
  ThemeMode,
  UpdateStatus,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Input, Select, Spinner, Switch } from '../ui/core'
import { ConfirmDialog, Modal } from '../ui/modal'
import { Icon, type IconName } from '../../lib/icons'
import { cn, formatDate, relativeTime } from '../../lib/utils'
import { useToast } from '../ui/toast'
import { errorDetails, errorMessage, ipc, isIpcError } from '../../lib/ipc'
import { queryKeys } from '../../lib/queryKeys'
import {
  AUTH_MODE_LABEL,
  CLONE_MODE_LABEL,
  PUSH_MODE_LABEL,
  errorDetailLines,
  formatBytes,
  formatInterval,
  isAbsolutePath,
  policySummary,
} from '../../lib/syncView'

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'repository', label: 'Repository' },
  { id: 'global-targets', label: 'Global targets' },
  { id: 'data', label: 'Data & backup' },
  { id: 'updates', label: 'Updates' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'ai-providers', label: 'AI providers' },
  { id: 'about', label: 'About' },
]

function applyEffectiveTheme(effective: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.toggle('dark', effective === 'dark')
  root.style.colorScheme = effective
}

function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
  aside,
}: {
  id: string
  icon: IconName
  title: string
  description: string
  children: ReactNode
  aside?: ReactNode
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
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold leading-5">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</p>
        </div>
        {aside}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function InlineError({ message, details }: { message: string; details: string[] }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
      <p className="font-medium">{message}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 leading-5">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SettingsView() {
  const toast = useToast()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => ipc.settings.get(),
  })
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => ipc.app.bootstrap(),
    staleTime: 15_000,
  })
  const repoQuery = useQuery({
    queryKey: queryKeys.sync.repo,
    queryFn: () => ipc.sync.repoGet(),
  })

  const update = useMutation({
    mutationFn: (input: SettingsUpdateInput) => ipc.settings.update(input),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(queryKeys.settings, snapshot)
      applyEffectiveTheme(snapshot.effectiveTheme)
      document.documentElement.dataset.density = snapshot.density
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
    },
    onError: (error) => toast.error(`Setting was not saved: ${errorMessage(error)}`),
  })

  const settings = settingsQuery.data
  const bootstrap = bootstrapQuery.data
  const repo = repoQuery.data !== undefined ? repoQuery.data : (bootstrap?.repo ?? null)

  useEffect(() => {
    if (settings) document.documentElement.dataset.density = settings.density
  }, [settings?.density])

  if (settingsQuery.isLoading && !settings) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Loading settings…
      </div>
    )
  }

  if (settingsQuery.isError && !settings) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <Icon name="alert" className="mx-auto h-5 w-5 text-danger" />
          <p className="mt-2 text-sm font-medium">Settings could not be loaded</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{errorMessage(settingsQuery.error)}</p>
          <Button className="mt-4" variant="outline" onClick={() => void settingsQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!settings) return null

  const saving = update.isPending

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 lg:px-8 xl:grid-cols-[160px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <nav aria-label="Settings sections" className="sticky top-0 space-y-0.5">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">
              Settings
            </div>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#settings-${section.id}`}
                className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <AppearanceSection settings={settings} saving={saving} onSave={(input) => update.mutate(input)} />
          <RepositorySection repo={repo} settings={settings} loading={repoQuery.isLoading} />
          <GlobalTargetsSection />
          <DataSection settings={settings} />
          <UpdatesSection
            settings={settings}
            bootstrapAvailable={bootstrap?.capabilities.updates ?? true}
            saving={saving}
            onSave={(input) => update.mutate(input)}
          />
          <PrivacySection
            settings={settings}
            safeStorage={bootstrap?.safeStorage}
            saving={saving}
            onSave={(input) => update.mutate(input)}
          />
          <AiProvidersSection settings={settings} />
          <AboutSection settings={settings} bootstrap={bootstrap} />
        </div>
      </div>
    </div>
  )
}

const THEMES: Array<{ value: ThemeMode; label: string; description: string; icon: IconName }> = [
  { value: 'light', label: 'Light', description: 'Always use the light theme.', icon: 'sun' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.', icon: 'moon' },
  { value: 'system', label: 'System', description: 'Follow the OS appearance automatically.', icon: 'refresh' },
]

const DENSITIES: Array<{ value: Density; label: string; description: string }> = [
  { value: 'comfortable', label: 'Comfortable', description: 'More breathing room for long reading sessions.' },
  { value: 'compact', label: 'Compact', description: 'Fits more rows on screen for large libraries.' },
]

function AppearanceSection({
  settings,
  saving,
  onSave,
}: {
  settings: SettingsSnapshot
  saving: boolean
  onSave: (input: SettingsUpdateInput) => void
}) {
  return (
    <SettingsSection
      id="appearance"
      icon="sun"
      title="Appearance"
      description="Theme and density save immediately and persist on this machine."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {THEMES.map((theme) => {
          const active = settings.theme === theme.value
          return (
            <button
              key={theme.value}
              type="button"
              onClick={() => onSave({ theme: theme.value })}
              disabled={saving}
              aria-pressed={active}
              className={cn(
                'relative cursor-pointer rounded-lg border p-3 text-left transition-all disabled:cursor-wait disabled:opacity-70',
                active
                  ? 'border-primary/55 bg-primary-soft/60 ring-1 ring-primary/15'
                  : 'border-border hover:border-border-strong hover:bg-muted/40',
              )}
            >
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                <Icon
                  name={theme.icon}
                  className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')}
                />
                {theme.label}
              </div>
              <div className="mt-1 text-[10.5px] leading-4 text-muted-foreground">{theme.description}</div>
              {active && (
                <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon name="check" className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Density</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {DENSITIES.map((density) => {
            const active = settings.density === density.value
            return (
              <button
                key={density.value}
                type="button"
                onClick={() => onSave({ density: density.value })}
                disabled={saving}
                aria-pressed={active}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-left transition-colors disabled:cursor-wait disabled:opacity-70',
                  active
                    ? 'border-primary/55 bg-primary-soft/60'
                    : 'border-border hover:border-border-strong hover:bg-muted/40',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon name="sliders" className="h-3.5 w-3.5" />
                  {density.label}
                  {active && <Badge variant="primary" className="ml-auto">Current</Badge>}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
                  {density.description}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-3 border-t border-border/60 pt-3 text-[10.5px] leading-5 text-muted-foreground">
        Effective theme: {settings.effectiveTheme}. Theme changes apply instantly and never require a restart.
      </p>
    </SettingsSection>
  )
}

function RepositorySection({
  repo,
  settings,
  loading,
}: {
  repo: RepoStatus | null
  settings: SettingsSnapshot
  loading: boolean
}) {
  return (
    <SettingsSection
      id="repository"
      icon="gitBranch"
      title="Repository"
      description="Repository connection, layout, policies, and credentials are managed in the Sync Center so both screens show the same authoritative state."
    >
      {loading && !repo ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Reading repository status…
        </div>
      ) : !repo ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium">No repository is connected</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            The local library works offline. To share assets, open <span className="font-medium">Sync Center → Overview</span>{' '}
            and run the connection wizard there. Repository changes are intentionally not editable from this page.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline">Local-first</Badge>
            <span>Policies: {policySummary(settings.repository.policies)}</span>
            <span>Fetch: {settings.repository.autoFetch ? formatInterval(settings.repository.fetchIntervalMin) : 'Manual only'}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Connected</Badge>
            <span className="break-all text-sm font-medium">{repo.url}</span>
            <Badge variant="outline">
              <Icon name="gitBranch" className="h-3 w-3" />
              {repo.branch}
            </Badge>
            <Badge variant={repo.security.blocked ? 'danger' : 'secondary'}>
              {repo.security.blocked ? 'Push blocked' : 'Security clear'}
            </Badge>
          </div>

          <dl className="divide-y divide-border/60">
            {(
              [
                { label: 'Local path', value: repo.localPath, mono: true },
                { label: 'Clone mode', value: CLONE_MODE_LABEL[repo.cloneMode] },
                {
                  label: 'Authentication',
                  value:
                    repo.auth.mode === 'token'
                      ? `Access token (${repo.auth.hasToken ? 'stored' : 'not set'})`
                      : AUTH_MODE_LABEL[repo.auth.mode],
                },
                { label: 'Policies', value: policySummary(repo.policies) },
                {
                  label: 'Auto-fetch',
                  value: repo.autoFetch ? formatInterval(repo.fetchIntervalMin) : 'Manual fetch only',
                },
                { label: 'Push mode', value: PUSH_MODE_LABEL[repo.pushMode] },
                { label: 'Ahead / behind', value: `${repo.ahead} ahead · ${repo.behind} behind` },
                { label: 'Last fetch', value: repo.lastFetchedAt ? formatDate(repo.lastFetchedAt) : 'Never' },
                { label: 'Last merge', value: repo.lastSyncedAt ? formatDate(repo.lastSyncedAt) : 'Never' },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <dt className="w-32 shrink-0 text-xs font-medium">{row.label}</dt>
                <dd
                  className={cn(
                    'min-w-0 flex-1 break-all text-xs text-muted-foreground',
                    'mono' in row && row.mono && 'font-mono',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="rounded-lg bg-muted/60 px-3 py-2 text-[10.5px] leading-5 text-muted-foreground">
            To change the URL, branch, layout roots, policies, auth mode, or push mode, use{' '}
            <span className="font-medium">Sync Center → Overview → Edit settings</span>. Turning a policy off may
            require confirming that pending changes will be withdrawn. Token values are never displayed anywhere.
          </p>
        </div>
      )}
    </SettingsSection>
  )
}

function GlobalTargetsSection() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const targets = useQuery({
    queryKey: queryKeys.projections.globalTargets,
    queryFn: () => ipc.globalTargets.list(),
  })

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projections.globalTargets })
    void queryClient.invalidateQueries({ queryKey: ['globalProjections'] })
    void queryClient.invalidateQueries({ queryKey: ['projections'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
  }

  const updatePath = useMutation({
    mutationFn: (input: { target: GlobalTargetDetail; path: string }) =>
      ipc.globalTargets.updatePath({
        targetId: input.target.id,
        path: input.path,
        expectedUpdatedAt: input.target.updatedAt,
      }),
    onSuccess: (result) => {
      invalidate()
      toast.success(
        `Global path saved. ${result.markedStale} projection${result.markedStale === 1 ? '' : 's'} marked stale${
          result.driftedNotChanged > 0
            ? `; ${result.driftedNotChanged} drifted projection${result.driftedNotChanged === 1 ? '' : 's'} left unchanged`
            : ''
        }.`,
      )
    },
    onError: (error) => toast.error(`Global path was not saved: ${errorMessage(error)}`),
  })

  const restoreDefault = useMutation({
    mutationFn: (targetId: string) => ipc.globalTargets.restoreDefault({ targetId }),
    onSuccess: (result) => {
      invalidate()
      toast.success(
        `Default path restored. ${result.markedStale} projection${result.markedStale === 1 ? '' : 's'} marked stale. No files were written.`,
      )
    },
    onError: (error) => toast.error(`Default path was not restored: ${errorMessage(error)}`),
  })

  return (
    <SettingsSection
      id="global-targets"
      icon="send"
      title="Global targets"
      description="Agent instruction targets at user-level paths. These paths are local to this machine and are written only when you explicitly project an instruction."
    >
      {targets.isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Loading global targets…
        </div>
      ) : targets.isError ? (
        <div className="space-y-2">
          <InlineError message={errorMessage(targets.error)} details={[]} />
          <Button size="sm" variant="outline" onClick={() => void targets.refetch()}>
            Retry
          </Button>
        </div>
      ) : (targets.data?.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          No global targets are registered. Target adapters are provided by the app.
        </p>
      ) : (
        <div className="space-y-2">
          {targets.data?.map((target) => (
            <GlobalTargetRow
              key={target.id}
              target={target}
              saving={updatePath.isPending || restoreDefault.isPending}
              onSave={(path) => updatePath.mutate({ target, path })}
              onRestore={() => restoreDefault.mutate(target.id)}
            />
          ))}
          <p className="text-[10.5px] leading-5 text-muted-foreground">
            Valid paths are absolute. Changing or restoring a path marks related projections stale but never writes to
            disk. Drifted projections are not overwritten.
          </p>
        </div>
      )}
    </SettingsSection>
  )
}

function GlobalTargetRow({
  target,
  saving,
  onSave,
  onRestore,
}: {
  target: GlobalTargetDetail
  saving: boolean
  onSave: (path: string) => void
  onRestore: () => void
}) {
  const [path, setPath] = useState(target.path)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPath(target.path)
    setError(null)
  }, [target.path])

  const trimmed = path.trim()
  const valid = trimmed.length > 0 && isAbsolutePath(trimmed)
  const changed = trimmed !== target.path

  function save(): void {
    if (!trimmed) {
      setError('A path is required.')
      return
    }
    if (!isAbsolutePath(trimmed)) {
      setError('Use an absolute path, for example /Users/you/.claude/CLAUDE.md.')
      return
    }
    setError(null)
    onSave(trimmed)
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{target.agentName}</span>
        <span className="text-[11px] text-muted-foreground">{target.label}</span>
        <Badge variant="outline">{target.pathMode === 'file' ? 'Single file' : 'Directory'}</Badge>
        <Badge variant={target.exists ? 'success' : 'outline'}>{target.exists ? 'Exists' : 'Missing'}</Badge>
        <Badge variant={target.detected ? 'info' : 'secondary'}>
          {target.detected ? 'Detected' : 'Not detected'}
        </Badge>
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
          <span>{target.projectionCount} projections</span>
          <span>· {target.staleCount} stale</span>
          <span>· {target.driftedCount} drifted</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          aria-label={`${target.agentName} global path`}
          value={path}
          onChange={(event) => {
            setPath(event.target.value)
            setError(null)
          }}
          className={cn(
            'min-w-0 flex-1 font-mono text-xs',
            path.length > 0 && !valid && 'border-danger',
          )}
        />
        <Button size="sm" variant="outline" onClick={save} disabled={!changed || saving}>
          <Icon name="check" className="h-3.5 w-3.5" />
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onRestore} disabled={saving}>
          <Icon name="undo" className="h-3.5 w-3.5" />
          Restore default
        </Button>
      </div>

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className="break-all">
          Default: <span className="font-mono">{target.defaultPath}</span>
        </span>
        <span>
          Supports:{' '}
          {[
            target.supports.globs ? 'globs' : null,
            target.supports.modelDecision ? 'model decision' : null,
            target.supports.manual ? 'manual' : null,
            target.supports.imports ? 'imports' : null,
          ]
            .filter(Boolean)
            .join(', ') || 'basic rules'}
        </span>
        {target.maxBytes !== undefined && <span>Max {formatBytes(target.maxBytes)}</span>}
      </div>
    </div>
  )
}

function DataSection({ settings }: { settings: SettingsSnapshot }) {
  const toast = useToast()
  const [includeLogs, setIncludeLogs] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<DiagnosticExportResult | null>(null)

  const reveal = useMutation({
    mutationFn: (location: DataLocationId) =>
      ipc.app.revealPath({ target: { kind: 'data-location', location } }),
    onError: (error) => toast.error(`Location could not be revealed: ${errorMessage(error)}`),
  })

  const backup = useMutation({
    mutationFn: () => ipc.settings.backup(includeLogs ? { includeLogs: true } : {}),
    onSuccess: () => toast.info('Backup started. The operation panel shows progress and the resulting path.'),
    onError: (error) => toast.error(`Backup did not start: ${errorMessage(error)}`),
  })

  const exportDiagnostics = useMutation({
    mutationFn: () => ipc.settings.diagnostics({}),
    onSuccess: (result) => {
      setDiagnostics(result)
      toast.success(`Diagnostics exported to ${result.path}`)
    },
    onError: (error) => toast.error(`Diagnostics were not exported: ${errorMessage(error)}`),
  })

  const storageKeys = ['database', 'blobs', 'library', 'backups'] as const
  const storageLabels: Record<(typeof storageKeys)[number], string> = {
    database: 'Database',
    blobs: 'Blob store',
    library: 'Asset library',
    backups: 'Backups',
  }

  return (
    <SettingsSection
      id="data"
      icon="history"
      title="Data & backup"
      description="Local data locations, storage usage, consistent backups, restore, reset, and a redacted diagnostics export."
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Storage usage</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {storageKeys.map((key) => (
              <div key={key} className="rounded-lg border border-border px-3 py-2">
                <div className="text-[10.5px] text-muted-foreground">{storageLabels[key]}</div>
                <div className="tabular mt-0.5 text-sm font-semibold">
                  {formatBytes(settings.data.storageBytes[key])}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Locations</div>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {settings.data.locations.map((location) => (
              <div key={location.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-24 shrink-0 text-xs font-medium">{location.label}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
                  {location.path}
                </code>
                <Badge variant={location.exists ? 'success' : 'outline'}>
                  {location.exists ? 'Exists' : 'Missing'}
                </Badge>
                {location.sizeBytes !== undefined && (
                  <span className="text-[10.5px] text-muted-foreground">{formatBytes(location.sizeBytes)}</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => reveal.mutate(location.id)}
                  disabled={reveal.isPending || !location.exists}
                  title={location.exists ? 'Reveal in the OS file manager' : 'This location does not exist yet'}
                >
                  <Icon name="folder" className="h-3.5 w-3.5" />
                  Reveal
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Checkbox
            checked={includeLogs}
            onChange={setIncludeLogs}
            label={<span className="text-xs">Include logs in the backup</span>}
          />
          <Button size="sm" variant="outline" onClick={() => backup.mutate()} disabled={backup.isPending}>
            {backup.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
            Create backup
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}>
            <Icon name="history" className="h-3.5 w-3.5" />
            Restore from backup
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportDiagnostics.mutate()} disabled={exportDiagnostics.isPending}>
            {exportDiagnostics.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="file" className="h-3.5 w-3.5" />}
            Export diagnostics
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-danger"
            onClick={() => setResetOpen(true)}
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
            Reset local data
          </Button>
        </div>

        <p className="text-[10.5px] leading-5 text-muted-foreground">
          A backup is a consistent snapshot taken while the app runs. It includes encrypted secret ciphertext, but
          secrets are not portable: if the OS encryption key is unavailable on restore, affected MCP servers are marked
          degraded. Restore validates the backup and creates a safety backup first; a failed restore leaves current data
          intact. Reset is separate from restore.
        </p>

        {diagnostics && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon name="file" className="h-3.5 w-3.5 text-success" />
              Diagnostics exported
            </div>
            <p className="mt-1 break-all font-mono text-[10.5px] text-muted-foreground">{diagnostics.path}</p>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Sections: {diagnostics.sections.join(', ')}. The bundle is redacted and excludes secrets, asset bodies,
              and credential values.
            </p>
          </div>
        )}
      </div>

      <RestoreModal open={restoreOpen} onClose={() => setRestoreOpen(false)} />
      <ResetModal open={resetOpen} onClose={() => setResetOpen(false)} />
    </SettingsSection>
  )
}

function RestoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setPath('')
    setPreview(null)
    setError(null)
    setDetails([])
  }, [open])

  const startPreview = useMutation({
    mutationFn: (input: { pickFromDialog?: boolean; backupPath?: string }) =>
      ipc.settings.restore({ confirm: false, ...input }),
  })
  const apply = useMutation({
    mutationFn: (target: RestorePreview) =>
      ipc.settings.restore({
        backupPath: target.backupPath,
        confirm: true,
        previewToken: target.previewToken,
      }),
  })

  async function previewBackup(input: { pickFromDialog?: boolean; backupPath?: string }): Promise<void> {
    setError(null)
    setDetails([])
    setPreview(null)
    try {
      const result = await startPreview.mutateAsync(input)
      if (result.phase === 'preview') setPreview(result)
      else setError('The restore preview did not return. Try selecting the backup again.')
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  async function restore(): Promise<void> {
    if (!preview) return
    setError(null)
    setDetails([])
    try {
      const result = await apply.mutateAsync(preview)
      if (result.phase === 'preview') {
        setError('The restore did not reach the operation phase. Preview the backup again.')
        return
      }
      toast.info('Restore started. Current data stays intact until the safety backup and validation finish.')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title="Restore from backup"
      subtitle="Preview the backup manifest before replacing any data."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void restore()} disabled={!preview || apply.isPending}>
            {apply.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="history" />}
            {apply.isPending ? 'Restoring…' : 'Restore backup'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Restore replaces current data after validation. A safety backup is created first. Backups from a newer
            schema are rejected, and a failed restore leaves current data intact. A backup does not make secrets
            portable across machines or OS accounts.
          </span>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="restore-path">
            Backup folder (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="restore-path"
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
                setPreview(null)
                setError(null)
              }}
              placeholder="Select a backup folder or enter its path"
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={() => void previewBackup({ backupPath: path.trim() })}
              disabled={!path.trim() || startPreview.isPending}
            >
              Preview folder
            </Button>
            <Button
              variant="outline"
              onClick={() => void previewBackup({ pickFromDialog: true })}
              disabled={startPreview.isPending}
            >
              {startPreview.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="folder" />}
              Choose folder…
            </Button>
          </div>
        </div>

        {error && <InlineError message={error} details={details} />}

        {preview && (
          <div className="space-y-2">
            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="text-[10.5px] text-muted-foreground">Selected backup</div>
              <div className="mt-0.5 break-all font-mono text-[11px]">{preview.backupPath}</div>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { label: 'App version', value: preview.manifest.appVersion },
                  { label: 'Schema version', value: String(preview.manifest.schemaVersion) },
                  { label: 'Created', value: formatDate(preview.manifest.createdAt) },
                  { label: 'Blobs', value: String(preview.manifest.blobCount) },
                  { label: 'Total size', value: formatBytes(preview.manifest.totalBytes) },
                  {
                    label: 'Assets',
                    value: Object.entries(preview.manifest.counts)
                      .map(([kind, count]) => `${count} ${kind}`)
                      .join(' · '),
                  },
                ] as const
              ).map((row) => (
                <div key={row.label} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[10.5px] text-muted-foreground">{row.label}</div>
                  <div className="mt-0.5 break-words text-xs font-medium">{row.value}</div>
                </div>
              ))}
            </dl>
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
          </div>
        )}
      </div>
    </Modal>
  )
}

function ResetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [scope, setScope] = useState<'library' | 'all'>('library')
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setScope('library')
    setPreview(null)
    setConfirmationText('')
    setError(null)
    setDetails([])
  }, [open])

  const startPreview = useMutation({
    mutationFn: (targetScope: 'library' | 'all') => ipc.settings.reset({ scope: targetScope, confirm: false }),
  })
  const apply = useMutation({
    mutationFn: (target: ResetPreview) =>
      ipc.settings.reset({
        scope: target.scope,
        confirm: true,
        confirmationText,
        previewToken: target.previewToken,
      }),
  })

  async function previewReset(targetScope: 'library' | 'all'): Promise<void> {
    setScope(targetScope)
    setPreview(null)
    setConfirmationText('')
    setError(null)
    setDetails([])
    try {
      const result = await startPreview.mutateAsync(targetScope)
      if (result.phase === 'preview') setPreview(result)
      else setError('The reset preview did not return. Try again.')
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  async function reset(): Promise<void> {
    if (!preview) return
    setError(null)
    setDetails([])
    try {
      const result = await apply.mutateAsync(preview)
      if (result.phase === 'preview') {
        setError('The reset did not reach the operation phase. Preview the scope again.')
        return
      }
      toast.info('Reset started. Local data is removed after the confirmed preview; repository files and backups stay.')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setDetails(errorDetailLines(errorDetails(caught)))
    }
  }

  const matches = !!preview && confirmationText === preview.requiredConfirmationText

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title="Reset local data"
      subtitle="Destructive and not reversible. Preview exactly what is deleted and what is kept."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void reset()} disabled={!matches || apply.isPending}>
            {apply.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="trash" />}
            {apply.isPending ? 'Resetting…' : 'Reset data'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              {
                value: 'library' as const,
                title: 'Library only',
                description: 'Deletes local assets, revisions, blobs, deployments, projections, and search rows. Settings, the repository connection, clones, backups, and logs are kept.',
              },
              {
                value: 'all' as const,
                title: 'Everything',
                description: 'Also resets settings and disconnects the repository. User-provided clones, repository files, and existing backups are never deleted.',
              },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void previewReset(option.value)}
              aria-pressed={scope === option.value}
              className={cn(
                'min-w-0 flex-1 cursor-pointer rounded-lg border p-3 text-left transition-colors',
                scope === option.value
                  ? 'border-danger/50 bg-danger-soft'
                  : 'border-border hover:bg-muted/60',
              )}
            >
              <div className="text-sm font-medium">{option.title}</div>
              <div className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">{option.description}</div>
            </button>
          ))}
        </div>

        {error && <InlineError message={error} details={details} />}

        {preview && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
                <div className="text-[10.5px] font-medium uppercase tracking-wide text-danger">Will delete</div>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-danger">
                  <li>{preview.willDelete.assets} assets</li>
                  <li>{preview.willDelete.revisions} revisions</li>
                  <li>{preview.willDelete.blobs} blobs</li>
                  <li>{preview.willDelete.deployments} deployments</li>
                  <li>{preview.willDelete.projections} projections</li>
                  {preview.willDelete.settingsReset && <li>All settings</li>}
                  {preview.willDelete.repositoryDisconnected && <li>The repository connection</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Will keep</div>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-muted-foreground">
                  <li>Repository files</li>
                  <li>User-provided clone</li>
                  <li>{preview.willKeep.backups ? 'Existing backups' : 'No backups are kept'}</li>
                </ul>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="reset-confirm-text">
                Type <span className="font-mono text-foreground">{preview.requiredConfirmationText}</span> to confirm
              </label>
              <Input
                id="reset-confirm-text"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder={preview.requiredConfirmationText}
                className="font-mono text-xs"
              />
              <p className={cn('mt-1 text-[11px]', matches ? 'text-success' : 'text-muted-foreground')}>
                {matches
                  ? 'Confirmation text matches. Reset can now run.'
                  : 'The confirmation text must match exactly.'}
              </p>
            </div>
          </>
        )}

        {!preview && !error && (
          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            Select a scope to preview the exact deletion list. Nothing is deleted until the preview is confirmed with
            the required text.
          </p>
        )}
      </div>
    </Modal>
  )
}

function UpdatesSection({
  settings,
  bootstrapAvailable,
  saving,
  onSave,
}: {
  settings: SettingsSnapshot
  bootstrapAvailable: boolean
  saving: boolean
  onSave: (input: SettingsUpdateInput) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirmInstall, setConfirmInstall] = useState<string | null>(null)

  const updates = useQuery({
    queryKey: queryKeys.updates,
    queryFn: () => ipc.updates.status(),
    retry: false,
  })

  const unsupported =
    !bootstrapAvailable ||
    (!!updates.error && isIpcError(updates.error) && updates.error.code === 'UNSUPPORTED')
  const status: UpdateStatus | undefined = updates.data
  const currentVersion = status?.currentVersion ?? settings.app.version
  const available = status?.available

  const check = useMutation({
    mutationFn: () => ipc.updates.check(),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.updates, result)
      toast.info(
        result.available
          ? `Update ${result.available.version} is available.`
          : 'You are on the latest version for this channel.',
      )
    },
    onError: (error) => {
      if (isIpcError(error) && error.code === 'UNSUPPORTED') {
        toast.info('Update checks are not available in this build.')
      } else {
        toast.error(`Update check failed: ${errorMessage(error)}`)
      }
    },
  })

  const download = useMutation({
    mutationFn: () => ipc.updates.download({}),
    onSuccess: () => toast.info('Update download started. The operation panel shows progress.'),
    onError: (error) => toast.error(`Update download did not start: ${errorMessage(error)}`),
  })

  const install = useMutation({
    mutationFn: (version: string) => ipc.updates.install({ version, confirm: true }),
    onSuccess: () => toast.info('Update installation started. The app may restart.'),
    onError: (error) => toast.error(`Update installation did not start: ${errorMessage(error)}`),
  })

  const downloadState = status?.download
  const progress =
    downloadState?.state === 'downloading'
      ? Math.max(0, Math.min(100, Math.round(downloadState.progress <= 1 ? downloadState.progress * 100 : downloadState.progress)))
      : null

  return (
    <SettingsSection
      id="updates"
      icon="sparkles"
      title="Updates"
      description="Current version, channel, and update checks. Update failures never block local editing."
      aside={
        <Badge variant={unsupported ? 'outline' : 'secondary'}>
          {settings.updates.channel === 'beta' ? 'Beta channel' : 'Stable channel'}
        </Badge>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[10.5px] text-muted-foreground">Current version</div>
            <div className="mt-0.5 text-sm font-semibold">{currentVersion}</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[10.5px] text-muted-foreground">Last check</div>
            <div className="mt-0.5 text-xs font-medium">
              {status?.lastCheckedAt
                ? `${formatDate(status.lastCheckedAt)} (${relativeTime(status.lastCheckedAt)})`
                : settings.updates.lastCheckedAt
                  ? formatDate(settings.updates.lastCheckedAt)
                  : 'Never'}
            </div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[10.5px] text-muted-foreground">Channel</div>
            <Select
              aria-label="Update channel"
              className="mt-1 h-8 text-xs"
              value={settings.updates.channel}
              onChange={(event) =>
                onSave({ updates: { channel: event.target.value as 'stable' | 'beta' } })
              }
              disabled={saving}
            >
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Switch
            checked={settings.updates.autoCheck}
            onChange={(value) => onSave({ updates: { autoCheck: value } })}
            label="Automatically check for updates"
          />
          <span className="text-xs text-muted-foreground">Check for updates automatically</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => check.mutate()}
            disabled={unsupported || check.isPending}
          >
            {check.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
            Check now
          </Button>
        </div>

        {unsupported ? (
          <div className="rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-info">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon name="info" className="h-3.5 w-3.5" />
              Update checks are unavailable in this build
            </div>
            <p className="mt-1 leading-5">
              Development builds do not ship a signed update feed. Your current version and local data are unaffected.
              Release builds support stable and beta channels with signature verification before installation.
            </p>
          </div>
        ) : updates.isError && !status ? (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
            <p className="font-medium">Update status could not be read</p>
            <p className="mt-1 leading-5">{errorMessage(updates.error)}</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => void updates.refetch()}>
              Retry
            </Button>
          </div>
        ) : available ? (
          <div className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="sparkles" className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-medium">Version {available.version} is available</span>
              <Badge variant="outline">{available.channel}</Badge>
              <span className="text-[10.5px] text-muted-foreground">
                {formatBytes(available.sizeBytes)} · published {formatDate(available.publishedAt)}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
              {available.releaseNotes}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => download.mutate()}
                disabled={download.isPending || downloadState?.state === 'downloading'}
              >
                {download.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
                Download update
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmInstall(available.version)}
                disabled={downloadState?.state !== 'downloaded' || install.isPending}
              >
                <Icon name="play" className="h-3.5 w-3.5" />
                Install update
              </Button>
              {downloadState?.state !== 'downloaded' && (
                <span className="self-center text-[10.5px] text-muted-foreground">
                  Installation unlocks after the verified download completes.
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
            No update is available for this channel. Downloads verify the signature before installation.
          </p>
        )}

        {progress !== null && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span>Downloading update</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {downloadState?.state === 'failed' && downloadState.error && (
          <InlineError
            message={downloadState.error.message}
            details={errorDetailLines(downloadState.error.details)}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!confirmInstall}
        onClose={() => setConfirmInstall(null)}
        onConfirm={() => {
          if (confirmInstall) install.mutate(confirmInstall)
        }}
        title="Install update?"
        confirmText="Install"
        danger={false}
        message={
          confirmInstall
            ? `Prompt Keeper will install version ${confirmInstall} and may restart. Save any open edits first. A failed installation does not affect local data.`
            : null
        }
      />
    </SettingsSection>
  )
}

function PrivacySection({
  settings,
  safeStorage,
  saving,
  onSave,
}: {
  settings: SettingsSnapshot
  safeStorage: { available: boolean; reason?: string } | undefined
  saving: boolean
  onSave: (input: SettingsUpdateInput) => void
}) {
  return (
    <SettingsSection
      id="privacy"
      icon="shield"
      title="Privacy"
      description="Telemetry is off by default and strictly opt-in. Local-first behavior never depends on it."
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Anonymous usage telemetry</span>
              <Badge variant={settings.privacy.telemetry ? 'warning' : 'success'}>
                {settings.privacy.telemetry ? 'Opted in' : 'Off by default'}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Opting in sends coarse feature and crash counts to help prioritize fixes. It never sends asset content,
              titles, tags, folder paths, repository URLs, credentials, or AI provider details.
            </p>
          </div>
          <Switch
            checked={settings.privacy.telemetry}
            onChange={(value) => onSave({ privacy: { telemetry: value } })}
            disabled={saving}
            label="Anonymous usage telemetry"
          />
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
          <div className="font-medium text-foreground">What is never sent</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Prompt, instruction, Skill, or MCP content and titles.</li>
            <li>Folder paths, repository names, URLs, branches, and commit messages.</li>
            <li>Credential placeholders, API keys, tokens, or encrypted values.</li>
            <li>AI prompts or responses, or any request made without an explicit action.</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant={safeStorage?.available ? 'success' : 'warning'}>
            <Icon name="lock" className="h-3 w-3" />
            {safeStorage?.available ? 'OS safe storage available' : 'OS safe storage unavailable'}
          </Badge>
          <span>
            {safeStorage?.available
              ? 'Credentials and AI keys are encrypted with the OS keychain.'
              : (safeStorage?.reason ?? 'Secrets cannot be encrypted with the OS keychain on this machine.')}
          </span>
        </div>

        {settings.privacy.dataDisclosureAcceptedAt && (
          <p className="text-[10.5px] text-muted-foreground">
            AI data disclosure accepted {formatDate(settings.privacy.dataDisclosureAcceptedAt)}.
          </p>
        )}
      </div>
    </SettingsSection>
  )
}

function AiProvidersSection({ settings }: { settings: SettingsSnapshot }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const providers = settings.ai.providers

  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearTarget, setClearTarget] = useState<AiProviderInfo | null>(null)

  function resetForm(): void {
    setEditingId(null)
    setName('')
    setBaseUrl('')
    setModel('')
    setApiKey('')
    setIsDefault(false)
    setError(null)
  }

  function startEdit(provider: AiProviderInfo): void {
    setEditingId(provider.id)
    setName(provider.name)
    setBaseUrl(provider.baseUrl)
    setModel(provider.model)
    setApiKey('')
    setIsDefault(provider.isDefault)
    setError(null)
  }

  const save = useMutation({
    mutationFn: (input: AiProviderSaveInput) => ipc.ai.providerSave(input),
    onSuccess: (provider) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers })
      toast.success(`${provider.name} saved. The API key is never returned to the interface.`)
      resetForm()
    },
    onError: (caught) => {
      setError(errorMessage(caught))
      toast.error(`Provider was not saved: ${errorMessage(caught)}`)
    },
  })

  function submit(): void {
    setError(null)
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      setError('Name, base URL, and model are required.')
      return
    }
    if (!editingId && !apiKey.trim()) {
      setError('An API key is required when adding a provider.')
      return
    }
    let parsed: URL
    try {
      parsed = new URL(baseUrl.trim())
    } catch {
      setError('Enter a valid HTTP or HTTPS base URL.')
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setError('Enter a valid HTTP or HTTPS base URL.')
      return
    }
    save.mutate({
      ...(editingId ? { id: editingId } : {}),
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      isDefault: isDefault || (!editingId && providers.length === 0),
    })
  }

  function clearKey(provider: AiProviderInfo): void {
    save.mutate({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: null,
      confirmClearKey: true,
      isDefault: provider.isDefault,
    })
  }

  return (
    <SettingsSection
      id="ai-providers"
      icon="sparkles"
      title="AI providers"
      description="Bring your own key. Configure an OpenAI-compatible provider for Prompt tests; Prompt Keeper does not sell or proxy inference."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={settings.ai.configured ? 'success' : 'outline'}>
            {settings.ai.configured ? 'Provider configured' : 'No provider configured'}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            Keys are encrypted with OS safe storage and never returned to the renderer.
          </span>
        </div>

        {providers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted-foreground">
            No AI provider is configured. Add one below to run Prompt tests.
          </p>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div key={provider.id} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{provider.name}</span>
                  {provider.isDefault && <Badge variant="primary">Default</Badge>}
                  <Badge variant={provider.hasKey ? 'success' : 'warning'}>
                    <Icon name="lock" className="h-3 w-3" />
                    {provider.hasKey ? 'Key stored' : 'No key'}
                  </Badge>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(provider)}>
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {provider.hasKey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => setClearTarget(provider)}
                      >
                        <Icon name="trash" className="h-3.5 w-3.5" />
                        Clear key
                      </Button>
                    )}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="break-all font-mono">{provider.baseUrl}</span>
                  <span>Model {provider.model}</span>
                  {provider.keyUpdatedAt && <span>Key updated {formatDate(provider.keyUpdatedAt)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{editingId ? 'Edit provider' : 'Add provider'}</span>
            {editingId && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={resetForm}>
                Cancel edit
              </Button>
            )}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="ai-name">
                Name *
              </label>
              <Input id="ai-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="OpenAI" />
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="ai-model">
                Model *
              </label>
              <Input
                id="ai-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4.1-mini"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="ai-base-url">
                Base URL *
              </label>
              <Input
                id="ai-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="font-mono text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10.5px] text-muted-foreground" htmlFor="ai-key">
                API key {editingId ? '(write-only)' : '*'}
              </label>
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  editingId
                    ? 'Leave blank to keep the stored key'
                    : 'Stored with OS safe storage; never displayed again'
                }
              />
              <p className="mt-1 text-[10.5px] leading-5 text-muted-foreground">
                The key is write-only. It is never returned to the interface, logs, or exports.
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Checkbox
              checked={isDefault}
              onChange={setIsDefault}
              label={<span className="text-xs">Use as the default provider</span>}
            />
            <Button size="sm" className="ml-auto" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" className="h-3.5 w-3.5" />}
              {editingId ? 'Save provider' : 'Add provider'}
            </Button>
          </div>

          {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
        </div>

        <div className="rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-info">
          <div className="flex items-center gap-1.5 font-medium">
            <Icon name="info" className="h-3.5 w-3.5" />
            Data disclosure
          </div>
          <p className="mt-1 leading-5">
            When you run an AI test, the Prompt content and your values are sent directly to the provider you configure.
            Prompt Keeper does not proxy or retain inference. No request is made without an explicit test action.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!clearTarget}
        onClose={() => setClearTarget(null)}
        onConfirm={() => {
          if (clearTarget) clearKey(clearTarget)
        }}
        title={clearTarget ? `Clear the API key for ${clearTarget.name}?` : 'Clear API key?'}
        confirmText="Clear key"
        message={
          clearTarget
            ? `The stored key for ${clearTarget.name} will be deleted. AI tests for this provider will fail until a new key is saved. The provider name, base URL, and model are kept.`
            : null
        }
      />
    </SettingsSection>
  )
}

function AboutSection({
  settings,
  bootstrap,
}: {
  settings: SettingsSnapshot
  bootstrap: { appVersion: string; buildId: string; platform: 'darwin' | 'win32'; locale: string } | undefined
}) {
  const version = settings.app.version || bootstrap?.appVersion || 'Unknown'
  const buildId = settings.app.buildId || bootstrap?.buildId || 'Unknown'
  return (
    <SettingsSection
      id="about"
      icon="sparkles"
      title="About"
      description="Version, build, license, and offline behavior."
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { label: 'Version', value: version },
              { label: 'Build', value: buildId },
              { label: 'Schema version', value: String(settings.app.schemaVersion) },
              { label: 'IPC contract version', value: String(settings.app.contractVersion) },
              { label: 'Platform', value: bootstrap?.platform ?? 'Unknown' },
              { label: 'Locale', value: bootstrap?.locale ?? 'Unknown' },
            ] as const
          ).map((row) => (
            <div key={row.label} className="rounded-lg border border-border px-3 py-2">
              <div className="text-[10.5px] text-muted-foreground">{row.label}</div>
              <div className="mt-0.5 break-all font-mono text-xs font-medium">{row.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
          <div className="font-medium text-foreground">License</div>
          <p className="mt-0.5">
            Prompt Keeper is released under the MIT License. Third-party notices are bundled with the installer and
            available offline.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
          <div className="font-medium text-foreground">Offline statement</div>
          <p className="mt-0.5">
            The local library is fully functional without a network and has no Prompt Keeper account. Network access
            happens only for Git operations you start, update checks you enable, and AI requests you explicitly run
            against a provider you configured.
          </p>
        </div>

        <p className="text-[10.5px] leading-5 text-muted-foreground">
          Documentation: README.md and docs/interaction-design.md describe the interaction model and repository layout.
        </p>
      </div>
    </SettingsSection>
  )
}
