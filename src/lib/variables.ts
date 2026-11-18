import type { PromptVariable } from '../types'

/** Parse {{name}} / {{name:example}} variable names from content (deduped, order preserved) */
export function parseVariableNames(...texts: string[]): string[] {
  const names: string[] = []
  for (const text of texts) {
    const re = /\{\{([^{}]+?)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const name = m[1].split(':')[0].trim()
      if (name && !names.includes(name)) names.push(name)
    }
  }
  return names
}

/** Merge variables found in content with stored variable definitions (type/options etc.) */
export function mergeVariableDefs(texts: string[], stored: PromptVariable[]): PromptVariable[] {
  const byName = new Map(stored.map((v) => [v.name, v]))
  return parseVariableNames(...texts).map(
    (name) =>
      byName.get(name) ?? {
        name,
        type: 'text' as const,
        example: '',
        required: true,
      },
  )
}

/** Render the template with literal replacement; missing variables are left as-is so they are easy to spot */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([^{}]+?)\}\}/g, (whole, rawName: string) => {
    const name = rawName.split(':')[0].trim()
    const v = values[name]
    return v === undefined || v === '' ? whole : v
  })
}

export function collectVariableValues(
  texts: string[],
  values: Record<string, string>,
): string {
  let out = ''
  for (const t of texts) out += renderTemplate(t, values) + '\n'
  return out
}
