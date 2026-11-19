import type { PromptDetail as PromptDetailDto } from '../../../shared/contracts'
import { Badge, Button, EmptyState, Spinner } from '../../components/ui/primitives'
import { Icon } from '../../lib/icons'
import { copyToClipboard } from '../../lib/clipboard'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import { Markdown } from '../../components/shared/Markdown'
import { syncStateMeta } from '../../lib/viewModels/assetStatus'
import {
  promptFolderLabel,
  promptFolderPath,
  promptRepositoryPath,
  promptVariableToken,
} from '../../lib/viewModels/prompt'

const ACTION_BUTTON = 'h-8 px-2.5 text-xs'

export function PromptDetail({
  prompt,
  isLoading,
  error,
  onRetry,
  onBack,
  onEdit,
  onDuplicate,
  onCopy,
  onTest,
  onShowVersions,
  onSyncPolicy,
  onDelete,
  onToggleFavorite,
  onTogglePinned,
  favoritePending = false,
  pinnedPending = false,
  copying = false,
  duplicating = false,
}: {
  prompt: PromptDetailDto | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onBack?: () => void
  onEdit: () => void
  onDuplicate: () => void
  onCopy: () => void
  onTest: () => void
  onShowVersions: () => void
  onSyncPolicy: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onTogglePinned: () => void
  favoritePending?: boolean
  pinnedPending?: boolean
  copying?: boolean
  duplicating?: boolean
}) {
  const toast = useToast()

  const copyText = async (text: string, label: string) => {
    const ok = await copyToClipboard(text)
    if (ok) toast.success(`${label} copied to clipboard.`)
    else toast.error(`Could not copy the ${label.toLowerCase()}; check clipboard permissions.`)
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon="alert"
          title="This Prompt could not be loaded"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              <Icon name="refresh" />
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  if (isLoading && !prompt) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border bg-card/60 px-5 py-4">
          <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted/80" />
          <div className="mt-4 flex gap-2">
            <div className="h-7 w-20 animate-pulse rounded-lg bg-muted" />
            <div className="h-7 w-20 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
        </div>
      </div>
    )
  }

  if (!prompt) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon="message"
          title="Select a Prompt"
          description="Choose a Prompt from the list to read its body, copy it, or manage its sync policy."
        />
      </div>
    )
  }

  const sync = syncStateMeta(prompt.syncState)
  const hasVariables = prompt.variables.length > 0
  const folderPath = promptFolderPath(prompt.folder)
  const repositoryPath = promptRepositoryPath(prompt)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/30">
      <div className="shrink-0 border-b border-border bg-card/60 px-4 py-4 backdrop-blur-sm sm:px-5">
        <div className="flex items-start gap-2">
          {onBack && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 md:hidden"
              onClick={onBack}
              aria-label="Back to list"
              title="Back to list"
            >
              <Icon name="chevronLeft" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-[17px] font-semibold leading-6 tracking-tight">
                {prompt.title}
              </h2>
              {prompt.isPinned && <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {prompt.description || '(No description)'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={prompt.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={prompt.isFavorite}
              title={prompt.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              disabled={favoritePending}
              onClick={onToggleFavorite}
            >
              {favoritePending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Icon
                  name="star"
                  className={cn('h-4 w-4', prompt.isFavorite ? 'fill-warning/20 text-warning' : '')}
                />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={prompt.isPinned ? 'Unpin Prompt' : 'Pin Prompt'}
              aria-pressed={prompt.isPinned}
              title={prompt.isPinned ? 'Unpin' : 'Pin'}
              disabled={pinnedPending}
              onClick={onTogglePinned}
            >
              {pinnedPending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Icon name="pin" className={cn('h-4 w-4', prompt.isPinned ? 'text-primary' : '')} />
              )}
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border/80" />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete Prompt"
              title="Delete"
              onClick={onDelete}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-1 pl-2 pr-1 text-[11px] text-muted-foreground">
            <Icon name="folder" className="h-3 w-3" />
            <span className="max-w-[220px] truncate font-mono" title={folderPath}>
              {promptFolderLabel(prompt.folder)}
            </span>
            <button
              type="button"
              onClick={() => void copyText(folderPath, 'Folder path')}
              aria-label="Copy folder path"
              title={`Copy ${folderPath}`}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="copy" className="h-3 w-3" />
            </button>
          </span>
          {prompt.tags.map((tag) => (
            <Badge key={tag} variant="primary" className="font-normal">
              #{tag}
            </Badge>
          ))}
          <Badge variant="outline" className="tabular">
            v{prompt.currentVersion}
          </Badge>
          <Badge variant="outline" className="tabular">
            {prompt.usageCount} uses
          </Badge>
        </div>

        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-border bg-muted/25 px-2.5 py-2">
          <Badge variant={sync.tone} className="mt-0.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', sync.dot)} aria-hidden />
            {sync.label}
          </Badge>
          <p className="min-w-0 flex-1 text-[11px] leading-5 text-muted-foreground">
            {sync.description}
            {prompt.syncPolicy === 'local' ? ' Sync policy: local only.' : ''}
            {prompt.syncPolicy === 'inherit' ? ' Sync policy: follow repository policy.' : ''}
            {prompt.syncPolicy === 'sync' ? ' Sync policy: participate in sync.' : ''}
          </p>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Icon name="gitBranch" className="h-3 w-3 shrink-0" />
          <span className="shrink-0">Repository file</span>
          <code
            className="min-w-0 truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]"
            title={repositoryPath}
          >
            {repositoryPath}
          </code>
          <button
            type="button"
            onClick={() => void copyText(repositoryPath, 'Repository path')}
            aria-label="Copy repository path"
            title="Copy repository path"
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="copy" className="h-3 w-3" />
          </button>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={onCopy} disabled={copying} className={ACTION_BUTTON} title="Copy the rendered Prompt">
            {copying ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="copy" />}
            {hasVariables ? 'Copy with variables' : 'Copy Prompt'}
          </Button>
          <Button variant="outline" className={ACTION_BUTTON} onClick={onEdit}>
            <Icon name="pencil" />
            Edit
          </Button>
          <Button variant="outline" className={ACTION_BUTTON} onClick={onTest}>
            <Icon name="flask" />
            AI Test
          </Button>
          <Button variant="outline" className={ACTION_BUTTON} onClick={onDuplicate} disabled={duplicating}>
            {duplicating ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="layers" />}
            Duplicate
          </Button>
          <Button variant="outline" className={ACTION_BUTTON} onClick={onShowVersions}>
            <Icon name="history" />
            Versions
          </Button>
          <Button variant="outline" className={ACTION_BUTTON} onClick={onSyncPolicy}>
            <Icon name="gitBranch" />
            Sync policy
          </Button>
          <Button
            variant="ghost"
            className={cn(ACTION_BUTTON, 'ml-auto text-muted-foreground hover:bg-danger-soft hover:text-danger')}
            onClick={onDelete}
          >
            <Icon name="trash" />
            Delete
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
        {prompt.systemPrompt ? (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              System Prompt
              <span className="h-px flex-1 bg-border/70" />
            </h3>
            <Markdown
              text={prompt.systemPrompt}
              className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
            />
          </section>
        ) : (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              System Prompt
              <span className="h-px flex-1 bg-border/70" />
            </h3>
            <p className="rounded-lg border border-dashed border-border bg-card/50 px-3.5 py-3 text-xs text-muted-foreground">
              No System Prompt body.
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            User Prompt
            <span className="h-px flex-1 bg-border/70" />
          </h3>
          {prompt.userPrompt ? (
            <Markdown
              text={prompt.userPrompt}
              className="rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] shadow-sm"
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border bg-card/50 px-3.5 py-3 text-xs text-muted-foreground">
              No User Prompt body.
            </p>
          )}
        </section>

        {hasVariables && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Template variables ({prompt.variables.length})
              <span className="h-px flex-1 bg-border/70" />
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {prompt.variables.map((variable) => (
                <Badge
                  key={variable.name}
                  variant="info"
                  className="gap-1.5 px-2 py-1 font-mono text-[11px] font-normal"
                  title={[
                    variable.required ? 'Required' : 'Optional',
                    variable.example ? `Example: ${variable.example}` : null,
                    variable.options?.length ? `Options: ${variable.options.join(', ')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {promptVariableToken(variable)}
                  {variable.type !== 'text' && (
                    <span className="text-[9.5px] uppercase tracking-wide opacity-70">
                      {variable.type}
                    </span>
                  )}
                  {variable.required && <span className="text-danger">*</span>}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-muted-foreground">
              Copying opens a fill-in form. Values are used only for the copied text and are never
              saved to the asset, versions, or repository.
            </p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-[10.5px] text-muted-foreground">
          <span>Created {formatDate(prompt.createdAt)}</span>
          <span>Updated {formatDate(prompt.updatedAt)}</span>
          <span className="tabular">
            {prompt.versionCount} revision{prompt.versionCount === 1 ? '' : 's'}
          </span>
          <span className="ml-auto font-mono text-[10px]">{prompt.slug}</span>
        </div>
      </div>
    </div>
  )
}
