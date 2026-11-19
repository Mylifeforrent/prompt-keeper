import { diffLines as computeDiff } from 'diff'

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

export function lineDiff(before: string, after: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const part of computeDiff(before, after)) {
    const type: DiffLine['type'] = part.added ? 'add' : part.removed ? 'del' : 'same'
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const text of lines) out.push({ type, text })
  }
  return out
}

export function diffStats(before: string, after: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of lineDiff(before, after)) {
    if (line.type === 'add') additions++
    else if (line.type === 'del') deletions++
  }
  return { additions, deletions }
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8Length(text) <= maxBytes) return { text, truncated: false }
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8Length(text.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return { text: text.slice(0, low), truncated: true }
}
