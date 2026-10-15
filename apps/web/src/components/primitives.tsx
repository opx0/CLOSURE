import type { ReactNode } from 'react'
import { ApiError } from '../api/client.ts'

export function Panel({
  title,
  subtitle,
  children,
  actions,
  icon,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <section className="card rise p-5 sm:p-6">
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {icon !== undefined && (
              <span className="mt-0.5 grid size-9 place-items-center rounded-xl border border-edge bg-raised text-accent-soft">
                {icon}
              </span>
            )}
            <div>
              {title !== undefined && (
                <h2 className="text-[15px] font-semibold tracking-tight text-body">{title}</h2>
              )}
              {subtitle !== undefined && (
                <p className="mt-0.5 max-w-prose text-[13px] leading-relaxed text-quiet">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  tone = 'default',
  type = 'button',
  size = 'md',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'danger'
  type?: 'button' | 'submit'
  size?: 'sm' | 'md'
}) {
  const tones = {
    default:
      'border-edge bg-raised text-muted hover:border-edge-strong hover:text-body hover:bg-panel-2',
    primary: 'border-transparent bg-body text-ink hover:bg-muted',
    danger: 'border-broken/40 bg-broken/10 text-broken hover:bg-broken/20',
  }
  const sizes = { sm: 'px-3 py-1.5 text-[13px]', md: 'px-4 py-2 text-sm' }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`ring-focus inline-flex items-center gap-2 rounded-sm border font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${sizes[size]} ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-quiet">{children}</p>
}

const TAG_TONES = {
  quiet: 'border-edge-strong/60 bg-white/[0.03] text-quiet',
  held: 'border-held/30 bg-held/10 text-held',
  shaky: 'border-shaky/30 bg-shaky/10 text-shaky',
  broken: 'border-broken/30 bg-broken/10 text-broken',
  accent: 'border-accent/40 bg-accent/10 text-accent-soft',
}

export function Tag({
  children,
  tone = 'quiet',
}: {
  children: ReactNode
  tone?: keyof typeof TAG_TONES
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function Dot({
  tone = 'quiet',
}: {
  tone?: 'quiet' | 'held' | 'shaky' | 'broken' | 'accent'
}) {
  const colors = {
    quiet: 'bg-quiet',
    held: 'bg-held',
    shaky: 'bg-shaky',
    broken: 'bg-broken',
    accent: 'bg-accent',
  }
  return <span className={`inline-block size-2 rounded-full ${colors[tone]}`} />
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-[13px] text-quiet">
      <span className="size-4 animate-spin rounded-full border-2 border-edge-strong border-t-accent" />
      loading {what}…
    </div>
  )
}

export function Failed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  const detail = error instanceof ApiError ? error.detail : undefined
  return (
    <div className="flex items-start gap-3 rounded-xl border border-broken/30 bg-broken/10 px-4 py-3 text-sm text-broken">
      <span className="mt-0.5">⚠</span>
      <span>
        {message}
        {detail !== undefined && (
          <span className="mt-0.5 block text-[13px] text-broken/80">{detail}</span>
        )}
      </span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state rounded-xl border border-dashed border-edge px-5 py-8 text-center text-[13px] text-quiet">
      {children}
    </div>
  )
}

export function Meter({
  value,
  tone = 'accent',
}: {
  value: number
  tone?: 'accent' | 'held' | 'shaky' | 'broken'
}) {
  const colors = {
    accent: 'from-accent to-cyan',
    held: 'from-held to-cyan',
    shaky: 'from-shaky to-accent',
    broken: 'from-broken to-shaky',
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${colors[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}
