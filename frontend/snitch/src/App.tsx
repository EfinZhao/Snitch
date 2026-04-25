import { useState } from 'react'
import FocusDashboard from './components/screens/FocusDashboard'
import FocusStats from './components/screens/FocusStats'
import FocusStakes from './components/screens/FocusStakes'
import type { Screen } from './types'

const NAV = [
  {
    id: 'dashboard' as Screen,
    label: 'Home',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    id: 'stats' as Screen,
    label: 'Stats',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6"  y1="20" x2="6"  y2="14" />
      </svg>
    ),
  },
  {
    id: 'settings' as Screen,
    label: 'Settings',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

// Which nav item should appear active for each screen
const NAV_ACTIVE: Record<Screen, Screen> = {
  dashboard: 'dashboard',
  stats: 'stats',
  stakes: 'stakes',
  settings: 'settings',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard')

  const navigate = (s: Screen) => setScreen(s)

  return (
    <div className="h-dvh bg-surface-dim flex justify-center sm:py-8 lg:py-0">
      <div className="
        flex flex-col w-full h-full
        sm:max-w-[480px] sm:rounded-2xl sm:overflow-hidden
        sm:shadow-[0_8px_40px_-8px_rgba(0,0,0,0.18)]
        lg:max-w-full lg:rounded-none lg:shadow-none
        bg-surface
      ">
        {/* ── Shared header ── */}
        <header className="
          flex items-center justify-between
          px-5 pt-5 pb-3
          border-b border-outline-variant bg-surface
          sticky top-0 z-40
        ">
          <button
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-surface-container transition-colors"
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-on-surface-variant">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>

          <span className="font-display font-semibold text-xl text-primary italic tracking-tight select-none">
            Snitch
          </span>

          <button
            className="w-9 h-9 rounded-full border border-outline-variant bg-surface-container flex items-center justify-center hover:bg-surface-high transition-colors"
            aria-label="Profile"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
              <circle cx="10" cy="7" r="3.5" />
              <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" />
            </svg>
          </button>
        </header>

        {/* ── Screen content ── */}
        <main className="flex-1 overflow-y-auto">
          {screen === 'dashboard' && <FocusDashboard navigate={navigate} />}
          {screen === 'stats'    && <FocusStats navigate={navigate} />}
          {screen === 'stakes'     && <FocusStakes navigate={navigate} />}
          {screen === 'settings'  && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <p className="font-body italic text-sm">Settings coming soon.</p>
            </div>
          )}
        </main>

        {/* ── Shared bottom nav ── */}
        <nav className="
          flex-shrink-0
          border-t border-outline-variant bg-surface
          flex
          sm:rounded-b-2xl
        ">
          {NAV.map(({ id, icon, label }) => {
            const active = NAV_ACTIVE[screen] === id
            return (
              <button
                key={id}
                onClick={() => id !== 'settings' || screen !== 'settings' ? navigate(id) : undefined}
                className={[
                  'flex-1 flex flex-col items-center py-3 gap-0.5',
                  'text-xs font-body font-semibold uppercase tracking-wide',
                  'transition-colors',
                  active ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                <span className="leading-none">{icon}</span>
                {label}
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
