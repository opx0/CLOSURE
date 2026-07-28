import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ClaimsPage } from './pages/claims.tsx'
import { SessionPage } from './pages/session.tsx'
import { LedgerPage } from './pages/ledger.tsx'
import { ReviewPage } from './pages/review.tsx'
import { SchedulePage } from './pages/schedule.tsx'
import { ReplayPage } from './pages/replay.tsx'
import { CatalogPage } from './pages/catalog.tsx'
import { BenchmarkPage } from './pages/benchmark.tsx'
import { PrivacyPage } from './pages/privacy.tsx'

const TABS: readonly { to: string; label: string }[] = [
  { to: '/claims', label: 'claims' },
  { to: '/session', label: 'interview' },
  { to: '/ledger', label: 'gap ledger' },
  { to: '/schedule', label: 'due' },
  { to: '/review', label: 'review' },
  { to: '/replay', label: 'replay' },
  { to: '/catalog', label: 'policy' },
  { to: '/benchmark', label: 'benchmark' },
  { to: '/privacy', label: 'your data' },
]

export function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-lg text-accent">CLOSER</h1>
        <p className="text-xs text-quiet">
          Practice only. It never runs during a real interview, it never gives you a readiness
          score, and every judgment here cites the words it came from.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-edge pb-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `rounded px-2 py-1 text-sm transition ${
                isActive ? 'bg-accent/15 text-accent' : 'text-quiet hover:text-body'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/claims" replace />} />
          <Route path="/claims" element={<ClaimsPage />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<p className="text-sm text-quiet">no such page</p>} />
        </Routes>
      </main>

      <footer className="border-t border-edge pt-3 text-[11px] text-quiet">
        Repository evidence shows what deserves a question. It never proves who wrote the code or
        what they understand.
      </footer>
    </div>
  )
}
