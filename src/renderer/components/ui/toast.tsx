import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { uid } from '../../lib/ids'
import { Icon, type IconName } from '../../lib/icons'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface ToastItem {
  id: string
  type: ToastType
  message: string
}

const toastStyles: Record<ToastType, { icon: IconName; iconCls: string }> = {
  success: { icon: 'check', iconCls: 'bg-success-soft text-success' },
  error: { icon: 'x', iconCls: 'bg-danger-soft text-danger' },
  warning: { icon: 'alert', iconCls: 'bg-warning-soft text-warning' },
  info: { icon: 'sparkles', iconCls: 'bg-info-soft text-info' },
}

const ToastCtx = createContext<{
  show: (type: ToastType, message: string) => void
} | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (type: ToastType, message: string) => {
      const id = uid()
      setItems((prev) => [...prev.slice(-3), { id, type, message }])
      const t = setTimeout(() => dismiss(id), 3200)
      timers.current.set(id, t)
    },
    [dismiss],
  )

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[368px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => {
          const s = toastStyles[t.type]
          return (
            <div
              key={t.id}
              className={cn(
                'animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border/80 bg-card px-3.5 py-3 shadow-[var(--shadow-float)]',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  s.iconCls,
                )}
              >
                <Icon name={s.icon} className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-5 text-foreground">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return {
    success: (msg: string) => ctx.show('success', msg),
    error: (msg: string) => ctx.show('error', msg),
    warning: (msg: string) => ctx.show('warning', msg),
    info: (msg: string) => ctx.show('info', msg),
  }
}
