import { useState, useRef, useEffect, useCallback } from 'react'
import Button from '../atoms/Button'
import Card from '../atoms/Card'
import Chip from '../atoms/Chip'
import type { CameraMonitorState, BreakReason } from '../../hooks/useCameraMonitor'
import type { Screen } from '../../types'

const MAX_STRIKES = 5

const CATEGORY_LABELS = {
  out_of_frame: 'Out of frame',
  phone_detected: 'Phone detected',
  looking_away: 'Looking away',
} as const

function relativeTime(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)}m ago`
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DistractionMonitor({
  navigate: _navigate,
  cameraMonitor,
}: {
  navigate: (screen: Screen) => void
  cameraMonitor: CameraMonitorState
}) {
  const {
    permission, active, strikes, events, currentStatus,
    loadingState, loadingStep, errorMessage,
    breakUntil, breakRemaining,
    streamRef, startCamera, stopCamera, startBreak, endBreak,
    handleWarning, handleStrike,
  } = cameraMonitor

  // Display-only video — just renders the shared stream
  const videoRef = useRef<HTMLVideoElement>(null)

  const syncAndAttach = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (active && streamRef.current) {
      video.srcObject = streamRef.current
      video.play().catch(() => {})
    } else {
      video.srcObject = null
    }
  }, [active, streamRef])

  // Attach/detach the stream whenever active changes, and on mount
  useEffect(() => {
    syncAndAttach()
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [syncAndAttach])

  // Keep relative timestamps ticking
  const [, setTick] = useState(0)
  useEffect(() => {
    if (events.length === 0) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [events.length])

  const isOnBreak = breakUntil !== null

  const statusConfig: Record<
    'focused' | 'warning' | 'distracted' | 'break',
    { label: string; variant: 'success' | 'warning' | 'default'; pulse: boolean }
  > = {
    focused:    { label: 'Focused',      variant: 'success', pulse: false },
    warning:    { label: '⚠ Heads up…',  variant: 'warning', pulse: true  },
    distracted: { label: '✗ Distracted', variant: 'warning', pulse: false },
    break:      { label: 'On break',     variant: 'default', pulse: false },
  }
  const displayKey = isOnBreak ? 'break' : currentStatus
  const { label: statusLabel, variant: statusVariant, pulse } = statusConfig[displayKey]

  const borderColor = {
    focused:    'border-outline-variant',
    warning:    'border-yellow-400',
    distracted: 'border-error',
    break:      'border-primary',
  }[displayKey]

  const loadingLabel =
    loadingState === 'loading'
      ? `Loading AI models… (${loadingStep}/4)`
      : loadingState === 'error'
        ? `Model error: ${errorMessage}`
        : null

  return (
    <div className="flex flex-col px-5 py-5 gap-4">
      <div>
        <h1 className="font-display font-semibold text-4xl text-on-surface leading-tight">
          Focus Monitor
        </h1>
        <p className="font-body italic text-sm text-on-surface-variant mt-1 leading-snug">
          "I'm watching. Don't touch your phone."
        </p>
      </div>

      {/* Camera feed */}
      <div
        className={[
          'relative w-full lg:max-w-[55%] lg:mx-auto rounded-lg overflow-hidden bg-surface-container border-2 transition-colors',
          borderColor,
        ].join(' ')}
        style={{ aspectRatio: '4/3' }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover scale-x-[-1]"
          muted
          playsInline
        />

        {/* Idle / denied overlay */}
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container">
            {permission === 'denied' ? (
              <>
                <span className="text-4xl select-none">🚫</span>
                <p className="font-body text-sm text-on-surface-variant text-center px-8">
                  Camera access denied. Enable it in your browser settings and reload.
                </p>
              </>
            ) : (
              <>
                <svg
                  width="40" height="40" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  className="text-on-surface-variant opacity-40"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <p className="font-body italic text-sm text-on-surface-variant">
                  Camera preview will appear here
                </p>
              </>
            )}
          </div>
        )}

        {/* Warning pulse ring */}
        {pulse && active && !isOnBreak && (
          <div className="absolute inset-0 rounded-lg border-4 border-yellow-400 animate-pulse pointer-events-none" />
        )}

        {/* Model loading overlay */}
        {active && loadingState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
            <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24"
              fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <p className="font-body text-sm text-white text-center px-6">{loadingLabel}</p>
          </div>
        )}

        {loadingState === 'error' && active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-error-container/80 p-4">
            <p className="font-body text-sm text-on-error-container text-center">{loadingLabel}</p>
          </div>
        )}

        {/* Break overlay */}
        {active && isOnBreak && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 rounded-lg">
            <svg width="32" height="32" viewBox="0 0 24 24"
              fill="none" stroke="white" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
            <span className="font-display font-semibold text-5xl text-white tabular-nums leading-none">
              {formatRemaining(breakRemaining)}
            </span>
            <p className="font-body text-sm text-white/70">Break in progress</p>
            <button
              onClick={endBreak}
              className="mt-1 font-body text-sm text-white border border-white/40 rounded-full px-4 py-1.5 hover:bg-white/10 transition-colors"
            >
              Resume early
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 w-full lg:max-w-[55%] lg:mx-auto">
        {/* Status + strikes */}
        <div className="flex items-center justify-between">
          <Chip variant={statusVariant}>{statusLabel}</Chip>
          <span className="font-display font-semibold text-sm text-on-surface-variant tabular-nums">
            {strikes} / {MAX_STRIKES} strikes
          </span>
        </div>

        {/* Strike progress bar */}
        <div className="w-full h-2 rounded-full bg-surface-high overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min((strikes / MAX_STRIKES) * 100, 100)}%`,
              backgroundColor: strikes >= MAX_STRIKES ? 'var(--color-error)' : 'var(--color-primary)',
            }}
          />
        </div>

        {/* Control button */}
        {active ? (
          <Button variant="danger" fullWidth onClick={stopCamera}>
            Stop Monitoring
          </Button>
        ) : (
          <Button
            variant="primary"
            fullWidth
            onClick={startCamera}
            disabled={permission === 'denied'}
          >
            {permission === 'denied' ? 'Camera Unavailable' : 'Start Monitoring'}
          </Button>
        )}
      </div>

      {/* Event log */}
      {events.length > 0 && (
        <div>
          <h2 className="font-display font-semibold text-base text-on-surface mb-2">
            Recent Detections
          </h2>
          <Card>
            <div className="flex flex-col divide-y divide-outline-variant">
              {events.slice(0, 6).map(ev => (
                <div key={ev.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="text-sm select-none flex-shrink-0">
                    {ev.stage === 'distracted' ? '✗' : '⚠'}
                  </span>
                  <span className="font-body text-sm text-on-surface flex-1">
                    {CATEGORY_LABELS[ev.category]}
                  </span>
                  <Chip variant={ev.stage === 'distracted' ? 'warning' : 'default'}>
                    {ev.stage === 'distracted' ? 'Strike' : 'Warning'}
                  </Chip>
                  <span className="font-body text-xs text-on-surface-variant tabular-nums flex-shrink-0">
                    {relativeTime(ev.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Dev buttons */}
      {import.meta.env.DEV && (
        <div className="flex gap-2">
          <button
            onClick={() => handleWarning('phone_detected')}
            className="flex-1 text-xs text-on-surface-variant border border-outline-variant rounded px-2 py-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            [dev] warn
          </button>
          <button
            onClick={() => handleStrike('phone_detected')}
            className="flex-1 text-xs text-error border border-error rounded px-2 py-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            [dev] strike
          </button>
          <button
            onClick={() => startBreak(2 * 60_000, 'break' as BreakReason)}
            className="flex-1 text-xs text-primary border border-primary rounded px-2 py-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            [dev] break
          </button>
        </div>
      )}
    </div>
  )
}
