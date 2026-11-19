import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/utils'
import { Icon, type IconName } from '../../lib/icons'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
  secondary: 'bg-muted text-foreground hover:bg-border/60 active:bg-border/70',
  outline:
    'border border-border bg-card text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:border-border-strong hover:bg-muted/60 active:bg-muted',
  ghost: 'text-foreground hover:bg-muted active:bg-muted/80',
  danger: 'bg-danger-solid text-white shadow-sm hover:bg-danger-solid/90 active:bg-danger-solid/95',
  success: 'bg-success-solid text-white shadow-sm hover:bg-success-solid/90 active:bg-success-solid/95',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-1.5',
  icon: 'h-9 w-9 justify-center',
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-lg',
        'font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  )
}

const fieldBase =
  'w-full rounded-lg border border-input bg-card text-sm text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.03)] outline-none transition-[border-color,box-shadow,background-color] duration-150 ' +
  'placeholder:text-muted-foreground/80 hover:border-border-strong ' +
  'focus:border-ring focus:ring-2 focus:ring-ring/20 ' +
  'disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn('h-9 px-3', fieldBase, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('resize-y px-3 py-2 leading-6', fieldBase, className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        className={cn(
          'h-9 w-full cursor-pointer appearance-none pl-3 pr-8',
          fieldBase,
          'disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        checked ? 'bg-primary' : 'bg-border-strong/80',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 py-0.5 text-sm',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-[5px] border border-input bg-card transition-colors',
          'hover:border-border-strong',
          'checked:border-primary checked:bg-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed',
        )}
        style={{
          backgroundImage: checked
            ? 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M3.5 8.5l3 3 6-7%27/%3E%3C/svg%3E")'
            : undefined,
          backgroundSize: '13px 13px',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {label && <span className="leading-5">{label}</span>}
    </label>
  )
}

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'outline'

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  secondary: 'bg-muted text-foreground/80',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  primary: 'bg-primary-soft text-primary',
  outline: 'border border-border text-muted-foreground',
}

export function Badge({
  variant = 'default',
  className,
  children,
  title,
}: {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[3px] text-[11px] font-medium leading-4',
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[10px] font-medium leading-none text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  )
}

export function EmptyState({
  icon = 'folder',
  title,
  description,
  action,
}: {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-16 text-center">
      <div className="relative mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-sm">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-soft/80 to-transparent" />
        <Icon name={icon} className="relative h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-0.5 max-w-[300px] text-xs leading-5 text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
