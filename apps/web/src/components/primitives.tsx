import type { ReactNode } from 'react'

export function Panel({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-edge bg-panel p-4">
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title !== undefined && <h2 className="text-base text-accent">{title}</h2>}
            {subtitle !== undefined && <p className="text-xs text-quiet">{subtitle}</p>}
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
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'danger'
  type?: 'button' | 'submit'
}) {
  const tones = {
    default: 'border-edge bg-[#1c232d] hover:bg-[#242d3a]',
    primary: 'border-accent/50 bg-accent/15 hover:bg-accent/25 text-accent',
    danger: 'border-broken/50 bg-broken/10 hover:bg-broken/20 text-broken',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-default disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-xs text-quiet">{children}</p>
}

export function Tag({
  children,
  tone = 'quiet',
}: {
  children: ReactNode
  tone?: 'quiet' | 'held' | 'shaky' | 'broken' | 'accent'
}) {
  const tones = {
    quiet: 'border-edge text-quiet',
    held: 'border-held/40 text-held',
    shaky: 'border-shaky/40 text-shaky',
    broken: 'border-broken/40 text-broken',
    accent: 'border-accent/40 text-accent',
  }
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Loading({ what }: { what: string }) {
  return <p className="text-xs text-quiet">loading {what}…</p>
}

export function Failed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <p className="rounded border border-broken/40 bg-broken/10 px-3 py-2 text-sm text-broken">
      {message}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-quiet">{children}</p>
}
