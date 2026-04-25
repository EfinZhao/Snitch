import { useState, useEffect, useRef } from 'react'
import Button from '../atoms/Button'
import type { Screen } from '../../types'

const DEFAULT_SECONDS = 25 * 60
const CX = 124, CY = 124, R = 112

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function parseInput(raw: string): number | null {
  const minutes = parseFloat(raw.trim())
  if (isNaN(minutes) || minutes <= 0) return null
  return Math.round(minutes * 60)
}

// fraction 0→1 maps to a point on the arc in the SVG's transformed space
// SVG has rotate(-90deg) scaleX(-1), so fraction 0 = top, clockwise
function fractionToPoint(fraction: number) {
  // In the SVG local space (after rotate -90 + scaleX -1):
  // angle 0 = right in standard coords → top after rotate(-90) → top after scaleX(-1)
  // Going clockwise means increasing angle in this mirrored space
  const angle = -fraction * 2 * Math.PI
  return {
    x: CX + R * Math.cos(angle),
    y: CY + R * Math.sin(angle),
  }
}

// Returns SVG polygon points for a triangle on the arc pointing toward center
function trianglePoints(cx: number, cy: number, size = 7): string {
  const inward = Math.sqrt((cx - CX) ** 2 + (cy - CY) ** 2)
  const nx = (CX - cx) / inward  // unit vector toward center
  const ny = (CY - cy) / inward
  const px = -ny, py = nx        // perpendicular
  const tip = { x: cx + nx * size * 1.2, y: cy + ny * size * 1.2 }
  const l   = { x: cx + px * size, y: cy + py * size }
  const r   = { x: cx - px * size, y: cy - py * size }
  return `${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`
}

type Recipient = { username: string }

export default function FocusDashboard({ navigate: _navigate }: { navigate: (screen: Screen) => void }) {
  const [totalSeconds, setTotalSeconds] = useState(DEFAULT_SECONDS)
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const committingRef = useRef(false)

  // distraction events stored as elapsed fraction (0=start, 1=end)
  const [distractions, setDistractions] = useState<number[]>([])

  // Stakes state
  const [amount, setAmount] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [showModal, setShowModal] = useState(false)
  const [recipientInput, setRecipientInput] = useState('')

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

  function injectDistraction() {
    const elapsed = (totalSeconds - seconds) / totalSeconds
    setDistractions(prev => [...prev, elapsed])
  }

  function openModal() { setRecipientInput(''); setShowModal(true) }
  function closeModal() { setShowModal(false); setRecipientInput('') }

  function addRecipient() {
    const username = recipientInput.trim().replace(/^@/, '')
    if (!username) return
    if (!recipients.some(r => r.username.toLowerCase() === username.toLowerCase())) {
      setRecipients(prev => [...prev, { username }])
    }
    closeModal()
  }

  function removeRecipient(username: string) {
    setRecipients(prev => prev.filter(r => r.username !== username))
  }

  function handleRecipientKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') addRecipient()
    if (e.key === 'Escape') closeModal()
  }

  const circumference = 2 * Math.PI * R
  const elapsed = (totalSeconds - seconds) / totalSeconds

  return (
    <div className="flex flex-col items-center px-6 py-6 gap-5">

      <br></br>

      {/* Clock face */}
      <div className="relative flex items-center justify-center">
        <div
          className="absolute rounded-full border-2 border-dashed border-outline-variant"
          style={{ width: '272px', height: '272px' }}
        />
        <svg
          width="248"
          height="248"
          className="absolute pointer-events-none"
          style={{ transform: 'rotate(-90deg) scaleX(1)' }}
        >
          {/* Progress arc — starts full, drains clockwise */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="var(--color-primary-fixed-dim)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={elapsed * circumference}
          />

          {/* Distraction marks — rendered in normal orientation via transform */}
          {distractions.map((fraction, i) => {
            const pt = fractionToPoint(fraction)
            return (
              <polygon
                key={i}
                points={trianglePoints(pt.x, pt.y)}
                fill="#ef4444"
              />
            )
          })}
        </svg>

        {/* Inner circle */}
        <div
          className="flex flex-col items-center justify-center rounded-full border-2 border-outline-variant bg-surface relative z-10"
          style={{ width: '208px', height: '208px' }}
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
          <span className="text-outline-variant text-xs mt-1 tracking-widest">
            {editing ? 'minutes' : distractions.length > 0 ? `${distractions.length} distraction${distractions.length > 1 ? 's' : ''}` : '• • •'}
          </span>
        </div>
      </div>

      <br></br>

      {/* Stakes section */}
      <div className="flex flex-col items-center gap-3">
        {/* Amount input */}
        <div className="flex items-center gap-1 border-b border-outline-variant pb-1">
          <span className="font-display text-base text-on-surface-variant">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="bg-transparent font-display font-semibold text-lg text-on-surface w-20 text-center outline-none placeholder:text-outline-variant tabular-nums"
          />
          <span className="font-display text-base text-on-surface-variant">on the line</span>
        </div>

        <br></br>

        {/* Recipient avatars */}
        <div className="font-display text-base">Recipients</div>
        <div className="flex items-center gap-2">
          {recipients.map(({ username }) => (
            <button
              key={username}
              onClick={() => removeRecipient(username)}
              title={`@${username} — tap to remove`}
              className="w-15 h-15 rounded-full border-2 border-primary bg-primary-fixed flex items-center justify-center text-xs font-display font-semibold text-primary flex-shrink-0"
            >
              {username.slice(0, 2).toUpperCase()}
            </button>
          ))}
          <button
            onClick={openModal}
            className="w-15 h-15 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-lg text-on-surface-variant hover:border-primary hover:text-primary transition-colors flex-shrink-0"
          >
            +
          </button>
        </div>
      </div>

      <br></br>

      <Button
        variant="primary"
        fullWidth
        onClick={() => setRunning(true)}
        disabled={running}
        className="max-w-xs"
      >
        {running ? '⏳ Running…' : '🔒 Lock In'}
      </Button>

      {/* DEV: inject distraction */}
      <button
        onClick={injectDistraction}
        className="text-xs text-error border border-error rounded px-3 py-1 opacity-60 hover:opacity-100 transition-opacity"
      >
        [dev] distracted
      </button>

      {/* Add recipient modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-72 bg-surface rounded-2xl px-6 pt-6 pb-6 flex flex-col gap-5 shadow-xl">
            <h2 className="font-display font-semibold text-xl text-on-surface">Add Recipient</h2>
            <div className="flex items-center gap-2 border-b-2 border-primary pb-2">
              <span className="font-body text-on-surface-variant">@</span>
              <input
                ref={el => { el?.focus() }}
                type="text"
                placeholder="username"
                value={recipientInput}
                onChange={e => setRecipientInput(e.target.value.replace(/\s/g, ''))}
                onKeyDown={handleRecipientKey}
                className="flex-1 bg-transparent font-body text-lg text-on-surface outline-none placeholder:text-outline-variant"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={closeModal}>Cancel</Button>
              <Button variant="primary" fullWidth onClick={addRecipient}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
