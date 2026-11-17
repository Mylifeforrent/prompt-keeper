import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn, uid } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface ToastItem {
  id: string
  type: ToastType
  message: string
}

const toastStyles: Record<ToastType, { icon: IconName; cls: string }> = {
  success: { icon: 'check', cls: 'text-success' },
  error: { icon: 'x', cls: 'text-danger' },
  warning: { icon: 'alert', cls: 'text-warning' },
  info: { icon: 'sparkles', cls: 'text-info' },
}

const ToastCtx = createContext<{
  show: (type: ToastType, message: string) => void
} | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const show = useCallback((type: ToastType, message: string) => {
    const id = uid()
    setItems((prev) => [...prev.slice(-3), { id, type, message }])
    const t = setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id))
      timers.current.delete(id)
    }, 2600)
    timers.current.set(id, t)
  }, [])

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => {
          const s = toastStyles[t.type]
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm shadow-lg',
                'animate-in transition-all',
              )}
            >
              <Icon name={s.icon} className={cn('mt-0.5 h-4 w-4', s.cls)} />
              <span className="leading-5">{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return {
    success: (msg: string) => ctx.show('success', msg),
    error: (msg: string) => ctx.show('error', msg),
    warning: (msg: string) => ctx.show('warning', msg),
    info: (msg: string) => ctx.show('info', msg),
  }
}
