import { useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ResumePage } from './pages/resume.tsx'
import { SessionPage } from './pages/session.tsx'
import { LedgerPage } from './pages/ledger.tsx'
import { ReviewPage } from './pages/review.tsx'
import { SchedulePage } from './pages/schedule.tsx'
import { ReplayPage } from './pages/replay.tsx'
import { CatalogPage } from './pages/catalog.tsx'
import { BenchmarkPage } from './pages/benchmark.tsx'
import { PrivacyPage } from './pages/privacy.tsx'
import { StudioPage } from './pages/studio.tsx'
import { DebriefPage } from './pages/debrief.tsx'
import { TrendsPage } from './pages/trends.tsx'
import { MirrorPage } from './pages/mirror.tsx'
import { HistoryPage } from './pages/history.tsx'
import { PreparePage } from './pages/prepare.tsx'
import { ImprovePage } from './pages/improve.tsx'
import { StoriesPage } from './pages/stories.tsx'
import { JourneyIcon } from './components/journey.tsx'

const DESTINATIONS = [
  {
    to: '/prepare',
    label: 'Prepare',
    icon: 'prepare',
    paths: ['/', '/prepare', '/resume', '/claims', '/stories'],
  },
  { to: '/session', label: 'Interview', icon: 'interview', paths: ['/session', '/studio'] },
  {
    to: '/improve',
    label: 'Improve',
    icon: 'improve',
    paths: ['/improve', '/debrief', '/ledger', '/schedule'],
  },
  {
    to: '/history',
    label: 'History',
    icon: 'history',
    paths: ['/history', '/review', '/replay', '/trends'],
  },
] as const

const TOOLS = [
  { to: '/studio', label: 'Practice aloud' },
  { to: '/stories', label: 'Behavioral stories' },
  { to: '/ledger', label: 'Gap ledger' },
  { to: '/schedule', label: 'What is due' },
  { to: '/review', label: 'Compare attempts' },
  { to: '/trends', label: 'Trends' },
  { to: '/replay', label: 'Replay' },
  { to: '/mirror', label: 'Screen mirror' },
  { to: '/catalog', label: 'Policy' },
  { to: '/benchmark', label: 'Benchmark' },
] as const

function Brand() {
  return (
    <NavLink to="/" className="studio-brand" aria-label="Levelhead home">
      <span className="studio-brand-mark" aria-hidden="true">
        lh
      </span>
      levelhead
    </NavLink>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <nav id="studio-navigation" aria-label="Primary" className="studio-dock">
      {DESTINATIONS.map((item) => {
        const active = item.paths.some((path) => path === location.pathname)
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={`studio-dock-link ring-focus ${active ? 'is-active' : ''}`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function App() {
  const [open, setOpen] = useState(false)
  const toolsRef = useRef<HTMLDetailsElement>(null)
  const location = useLocation()
  const inRoom = location.pathname === '/session' && new URLSearchParams(location.search).has('id')
  const primaryPage = ['/', '/prepare', '/session', '/improve', '/history', '/debrief'].includes(
    location.pathname,
  )
  const onNavigate = () => {
    setOpen(false)
    if (toolsRef.current !== null) toolsRef.current.open = false
  }

  return (
    <div className={`studio-shell ${inRoom ? 'studio-night' : ''} ${open ? 'mobile-open' : ''}`}>
      <header className="studio-header">
        <Brand />
        <div className={`studio-dock-wrap ${open ? 'is-open' : ''}`}>
          <NavList onNavigate={onNavigate} />
        </div>
        <div className="studio-utilities">
          <Link to="/resume" onClick={onNavigate} className="studio-material-link">
            Résumé &amp; projects
          </Link>
          <details ref={toolsRef} className="studio-tools">
            <summary>
              <JourneyIcon name="tools" className="size-4" />
              <span>More tools</span>
            </summary>
            <div className="studio-tool-menu">
              <p>Practice tools</p>
              {TOOLS.map((item) => (
                <Link key={item.to} to={item.to} onClick={onNavigate}>
                  {item.label}
                  <JourneyIcon name="arrow" className="size-3" />
                </Link>
              ))}
            </div>
          </details>
          <Link
            to="/privacy"
            onClick={onNavigate}
            className="studio-data-link"
            aria-label="Your data"
          >
            <JourneyIcon name="shield" className="size-4" />
            <span>Your data</span>
          </Link>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="studio-menu-toggle ring-focus"
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="studio-navigation"
        >
          {open ? '✕' : '☰'}
        </button>
      </header>
      {import.meta.env.VITE_LEVELHEAD_PREVIEW_MODE === 'true' && (
        <aside role="status" className="border-b border-current/10 px-6 py-3 text-center text-sm">
          UI preview — explore the screens. Live interviews and uploads are unavailable. Do not
          enter personal material.
        </aside>
      )}
      <main className={`studio-main ${primaryPage ? '' : 'legacy-surface legacy-page'}`}>
        <Routes>
          <Route path="/" element={<PreparePage />} />
          <Route path="/prepare" element={<PreparePage />} />
          <Route path="/improve" element={<ImprovePage />} />
          <Route path="/resume" element={<ResumePage />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/claims" element={<Navigate to="/resume" replace />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/debrief" element={<DebriefPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/mirror" element={<MirrorPage />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="studio-footer">
        <span>levelhead / Interview preparation</span>
        <Link to="/privacy">
          Practice only. Your data stays yours. <JourneyIcon name="arrow" className="size-3" />
        </Link>
      </footer>
    </div>
  )
}
