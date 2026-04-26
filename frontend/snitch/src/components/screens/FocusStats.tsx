import { useState, useEffect } from 'react'
import Card from '../atoms/Card'
import Chip from '../atoms/Chip'
import Button from '../atoms/Button'
import { apiGet } from '../../api/client'
import type { Screen, UserProfile, SessionRead } from '../../types'

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
function computeStreak(sessions: SessionRead[]): number {
  const completedDays = new Set(
    sessions
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
  const [mySessions, setMySessions] = useState<SessionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiGet<SessionRead[]>('/sessions', token),
    ])
      .then(([my]) => {
        setMySessions(my)
      })
      .catch(() => setError('Could not load your stats.'))
      .finally(() => setLoading(false))
  }, [token])

  // ── Derived stats ─────────────────────────────────────────────────────
  const saved = mySessions
    .filter(s => s.status === 'completed')
    .reduce((acc, s) => acc + s.amount_cents, 0)

  const lost = mySessions
    .filter(s => s.status === 'paid_out')
    .reduce((acc, s) => acc + s.amount_cents, 0)

  const streak = computeStreak(mySessions)
  const recentSessions = mySessions.slice(0, 10)

  // Weekly bar chart (last 7 days)
  const weekBars = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const dayStr = d.toDateString()
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' })
    const sessionsToday = mySessions.filter(
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
    <div className="px-5 py-5 flex flex-col gap-4 lg:max-w-[66%] lg:mx-auto">
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
      <Card accent={lost > 0 ? 'warning' : undefined}>
        <div className="flex items-start justify-between">
          <div>
            <p className={[
              'font-body text-xs tracking-wide uppercase font-semibold',
              lost > 0 ? 'text-on-error-container' : 'text-on-surface-variant',
            ].join(' ')}>
              You gave
            </p>
            <p className="font-display font-semibold text-3xl text-on-surface mt-0.5">
              {formatCents(lost)}{' '}
              <span className="text-sm font-body font-normal text-on-surface-variant">
                to your friends
              </span>
            </p>
            <p className="font-body text-xs text-on-surface-variant mt-2">
              {lost > 0
                ? <><span className="text-error">How kind.</span> <span className="font-semibold text-error">Now stop scrolling.</span></>
                : "Keep it up — your friends haven't seen a dime."}
            </p>
          </div>
          <span className="text-2xl">{lost > 0 ? '⚠️' : '🎯'}</span>
        </div>
      </Card>

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
                const isCompleted = s.status === 'completed'
                const isPaidOut = s.status === 'paid_out'
                const isActive = s.status === 'active'
                const duration = s.elapsed_seconds != null
                  ? formatDuration(s.elapsed_seconds)
                  : formatDuration(s.duration_seconds)
                return (
                  <div key={s.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    {/* Status icon */}
                    <div className={[
                      'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                      isCompleted
                        ? 'bg-green-50 border border-green-300'
                        : isPaidOut
                          ? 'bg-error-container border border-error'
                          : 'bg-surface-container border border-outline-variant',
                    ].join(' ')}>
                      {isCompleted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : isPaidOut ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-error">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      ) : (
                        <span className="text-sm leading-none">⏳</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-body font-semibold text-sm text-on-surface">
                          {formatDate(s.created_at)}
                        </span>
                        <span className="font-body text-xs text-on-surface-variant flex-shrink-0">
                          {duration}
                        </span>
                      </div>

                      {isPaidOut ? (
                        <>
                          <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                            <span className="font-body text-sm font-semibold text-error">
                              {formatCents(s.amount_cents)} paid out
                            </span>
                            {s.distraction_count > 0 && (
                              <span className="font-body text-xs text-on-surface-variant">
                                {s.distraction_count} distraction{s.distraction_count !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {s.recipients.length === 1 ? (
                            <p className="font-body text-xs text-on-surface-variant mt-0.5">
                              → @{s.recipients[0].recipient_username}
                            </p>
                          ) : (
                            <div className="flex flex-col gap-0.5 mt-1">
                              {s.recipients.map(r => (
                                <span key={r.recipient_id} className="font-body text-xs text-on-surface-variant">
                                  @{r.recipient_username}: {formatCents(r.payout_cents ?? Math.round(s.amount_cents / s.recipients.length))}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="font-body text-xs text-on-surface-variant mt-0.5">
                            {s.recipients.map(r => `@${r.recipient_username}`).join(', ')}
                          </p>
                          {isActive && (
                            <div className="mt-1">
                              <Chip variant="default">In progress</Chip>
                            </div>
                          )}
                        </>
                      )}
                    </div>
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
