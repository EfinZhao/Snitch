import { useState, useEffect } from 'react'
import Card from '../atoms/Card'
import Chip from '../atoms/Chip'
import Button from '../atoms/Button'
import { apiGet } from '../../api/client'
import type { Screen, UserProfile, StakeRead } from '../../types'

interface Props {
  navigate: (screen: Screen) => void
  token: string
  user: UserProfile
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Count consecutive days (ending today) where at least one completed session occurred
function computeStreak(stakes: StakeRead[]): number {
  const completedDays = new Set(
    stakes
      .filter(s => s.status === 'completed' && s.resolved_at)
      .map(s => new Date(s.resolved_at!).toDateString()),
  )
  let streak = 0
  const cursor = new Date()
  while (completedDays.has(cursor.toDateString())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export default function FocusStats({ navigate, token }: Props) {
  const [myStakes, setMyStakes] = useState<StakeRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiGet<StakeRead[]>('/stakes', token),
    ])
      .then(([my]) => {
        setMyStakes(my)
      })
      .catch(() => setError('Could not load your stats.'))
      .finally(() => setLoading(false))
  }, [token])

  // ── Derived stats ─────────────────────────────────────────────────────
  const saved = myStakes
    .filter(s => s.status === 'completed')
    .reduce((acc, s) => acc + s.amount_cents, 0)

  const lost = myStakes
    .filter(s => s.status === 'failed')
    .reduce((acc, s) => acc + s.amount_cents, 0)

  const streak = computeStreak(myStakes)
  const recentSessions = myStakes.slice(0, 10)

  // Weekly bar chart (last 7 days)
  const weekBars = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const dayStr = d.toDateString()
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' })
    const sessionsToday = myStakes.filter(
      s => s.activated_at && new Date(s.activated_at).toDateString() === dayStr,
    )
    const hours = sessionsToday.reduce((acc, s) => acc + (s.elapsed_seconds ?? s.duration_seconds) / 3600, 0)
    const hasPenalty = sessionsToday.some(s => s.status === 'failed')
    const isToday = i === 6
    return { day: dayLabel, hours, hasPenalty, isToday }
  })
  const maxHours = Math.max(...weekBars.map(b => b.hours), 1)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <svg className="animate-spin text-primary" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 px-6">
        <p className="font-body text-sm text-error text-center">{error}</p>
        <Button variant="ghost" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="font-display font-semibold text-4xl text-on-surface leading-tight">
          Your Stats
        </h1>
      </div>

      {/* Money saved */}
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-body text-xs text-on-surface-variant tracking-wide uppercase">
              You saved
            </p>
            <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
              {formatCents(saved)}
            </p>
            <p className="font-body text-xs text-on-surface-variant mt-2">
              {saved > 0 ? 'Maybe locking in is worth it after all?' : 'Complete a session to start saving.'}
            </p>
          </div>
          <span className="text-2xl">💰</span>
        </div>
      </Card>

      {/* Money lost */}
      {lost > 0 && (
        <Card accent="warning">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-body text-xs text-on-error-container tracking-wide uppercase font-semibold">
                You gave
              </p>
              <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
                {formatCents(lost)}{' '}
                <span className="text-sm font-body font-normal text-on-surface-variant">
                  to your friends
                </span>
              </p>
              <p className="font-body text-xs text-error mt-2">
                How kind. <span className="font-semibold">Now stop scrolling.</span>
              </p>
            </div>
            <span className="text-2xl">⚠️</span>
          </div>
        </Card>
      )}

      {/* Streak */}
      <Card accent="info">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-body text-xs text-primary tracking-wide uppercase font-semibold">
              Current Streak
            </p>
            <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
              {streak}{' '}
              <span className="text-sm font-body font-normal text-on-surface-variant">
                {streak === 1 ? 'day' : 'days'} without distractions
              </span>
            </p>
            <p className="font-body text-xs text-on-surface-variant mt-2">
              {streak > 0 ? "Don't break it now." : 'Complete a session today to start one.'}
            </p>
          </div>
          <span className="text-2xl">🔥</span>
        </div>
      </Card>

      {/* Weekly bar chart */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-xl text-on-surface">
            This Week's Focus Hours
          </h2>
        </div>
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-xs font-body text-on-surface-variant">
            {[`${Math.ceil(maxHours)}h`, `${Math.ceil(maxHours / 2)}h`, '0'].map(l => (
              <span key={l}>{l}</span>
            ))}
          </div>
          <div className="ml-6 flex items-end gap-1.5 h-32">
            {weekBars.map(({ day, hours, hasPenalty, isToday }) => {
              const pct = (hours / maxHours) * 100
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  {isToday && hours > 0 && (
                    <span className="text-xs font-body font-semibold text-primary bg-primary-fixed border border-primary-fixed-dim rounded px-1">
                      {hours.toFixed(1)}h
                    </span>
                  )}
                  <div className="w-full flex items-end" style={{ height: '96px' }}>
                    <div
                      className={[
                        'w-full rounded-sm transition-all',
                        isToday
                          ? 'bg-primary-fixed-dim border border-primary'
                          : hasPenalty
                            ? 'bg-error-container border border-error'
                            : 'bg-surface-high border border-outline-variant',
                      ].join(' ')}
                      style={{ height: `${pct}%`, minHeight: hours > 0 ? '4px' : '0' }}
                    />
                  </div>
                  <span className="text-xs font-body text-on-surface-variant">{day}</span>
                </div>
              )
            })}
          </div>
        </div>
        <p className="font-body italic text-xs text-on-surface-variant mt-3">
          {weekBars.every(b => b.hours === 0)
            ? 'No sessions this week yet. Time to lock in.'
            : 'Keep the streak going.'}
        </p>
      </Card>

      {/* Recent sessions */}
      <div>
        <h2 className="font-display font-semibold text-xl text-on-surface mb-3">
          Recent Sessions
        </h2>
        {recentSessions.length === 0 ? (
          <Card>
            <p className="font-body text-sm text-on-surface-variant text-center py-2">
              No sessions yet. Hit Lock In to get started.
            </p>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-col divide-y divide-outline-variant">
              {recentSessions.map(s => {
                const focused = s.status === 'completed'
                const duration = s.elapsed_seconds != null
                  ? formatDuration(s.elapsed_seconds)
                  : formatDuration(s.duration_seconds)
                return (
                  <div key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-10 h-10 rounded-full border border-outline-variant bg-surface-container flex items-center justify-center text-lg flex-shrink-0">
                      {focused ? '✅' : s.status === 'failed' ? '❌' : '⏳'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-body font-semibold text-sm text-on-surface">
                          {formatDate(s.created_at)}
                        </span>
                        {s.status === 'failed' && (
                          <span className="text-xs font-body font-semibold text-error">
                            Penalty: {formatCents(s.amount_cents)}
                          </span>
                        )}
                      </div>
                      <p className="font-body text-xs text-on-surface-variant">
                        {s.recipients.map(r => `@${r.recipient_username}`).join(', ')}
                      </p>
                      <div className="mt-1">
                        <Chip variant={focused ? 'success' : s.status === 'failed' ? 'warning' : 'default'}>
                          {focused ? 'Focused' : s.status === 'failed' ? 'Distracted' : s.status}
                        </Chip>
                      </div>
                    </div>
                    <span className="font-body text-xs text-on-surface-variant flex-shrink-0">
                      {duration}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
        <div className="mt-3">
          <Button variant="ghost" fullWidth onClick={() => navigate('dashboard')}>
            New Session
          </Button>
        </div>
      </div>
    </div>
  )
}
