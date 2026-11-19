import type { PromptVariable, PromptVariableType } from '../contracts'

const VARIABLE_RE = /\{\{([^{}]+?)\}\}/g

export function parseVariableNames(...texts: string[]): string[] {
  const names: string[] = []
  for (const text of texts) {
    const re = new RegExp(VARIABLE_RE.source, 'g')
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const name = match[1].split(':')[0].trim()
      if (name && !names.includes(name)) names.push(name)
    }
  }
  return names
}

export function mergeVariableDefs(texts: string[], stored: PromptVariable[]): PromptVariable[] {
  const byName = new Map(stored.map((variable) => [variable.name, variable]))
  return parseVariableNames(...texts).map((name, index) => {
    const found = byName.get(name)
    return found ? { ...found, name } : { name, type: 'text', required: index === 0 && false }
  })
}

const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function validateVariableDefinitions(variables: PromptVariable[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  variables.forEach((variable, index) => {
    if (!VARIABLE_NAME_RE.test(variable.name)) {
      errors.push(`Variable ${index + 1}: name must start with a letter or underscore and contain only letters, digits, and underscores.`)
    }
    if (seen.has(variable.name)) errors.push(`Variable "${variable.name}" is defined more than once.`)
    seen.add(variable.name)
    const valid: PromptVariableType[] = ['text', 'textarea', 'number', 'select']
    if (!valid.includes(variable.type)) errors.push(`Variable "${variable.name}" has an unsupported type.`)
    if (variable.type === 'select' && (!variable.options || variable.options.length === 0)) {
      errors.push(`Variable "${variable.name}" is a select field and needs at least one option.`)
    }
  })
  return errors
}

/**
 * Literal replacement of `{{name}}` and `{{name:example}}`. Empty values stay
 * visible and are reported as unresolved by the caller.
 */
export function renderTemplate(
  text: string,
  values: Record<string, string>,
): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const rendered = text.replace(new RegExp(VARIABLE_RE.source, 'g'), (whole, token: string) => {
    const name = token.split(':')[0].trim()
    const value = values[name]
    if (value === undefined || value === '') {
      if (!unresolved.includes(name)) unresolved.push(name)
      return whole
    }
    return value
  })
  return { text: rendered, unresolved }
}

export function variableExample(variable: PromptVariable): string {
  if (variable.example) return variable.example
  if (variable.label) return variable.label
  return variable.name
}
