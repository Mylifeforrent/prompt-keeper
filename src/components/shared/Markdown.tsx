import type { ReactNode } from 'react'

/** Minimal Markdown renderer for the prototype: headings / lists / code blocks / inline bold and code / quotes / dividers */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <code
          key={`${keyBase}-c${i}`}
          className="rounded border border-border/70 bg-muted px-1 py-px font-mono text-[0.85em] text-foreground/90"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + token.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++ // skip closing ```
      blocks.push(
        <pre
          key={key++}
          className="my-2.5 overflow-x-auto rounded-lg border border-border bg-muted/55 p-3 font-mono text-[11.5px] leading-5"
        >
          {lang && <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{lang}</div>}
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const cls = [
        'mt-4 mb-1.5 text-base font-semibold tracking-tight',
        'mt-4 mb-1.5 text-[15px] font-semibold tracking-tight',
        'mt-3 mb-1 text-[13px] font-semibold',
        'mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground',
      ][level - 1]
      blocks.push(
        <div key={key++} className={cls}>
          {inline(heading[2], `h${key}`)}
        </div>,
      )
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''))
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5 marker:text-muted-foreground/60">
          {items.map((it, idx) => (
            <li key={idx} className="leading-6">
              {inline(it, `li${key}-${idx}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ''))
      blocks.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground/60">
          {items.map((it, idx) => (
            <li key={idx} className="leading-6">
              {inline(it, `ol${key}-${idx}`)}
            </li>
          ))}
        </ol>,
      )
      continue
    }
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={key++}
          className="my-2.5 rounded-r-md border-l-2 border-primary/40 bg-muted/40 py-1 pl-3 pr-2 text-muted-foreground"
        >
          {inline(line.slice(2), `q${key}`)}
        </blockquote>,
      )
      i++
      continue
    }
    if (/^\s*---\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-border" />)
      i++
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    blocks.push(
      <p key={key++} className="my-1.5 leading-6 text-foreground/90">
        {inline(line, `p${key}`)}
      </p>,
    )
    i++
  }

  return <div className={className}>{blocks}</div>
}
