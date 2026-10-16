import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type IconName =
  | 'prepare'
  | 'interview'
  | 'improve'
  | 'history'
  | 'arrow'
  | 'file'
  | 'shield'
  | 'clock'
  | 'check'
  | 'tools'
const PATHS: Record<IconName, readonly string[]> = {
  prepare: ['M4 5h16v15H4z', 'M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6'],
  interview: ['M5 4h14v12H9l-4 4z', 'M9 8h6M9 12h4'],
  improve: ['M4 18l5-5 4 3 7-10', 'M15 6h5v5'],
  history: ['M4 10a8 8 0 1 1 1 8', 'M4 4v6h6M12 8v5l3 2'],
  arrow: ['M5 12h14M14 7l5 5-5 5'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v5h4M9 12h6M9 16h5'],
  shield: ['M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z', 'M9 12l2 2 4-4'],
  clock: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18', 'M12 7v5l3 2'],
  check: ['M5 12l4 4L19 6'],
  tools: ['M4 6h16M4 12h16M4 18h16', 'M8 4v4M16 10v4M10 16v4'],
}

export function JourneyIcon({
  name,
  className = 'size-5',
}: {
  name: IconName
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  )
}

export function PageIntro({
  title,
  description,
  eyebrow,
  action,
  displayTitle,
}: {
  title: string
  description: string
  eyebrow: string
  action?: ReactNode
  displayTitle?: ReactNode
}) {
  return (
    <header className="journey-intro">
      <div>
        <p className="journey-eyebrow">{eyebrow}</p>
        <h1 aria-label={title}>{displayTitle ?? title}</h1>
        <p className="journey-description">{description}</p>
      </div>
      {action}
    </header>
  )
}

export function PracticeFlow({ className = '' }: { className?: string }) {
  return (
    <div className={`practice-flow ${className}`} aria-label="Question, answer, evidence">
      <span>
        <JourneyIcon name="interview" className="size-4" />
        Question
      </span>
      <JourneyIcon name="arrow" className="size-3" />
      <span>
        <JourneyIcon name="file" className="size-4" />
        Answer
      </span>
      <JourneyIcon name="arrow" className="size-3" />
      <span>
        <JourneyIcon name="shield" className="size-4" />
        Evidence
      </span>
    </div>
  )
}

export function PreparationGrid() {
  return (
    <div className="preparation-grid" aria-hidden="true">
      <svg viewBox="0 0 1200 500" fill="none" preserveAspectRatio="xMidYMid slice">
        <g className="grid-perspective">
          {[0, 80, 160, 240, 320, 400, 480, 560, 640, 720, 800, 880, 960, 1040, 1120, 1200].map(
            (x) => (
              <path key={x} d={`M${x} 500 L${600 + (x - 600) * 0.65} 0`} />
            ),
          )}
          {[40, 95, 160, 235, 320, 415, 495].map((y) => (
            <path key={y} d={`M0 ${y} H1200`} />
          ))}
        </g>
        <path
          className="grid-route-base"
          d="M70 320H170V235H250V160H330M915 415H990V320H1070V160H1130V95"
        />
        <path className="grid-route" d="M915 415H990V320H1070V160H1130V95" />
        {[
          [70, 320],
          [170, 320],
          [170, 235],
          [250, 235],
          [250, 160],
          [330, 160],
          [915, 415],
          [990, 415],
          [990, 320],
          [1070, 320],
          [1070, 160],
          [1130, 160],
          [1130, 95],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={(x ?? 0) - 3} y={(y ?? 0) - 3} width="6" height="6" />
        ))}
      </svg>
    </div>
  )
}

export function JourneyLink({
  to,
  title,
  description,
  icon,
}: {
  to: string
  title: string
  description: string
  icon: IconName
}) {
  return (
    <Link to={to} aria-label={title} className="journey-link ring-focus">
      <span className="journey-icon">
        <JourneyIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-body">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-quiet">{description}</span>
      </span>
      <JourneyIcon name="arrow" className="size-4 shrink-0 text-quiet" />
    </Link>
  )
}
