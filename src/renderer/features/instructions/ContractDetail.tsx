import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  ContractDetail as ContractDetailDto,
  ContractTarget,
  ProjectSummary,
} from '../../../shared/contracts'
import { Badge, Button, Checkbox, Select } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { Icon } from '../../lib/icons'
import { copyToClipboard } from '../../lib/clipboard'
import { formatDate, relativeTime } from '../../lib/format'
import { Markdown } from '../../components/shared/Markdown'
import { useToast } from '../../components/ui/toast'
import { errorMessage, ipc } from '../../lib/ipc'
import {
  ACTIVATION_META,
  CONTRACT_SCOPE_META,
  SYNC_POLICY_META,
  activationSummary,
  compatibilityFor,
  compatibilityMap,
  contractRepositoryPath,
  contractVersionLabel,
  folderLabel,
  projectTargetPath,
  targetSupportsActivation,
} from '../../lib/viewModels/contract'

export function ContractDetail({
  contract,
  targets,
  projects,
  onEdit,
  onDelete,
  onShowVersions,
  onSync,
  onPreview,
}: {
  contract: ContractDetailDto
  targets: ContractTarget[]
  projects: ProjectSummary[]
  onEdit: () => void
  onDelete: () => void
  onShowVersions: () => void
  onSync: () => void
  onPreview: () => void
}) {
  const toast = useToast()
  const [projectOpen, setProjectOpen] = useState(false)
  const scope = CONTRACT_SCOPE_META[contract.scope]
  const activation = ACTIVATION_META[contract.activation.mode]
  const sync = SYNC_POLICY_META[contract.syncPolicy]
  const repoPath = contractRepositoryPath(contract.folder, contract.slug)

  const compatibility = useMemo(
    () => compatibilityMap(contract.compatibility),
    [contract.compatibility],
  )

  const copy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text)
    if (ok) toast.success(label)
    else toast.error('Copy failed. Check the clipboard permission for this window.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/30">
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold leading-6 tracking-tight">{contract.title}</h2>
              <Badge variant="outline" className="tabular">
                {contractVersionLabel(contract.currentVersion)}
              </Badge>
              <Badge variant={contract.effectiveSync ? 'info' : 'outline'} className="font-normal">
                {sync.short}
                {contract.effectiveSync ? ' · active' : ''}
              </Badge>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {contract.description || '(No description)'}
            </p>
          </div>
          <div className="ml-auto shrink-0 text-right">
            <div className="tabular text-[10.5px] text-muted-foreground">
              Updated {formatDate(contract.updatedAt)}
            </div>
            <div className="tabular mt-0.5 text-[10.5px] text-muted-foreground">
              Created {relativeTime(contract.createdAt)}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">
            <Icon name="folder" className="h-3 w-3" />
            {folderLabel(contract.folder)}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {scope.label}
            {contract.scope === 'path' && contract.pathPrefix ? ` · ${contract.pathPrefix}/` : ''}
          </Badge>
          <Badge
            variant={contract.activation.mode === 'always' ? 'primary' : 'info'}
            className="font-normal"
          >
            <Icon name="file" className="h-3 w-3" />
            {activation.label}
          </Badge>
          <Badge variant="outline" className="tabular font-normal">
            Priority {contract.priority}
          </Badge>
          {contract.tags.map((tag) => (
            <Badge key={tag} variant="primary" className="font-normal">
              #{tag}
            </Badge>
          ))}
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={() => void copy(contract.body, 'Copied the contract body')}>
            <Icon name="copy" />
            Copy body
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Icon name="pencil" />
            Edit
          </Button>
          <Button variant="outline" onClick={onPreview}>
            <Icon name="eye" />
            Resolution preview
          </Button>
          <Button variant="outline" onClick={onShowVersions}>
            <Icon name="history" />
            Versions
          </Button>
          <Button variant="outline" onClick={onSync}>
            <Icon name="gitBranch" />
            Sync policy
          </Button>
          <Button variant="outline" onClick={() => setProjectOpen(true)}>
            <Icon name="send" />
            Project
          </Button>
          <Button
            variant="ghost"
            className="ml-auto text-danger hover:bg-danger-soft"
            onClick={onDelete}
          >
            <Icon name="trash" />
            Delete
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <InfoCard label="Scope" value={scope.description} />
          <InfoCard
            label="Activation"
            value={`${activation.description} ${activationSummary(contract.activation)}`}
          />
          <InfoCard
            label="Repository file"
            value={repoPath}
            mono
            hint="The canonical .contract.md file holds the metadata in frontmatter and the rule text in the body."
            action={
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2"
                onClick={() => void copy(repoPath, 'Copied the repository path')}
                aria-label="Copy repository path"
                title="Copy repository path"
              >
                <Icon name="copy" className="h-3.5 w-3.5" />
                Copy
              </Button>
            }
          />
          <InfoCard
            label="Claude @import"
            value={contract.imports.length ? contract.imports.map((item) => `@${item}`).join('\n') : 'Not configured'}
            mono
            hint="Only targets that declare import support write these paths; other targets render them as plain text."
          />
          <InfoCard
            label="Sync policy"
            value={`${sync.label} · ${contract.effectiveSync ? 'currently participating in sync' : 'currently local only'}`}
            hint={sync.description}
          />
          <InfoCard
            label="Targets"
            value={`${contract.targetIds.length} selected target${contract.targetIds.length === 1 ? '' : 's'}`}
            hint="Each target compiles and records projection status independently."
          />
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Target compatibility
              <span className="h-px w-8 bg-border/70" />
            </h3>
            <Badge variant="outline">{contract.targetIds.length} targets</Badge>
            <span className="text-[10.5px] text-muted-foreground">
              Unsupported activation is stated explicitly and never silently downgraded.
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-max border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Native path</th>
                  <th className="px-3 py-2 font-medium">Merge</th>
                  <th className="px-3 py-2 font-medium">Activation</th>
                  <th className="px-3 py-2 font-medium">@import</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {contract.targetIds.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No targets selected. Edit the contract to choose at least one target.
                    </td>
                  </tr>
                )}
                {contract.targetIds.map((targetId) => {
                  const target = targets.find((item) => item.id === targetId)
                  const entry =
                    compatibility.get(targetId) ??
                    (target ? compatibilityFor(contract.activation, contract.imports, target) : null)
                  return (
                    <tr
                      key={targetId}
                      className="border-b border-border/60 text-xs last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{target?.label ?? targetId}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {target?.agentName ?? 'Target is not in the registry'}
                        </div>
                      </td>
                      <td className="max-w-72 px-3 py-2">
                        <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                          {target ? projectTargetPath(target, contract.slug) : '—'}
                        </code>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">
                        {target ? (target.merge === 'single-file' ? 'Merged file' : 'Separate file') : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {target ? (
                          <Badge variant={targetSupportsActivation(target, contract.activation.mode) ? 'success' : 'warning'}>
                            {targetSupportsActivation(target, contract.activation.mode) ? 'Supported' : 'Skipped'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Unknown</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {target ? (
                          <Badge variant={target.supports.imports ? 'success' : 'outline'}>
                            {target.supports.imports ? 'Supported' : 'Not supported'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Unknown</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry ? (
                          <Badge
                            variant={entry.blocking ? 'warning' : entry.warnings.length ? 'info' : 'success'}
                            title={entry.warnings.join(' ')}
                          >
                            {entry.blocking
                              ? 'Projection disabled'
                              : entry.warnings.length
                                ? 'Compatible with notices'
                                : 'Compatible'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Not evaluated</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {contract.targetIds.some((targetId) => {
            const target = targets.find((item) => item.id === targetId)
            const entry =
              compatibility.get(targetId) ??
              (target ? compatibilityFor(contract.activation, contract.imports, target) : null)
            return !!entry && entry.warnings.length > 0
          }) && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
              {contract.targetIds.flatMap((targetId) => {
                const target = targets.find((item) => item.id === targetId)
                const entry =
                  compatibility.get(targetId) ??
                  (target ? compatibilityFor(contract.activation, contract.imports, target) : null)
                return (entry?.warnings ?? []).map((warning) => (
                  <div key={`${targetId}-${warning}`} className="flex items-start gap-2 text-xs leading-5 text-warning">
                    <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {warning}
                  </div>
                ))
              })}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Contract body
              <span className="h-px w-8 bg-border/70" />
            </h3>
            <Badge variant="outline">May enter context every session</Badge>
          </div>
          <Markdown
            text={contract.body}
            className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
          />
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-[10.5px] leading-5 text-muted-foreground">
          <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Projection is a one-way explicit write. Saving or restoring a contract marks affected projections
          stale but never writes to Agent directories. Deleting a contract leaves target files untouched and
          keeps projection records as orphans.
        </div>
      </div>

      {projectOpen && (
        <ProjectContractModal
          contract={contract}
          targets={targets}
          projects={projects}
          onClose={() => setProjectOpen(false)}
        />
      )}
    </div>
  )
}

function InfoCard({
  label,
  value,
  hint,
  mono = false,
  action,
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </div>
        {action}
      </div>
      <div
        className={
          mono
            ? 'mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground/90'
            : 'mt-1 whitespace-pre-line text-xs leading-5 text-foreground/90'
        }
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{hint}</div>}
    </div>
  )
}

function ProjectContractModal({
  contract,
  targets,
  projects,
  onClose,
}: {
  contract: ContractDetailDto
  targets: ContractTarget[]
  projects: ProjectSummary[]
  onClose: () => void
}) {
  const toast = useToast()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [targetIds, setTargetIds] = useState<string[]>(contract.targetIds)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (projects.length > 0 && !projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0].id)
    }
  }, [projectId, projects])

  const selectedTargets = targets.filter((target) => targetIds.includes(target.id))
  const incompatible = selectedTargets.filter(
    (target) => !targetSupportsActivation(target, contract.activation.mode),
  )

  const projectMutation = useMutation({
    mutationFn: () =>
      ipc.projections.project({
        contractIds: [contract.id],
        targetIds,
        projectId,
        confirm: true,
      }),
    onSuccess: () => {
      toast.info(
        `Projection started for "${contract.title}" to ${targetIds.length} target${targetIds.length === 1 ? '' : 's'}. The table refreshes when the operation completes.`,
      )
      onClose()
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const toggleTarget = (id: string) =>
    setTargetIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={`Project "${contract.title}"`}
      subtitle="Projection writes native instruction files under a registered project root; the local library and Git repository are unchanged."
      width="max-w-2xl"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-danger">{error}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null)
              if (!projectId) {
                setError('Register a project root before projecting.')
                return
              }
              if (targetIds.length === 0) {
                setError('Select at least one target.')
                return
              }
              projectMutation.mutate()
            }}
            disabled={projectMutation.isPending || projects.length === 0}
          >
            <Icon name="send" />
            {projectMutation.isPending ? 'Starting…' : 'Project'}
          </Button>
        </>
      }
    >
      {projects.length === 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
          Project roots are required for project-level projection. Register a project root in Project
          Projections first.
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Project root</label>
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.rootPath}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Targets</span>
              <span className="text-[11px] text-muted-foreground">
                {selectedTargets.length} selected · {incompatible.length} incompatible
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {targets.map((target) => {
                const checked = targetIds.includes(target.id)
                const supported = targetSupportsActivation(target, contract.activation.mode)
                return (
                  <div
                    key={target.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleTarget(target.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleTarget(target.id)
                      }
                    }}
                    className={
                      checked
                        ? 'flex cursor-pointer items-start gap-2 rounded-lg border border-primary bg-primary-soft p-2.5'
                        : 'flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 hover:bg-muted'
                    }
                  >
                    <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                      <Checkbox checked={checked} onChange={() => toggleTarget(target.id)} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{target.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {target.merge === 'single-file' ? 'Merged file' : 'Separate file'}
                      </span>
                      {!supported && (
                        <span className="mt-0.5 block text-[10px] text-warning">
                          Activation unsupported; skipped during projection
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {contract.scope === 'user' && (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              This contract is user-scoped and is intended for Global Dispatch. A project projection may be
              rejected by the backend.
            </div>
          )}

          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {incompatible.length > 0
              ? `${incompatible.map((target) => target.label).join(', ')} cannot represent the selected activation and will be skipped; no silent downgrade occurs.`
              : 'All selected targets can represent this activation. Existing drifted files are never overwritten in bulk.'}
          </div>
        </div>
      )}
    </Modal>
  )
}
