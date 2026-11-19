import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { PromptCopyResult, PromptVariable } from '../../../shared/contracts'
import { Button, Input, Select, Spinner, Textarea } from '../ui/primitives'
import { Modal } from '../ui/modal'
import { Icon } from '../../lib/icons'
import { errorMessage, ipc } from '../../lib/ipc'
import { useToast } from '../ui/toast'

/** Type-aware variable inputs shared by the copy modal and the AI test drawer. */
export function VariableFields({
  variables,
  values,
  onChange,
  disabled,
}: {
  variables: PromptVariable[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  disabled?: boolean
}) {
  if (variables.length === 0) {
    return <p className="text-xs text-muted-foreground">This Prompt has no variables.</p>
  }
  return (
    <div className="space-y-3">
      {variables.map((variable) => (
        <div key={variable.name}>
          <label className="mb-1 flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground">
            <span>{variable.label || variable.name}</span>
            <code className="rounded bg-muted px-1 text-[10px]">{`{{${variable.name}}}`}</code>
            {variable.required && <span className="text-danger">*</span>}
            {variable.type !== 'text' && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                {variable.type}
              </span>
            )}
          </label>
          {variable.type === 'textarea' ? (
            <Textarea
              aria-label={variable.label || variable.name}
              rows={4}
              disabled={disabled}
              value={values[variable.name] ?? ''}
              placeholder={variable.example}
              onChange={(event) => onChange(variable.name, event.target.value)}
            />
          ) : variable.type === 'select' ? (
            <Select
              aria-label={variable.label || variable.name}
              disabled={disabled}
              value={values[variable.name] ?? ''}
              onChange={(event) => onChange(variable.name, event.target.value)}
            >
              <option value="">Select…</option>
              {(variable.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label={variable.label || variable.name}
              type={variable.type === 'number' ? 'number' : 'text'}
              disabled={disabled}
              value={values[variable.name] ?? ''}
              placeholder={variable.example}
              onChange={(event) => onChange(variable.name, event.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export interface LocalSubmitResult {
  unresolvedVariables?: string[]
}

/**
 * Copy dialog for a library Prompt. Rendering and the clipboard write happen in
 * the main process through `prompts.copyRender`; values stay in component memory
 * and are never persisted.
 *
 * When `promptId` is omitted (for example a curated catalog item that has not
 * been saved yet), `onSubmit` receives the values for a local render instead.
 */
export function VariableFormModal({
  open,
  title,
  variables,
  promptId,
  submitText = 'Copy to clipboard',
  onClose,
  onSubmit,
  onCopied,
}: {
  open: boolean
  title: string
  variables: PromptVariable[]
  promptId?: string
  submitText?: string
  onClose: () => void
  onSubmit?: (values: Record<string, string>) => LocalSubmitResult | void | Promise<LocalSubmitResult | void>
  onCopied?: (result: PromptCopyResult) => void
}) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [localPending, setLocalPending] = useState(false)

  const variablesKey = useMemo(() => variables.map((variable) => variable.name).join('|'), [variables])

  useEffect(() => {
    if (!open) return
    setValues({})
    setUnresolved([])
    setWarnings([])
    setLocalError(null)
  }, [open, promptId, variablesKey])

  const missingRequired = variables.filter(
    (variable) => variable.required && !(values[variable.name] ?? '').trim(),
  )

  const copyMutation = useMutation({
    mutationFn: (nextValues: Record<string, string>) => {
      if (!promptId) throw new Error('This Prompt must be saved before it can be copied.')
      return ipc.prompts.copyRender({ id: promptId, values: nextValues, writeClipboard: true })
    },
    onSuccess: (result) => {
      setUnresolved(result.unresolvedVariables)
      setWarnings(result.warnings)
      onCopied?.(result)
      if (result.wroteClipboard) {
        toast.success(`Copied to clipboard. Usage count is now ${result.usageCount}.`)
      } else {
        toast.warning('The Prompt was rendered, but the clipboard write was blocked.')
      }
      if (result.unresolvedVariables.length > 0) {
        toast.warning(
          `${result.unresolvedVariables.length} variable(s) were left visible in the copied text.`,
        )
      }
      if (result.unresolvedVariables.length === 0) onClose()
    },
    onError: (error) => {
      toast.error(`Copy failed: ${errorMessage(error)}`)
    },
  })

  const submit = async () => {
    if (missingRequired.length > 0) return
    setLocalError(null)
    if (promptId) {
      copyMutation.mutate(values)
      return
    }
    setLocalPending(true)
    try {
      const result = await onSubmit?.(values)
      const nextUnresolved = result?.unresolvedVariables ?? []
      setUnresolved(nextUnresolved)
      if (nextUnresolved.length > 0) {
        setWarnings([])
      } else {
        onClose()
      }
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setLocalPending(false)
    }
  }

  const pending = copyMutation.isPending || localPending
  const hasResult = unresolved.length > 0 || warnings.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Values are rendered into the body in memory and are never saved to the asset, version history, or repository"
      width="max-w-xl"
      footer={
        <>
          {(missingRequired.length > 0 || localError) && (
            <span className="mr-auto text-xs text-danger">
              {localError ?? `${missingRequired.length} required variable(s) missing`}
            </span>
          )}
          {missingRequired.length === 0 && !localError && hasResult && (
            <span className="mr-auto text-xs text-muted-foreground">
              Copied text still contains unresolved placeholders
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {hasResult ? 'Done' : 'Cancel'}
          </Button>
          <Button onClick={() => void submit()} disabled={pending || missingRequired.length > 0}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="copy" />}
            {submitText}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <VariableFields
          variables={variables}
          values={values}
          disabled={pending}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        />

        {unresolved.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              These variables were left as placeholders: {unresolved.map((name) => `{{${name}}}`).join(', ')}.
              Fill in a value and copy again if the final text must be complete.
            </span>
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5">
                <Icon name="info" className="mt-0.5 h-3 w-3 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] leading-5 text-muted-foreground">
          Required variables must be filled before copying. Values are kept only for this dialog; the
          Prompt itself stores definitions, never the entered values.
        </p>
      </div>
    </Modal>
  )
}
