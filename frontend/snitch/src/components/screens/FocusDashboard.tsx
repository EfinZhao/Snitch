import { useState, useEffect, useRef } from 'react'
import Button from '../atoms/Button'
import type { Screen } from '../../types'

const DEFAULT_SECONDS = 25 * 60

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// Accepts a plain number of minutes (e.g. "90" → 90 min → 5400 s)
function parseInput(raw: string): number | null {
  const minutes = parseFloat(raw.trim())
  if (isNaN(minutes) || minutes <= 0) return null
  return Math.round(minutes * 60)
}

export default function FocusDashboard({ navigate }: { navigate: (screen: Screen) => void }) {
  const [totalSeconds, setTotalSeconds] = useState(DEFAULT_SECONDS)
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // tracks whether commitEdit was already called via Enter so onBlur skips it
  const committingRef = useRef(false)

  useEffect(() => {
    if (running && seconds > 0) {
      intervalRef.current = setInterval(() => setSeconds(s => s - 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, seconds])

  function startEditing() {
    if (running) return
    committingRef.current = false
    setInputVal('')
    setEditing(true)
  }

  function commitEdit(val: string) {
    if (committingRef.current) return
    committingRef.current = true
    const parsed = parseInput(val)
    if (parsed !== null && parsed > 0) {
      setTotalSeconds(parsed)
      setSeconds(parsed)
    }
    setEditing(false)
    setInputVal('')
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitEdit(inputVal)
    if (e.key === 'Escape') {
      committingRef.current = true
      setEditing(false)
      setInputVal('')
    }
  }

  const circumference = 2 * Math.PI * 120
  const progress = (seconds / totalSeconds) * circumference

  return (
    <div className="flex flex-col items-center px-6 py-10 gap-8">
      {/* Headline */}
      <h1 className="font-display font-semibold text-3xl text-on-surface text-center leading-tight">
        Ready to actually work for once?
      </h1>

      {/* Stake pill */}
      <button
        onClick={() => navigate('stakes')}
        className="flex items-center gap-2 border border-outline-variant rounded-full px-4 py-2 bg-white hover:bg-surface-container transition-colors"
      >
        <span className="text-error text-sm">💰</span>
        <span className="font-body font-semibold text-sm text-on-surface">$25 on the line</span>
      </button>

      {/* Clock face */}
      <div className="relative flex items-center justify-center my-4">
        {/* Outer dashed ring */}
        <div
          className="absolute rounded-full border-2 border-dashed border-outline-variant"
          style={{ width: '288px', height: '288px' }}
        />

        {/* SVG arc progress */}
        <svg
          width="264"
          height="264"
          className="absolute pointer-events-none"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="132" cy="132" r="120"
            fill="none"
            stroke="var(--color-primary-fixed-dim)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
          />
        </svg>

        {/* Inner circle */}
        <div
          className="flex flex-col items-center justify-center rounded-full border-2 border-outline-variant bg-surface relative z-10"
          style={{ width: '224px', height: '224px' }}
        >
          {editing ? (
            <input
              ref={el => { el?.focus() }}
              type="text"
              inputMode="decimal"
              value={inputVal}
              placeholder="25"
              onChange={e => setInputVal(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={handleInputKey}
              onBlur={() => commitEdit(inputVal)}
              className="w-24 text-center font-display font-semibold text-4xl text-primary tabular-nums bg-transparent outline-none border-b-2 border-primary"
            />
          ) : (
            <button
              onClick={startEditing}
              disabled={running}
              className="font-display font-semibold text-4xl text-primary tabular-nums disabled:cursor-default"
            >
              {formatTime(seconds)}
            </button>
          )}
          <span className="text-outline-variant text-xs mt-2 tracking-widest">
            {editing ? 'minutes' : '• • •'}
          </span>
        </div>
      </div>

      <Button
        variant="primary"
        fullWidth
        onClick={() => setRunning(true)}
        disabled={running}
        className="max-w-xs"
      >
        {running ? '⏳ Running…' : '🔒 Lock In'}
      </Button>
    </div>
  )
}
