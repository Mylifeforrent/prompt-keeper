import type { PromptVariable } from '../types'

/** 从正文里解析 {{name}} / {{name:示例}} 变量名（去重保序） */
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

/** 合并正文变量与已存储的变量定义（类型/选项等） */
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

/** 按字面替换渲染模板；变量缺失保留原样以便发现 */
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
