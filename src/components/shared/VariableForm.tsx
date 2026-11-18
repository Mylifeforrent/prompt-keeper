import { useEffect, useState } from 'react'
import type { PromptVariable } from '../../types'
import { Button, Input, Select, Textarea } from '../ui/core'
import { Modal } from '../ui/modal'

/** 按变量定义渲染表单字段（供复制弹窗与 AI 测试抽屉复用） */
export function VariableFields({
  vars,
  values,
  onChange,
}: {
  vars: PromptVariable[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}) {
  return (
    <div className="space-y-3">
      {vars.map((v) => (
        <div key={v.name}>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {v.label || v.name}
            <code className="rounded bg-muted px-1 text-[10px]">{`{{${v.name}}}`}</code>
            {v.required && <span className="text-danger">*</span>}
          </label>
          {v.type === 'textarea' ? (
            <Textarea
              aria-label={v.label || v.name}
              rows={4}
              value={values[v.name] ?? ''}
              placeholder={v.example}
              onChange={(e) => onChange(v.name, e.target.value)}
            />
          ) : v.type === 'select' ? (
            <Select aria-label={v.label || v.name} value={values[v.name] ?? ''} onChange={(e) => onChange(v.name, e.target.value)}>
              <option value="">请选择…</option>
              {(v.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label={v.label || v.name}
              type={v.type === 'number' ? 'number' : 'text'}
              value={values[v.name] ?? ''}
              placeholder={v.example}
              onChange={(e) => onChange(v.name, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

const CACHE_PREFIX = 'pk_vars_'
const CACHE_TTL = 30 * 24 * 3600 * 1000

/** 变量值 30 天记忆（对应 PromptHub 的 localStorage 记忆策略） */
export function loadVarCache(promptId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + promptId)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { at: number; values: Record<string, string> }
    if (Date.now() - parsed.at > CACHE_TTL) return {}
    return parsed.values
  } catch {
    return {}
  }
}

export function saveVarCache(promptId: string, values: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_PREFIX + promptId, JSON.stringify({ at: Date.now(), values }))
  } catch {
    /* 忽略 */
  }
}

/** 复制/测试前的变量填充弹窗 */
export function VariableFormModal({
  open,
  title,
  vars,
  promptId,
  submitText,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  vars: PromptVariable[]
  promptId: string
  submitText: string
  onSubmit: (values: Record<string, string>) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    const cached = loadVarCache(promptId)
    const init: Record<string, string> = {}
    for (const v of vars) init[v.name] = cached[v.name] ?? v.example ?? ''
    setValues(init)
  }, [open, promptId, vars])

  const missing = vars.filter((v) => v.required && !(values[v.name] ?? '').trim())

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="变量值将被填入正文；填过的值会在 30 天内自动记忆"
      footer={
        <>
          {missing.length > 0 && <span className="mr-auto text-xs text-danger">还有 {missing.length} 个必填变量未填写</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={missing.length > 0}
            onClick={() => {
              saveVarCache(promptId, values)
              onSubmit(values)
            }}
          >
            {submitText}
          </Button>
        </>
      }
    >
      <VariableFields
        vars={vars}
        values={values}
        onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      />
    </Modal>
  )
}
