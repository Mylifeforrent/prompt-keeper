export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function nowIso(): string {
  return new Date().toISOString()
}
