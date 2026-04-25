import { useState, useEffect, useRef } from 'react'
import Button from '../atoms/Button'
import { apiPost, apiGet, apiPatch, ApiError } from '../../api/client'
import { useDistractionDetection } from '../../hooks/useDistractionDetection'
import type { Screen, UserProfile, StakeRead } from '../../types'

const DEFAULT_SECONDS = 25 * 60
const CX = 124, CY = 124, R = 112
const SYNC_INTERVAL_MS = 30_000

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '00')}`
}

function parseInput(raw: string): number | null {
  const minutes = parseFloat(raw.trim())
  if (isNaN(minutes) || minutes <= 0) return null
  return Math.round(minutes * 60)
}

function fractionToPoint(fraction: number) {
  const angle = -fraction * 2 * Math.PI
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) }
}

function trianglePoints(cx: number, cy: number, size = 7): string {
  const inward = Math.sqrt((cx - CX) ** 2 + (cy - CY) ** 2)
  const nx = (CX - cx) / inward
  const ny = (CY - cy) / inward
  const px = -ny, py = nx
  const tip = { x: cx + nx * size * 1.2, y: cy + ny * size * 1.2 }
  const l   = { x: cx + px * size, y: cy + py * size }
  const r   = { x: cx - px * size, y: cy - py * size }
  return `${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`
}

type Recipient = { username: string }
type SearchResult = { id: number; username: string }

interface Props {
  navigate: (screen: Screen) => void
  token: string
  user: UserProfile
}

export default function FocusDashboard({ token, user }: Props) {
  const [totalSeconds, setTotalSeconds] = useState(DEFAULT_SECONDS)
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const committingRef = useRef(false)

  const [distractions, setDistractions] = useState<number[]>([])

  // Stakes / session
  const [amount, setAmount] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [stakeId, setStakeId] = useState<number | null>(null)
  const [locking, setLocking] = useState(false)
  const [lockError, setLockError] = useState('')

  // Add recipient modal
  const [showModal, setShowModal] = useState(false)
  const [recipientInput, setRecipientInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Distraction detection
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const { currentStatus } = useDistractionDetection({
    active: running,
    videoRef,
    canvasRef,
    onStrike: (category) => injectDistraction(category),
  })

  // ── Camera: start when session starts, stop when it ends ───────────────
  useEffect(() => {
    const video = videoRef.current // capture so cleanup uses the same node
    if (!running) {
      if (video?.srcObject) {
        ;(video.srcObject as MediaStream).getTracks().forEach(t => t.stop())
        video.srcObject = null
      }
      return
    }
    let cancelled = false
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } })
      .then(s => {
        stream = s
        if (cancelled || !videoRef.current) { s.getTracks().forEach(t => t.stop()); return }
        videoRef.current.srcObject = s
        videoRef.current.play().catch(() => {})
      })
      .catch(() => {}) // camera denied — tracker silently disabled
    return () => {
      cancelled = true
      stream?.getTracks().forEach(t => t.stop())
      if (video) video.srcObject = null
    }
  }, [running])

  // ── Timer tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (running && seconds > 0) {
      intervalRef.current = setInterval(() => setSeconds(s => s - 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, seconds])

  // ── Auto-resolve when timer reaches 0 ──────────────────────────────────
  useEffect(() => {
    if (!running || seconds !== 0 || stakeId === null) return
    const id = stakeId
    const elapsed = totalSeconds
    /* eslint-disable react-hooks/set-state-in-effect */
    setRunning(false)
    setStakeId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    apiPost(`/stakes/${id}/resolve`, { outcome: 'completed', elapsed_seconds: elapsed }, token)
      .catch(() => {})
  }, [running, seconds, stakeId, totalSeconds, token])

  // ── Periodic progress sync to backend ──────────────────────────────────
  useEffect(() => {
    if (!running || stakeId === null) return
    const id = setInterval(() => {
      const elapsed = totalSeconds - seconds
      apiPatch(`/stakes/${stakeId}`, {
        distraction_count: distractions.length,
        elapsed_seconds: elapsed,
      }, token).catch(() => {})
    }, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [running, stakeId, distractions.length, seconds, totalSeconds, token])

  // ── Time editing ────────────────────────────────────────────────────────
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
    if (e.key === 'Escape') { committingRef.current = true; setEditing(false); setInputVal('') }
  }

  function injectDistraction(category: import('../../utils/distractionAnalyzer').DistractionCategory = 'looking_away') {
    const elapsed = (totalSeconds - seconds) / totalSeconds
    if (stakeId !== null) {
      apiPost<void>('/stakes/report-distraction', { hostname: category, url: `snitch://distraction/${category}` }, token).catch(() => {})
    }
    setDistractions(prev => [...prev, elapsed])
  }

  // ── Recipient search ────────────────────────────────────────────────────
  function openModal() { setRecipientInput(''); setSearchResults([]); setShowModal(true) }
  function closeModal() { setShowModal(false); setRecipientInput(''); setSearchResults([]) }

  function handleRecipientInputChange(val: string) {
    const clean = val.replace(/\s/g, '')
    setRecipientInput(clean)

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (clean.length < 1) { setSearchResults([]); return }

    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await apiGet<SearchResult[]>(`/users/search?q=${encodeURIComponent(clean)}`, token)
        // Filter out self and already-added recipients
        setSearchResults(results.filter(
          r => r.username !== user.username && !recipients.some(rec => rec.username === r.username)
        ))
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  // Only allow adding users that appeared in search results — prevents adding
  // non-existent users and enforces self-exclusion at the search level.
  function addRecipient(username: string) {
    const clean = username.trim().replace(/^@/, '')
    if (!clean) return
    const found = searchResults.find(r => r.username.toLowerCase() === clean.toLowerCase())
    if (!found) return
    if (!recipients.some(r => r.username.toLowerCase() === clean.toLowerCase())) {
      setRecipients(prev => [...prev, { username: found.username }])
    }
    closeModal()
  }

  function removeRecipient(username: string) {
    setRecipients(prev => prev.filter(r => r.username !== username))
  }

  // ── Lock In → create + activate stake ──────────────────────────────────
  async function handleLockIn() {
    setLockError('')
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setLockError('Enter an amount greater than $0.')
      return
    }
    if (recipients.length === 0) {
      setLockError('Add at least one recipient.')
      return
    }

    const amount_cents = Math.round(amountNum * 100)
    setLocking(true)
    try {
      const stake = await apiPost<StakeRead>('/stakes', {
        amount_cents,
        duration_seconds: totalSeconds,
        recipient_usernames: recipients.map(r => r.username),
      }, token)
      await apiPost<StakeRead>(`/stakes/${stake.id}/activate`, {}, token)
      setStakeId(stake.id)
      setRunning(true)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) setLockError(err.message)
        else if (err.status === 404) setLockError('One or more recipients not found.')
        else setLockError('Could not start session. Try again.')
      } else {
        setLockError('Could not reach the server.')
      }
    } finally {
      setLocking(false)
    }
  }

  const circumference = 2 * Math.PI * R
  const elapsed = (totalSeconds - seconds) / totalSeconds

  // Arc color reflects live distraction status
  const arcColor = currentStatus === 'distracted'
    ? '#ef4444'
    : currentStatus === 'warning'
      ? '#eab308'
      : 'var(--color-primary-fixed-dim)'

  const canAddRecipient = searchResults.some(
    r => r.username.toLowerCase() === recipientInput.trim().toLowerCase()
  )

  return (
    <div className="flex flex-col items-center px-6 py-6 gap-5">
      {/* Hidden camera feed for distraction detection */}
      <video ref={videoRef} width={640} height={480} playsInline muted className="hidden" />
      <canvas ref={canvasRef} width={640} height={480} className="hidden" />

      <br />

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
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={arcColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={elapsed * circumference}
            style={{ transition: 'stroke 0.4s ease' }}
          />
          {distractions.map((fraction, i) => {
            const pt = fractionToPoint(fraction)
            return (
              <polygon key={i} points={trianglePoints(pt.x, pt.y)} fill="#ef4444" />
            )
          })}
        </svg>

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
            {editing
              ? 'minutes'
              : distractions.length > 0
                ? `${distractions.length} distraction${distractions.length > 1 ? 's' : ''}`
                : running && currentStatus === 'warning'
                  ? '⚠ warning'
                  : '• • •'}
          </span>
        </div>
      </div>

      <br />

      {/* Stakes section */}
      <div className="flex flex-col items-center gap-3 w-full">
        <div className="flex items-center gap-1 border-b border-outline-variant pb-1">
          <span className="font-display text-base text-on-surface-variant">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={running}
            className="bg-transparent font-display font-semibold text-lg text-on-surface w-20 text-center outline-none placeholder:text-outline-variant tabular-nums disabled:opacity-50"
          />
          <span className="font-display text-base text-on-surface-variant">on the line</span>
        </div>

        <br />

        <div className="font-display text-base">Recipients</div>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {recipients.map(({ username }) => (
            <button
              key={username}
              onClick={() => { if (!running) removeRecipient(username) }}
              title={running ? `@${username}` : `@${username} — tap to remove`}
              className="w-15 h-15 rounded-full border-2 border-primary bg-primary-fixed flex items-center justify-center text-xs font-display font-semibold text-primary flex-shrink-0"
            >
              {username.slice(0, 2).toUpperCase()}
            </button>
          ))}
          {!running && (
            <button
              onClick={openModal}
              className="w-15 h-15 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center text-lg text-on-surface-variant hover:border-primary hover:text-primary transition-colors flex-shrink-0"
            >
              +
            </button>
          )}
        </div>
      </div>

      <br />

      {lockError && (
        <p className="font-body text-sm text-error text-center w-full max-w-xs">{lockError}</p>
      )}

      {running ? (
        <div className="flex items-center justify-center gap-2 w-full max-w-xs py-3 font-body text-sm text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-error animate-pulse flex-shrink-0" />
          Session in progress — stay focused
        </div>
      ) : (
        <Button
          variant="primary"
          fullWidth
          onClick={handleLockIn}
          disabled={locking}
          className="max-w-xs"
        >
          {locking ? 'Starting…' : '🔒 Lock In'}
        </Button>
      )}

      {import.meta.env.DEV && running && (
        <button
          onClick={() => injectDistraction()}
          className="text-xs text-error border border-error rounded px-3 py-1 opacity-60 hover:opacity-100 transition-opacity"
        >
          [dev] distracted
        </button>
      )}

      {/* Add recipient modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-72 bg-surface rounded-2xl px-6 pt-6 pb-6 flex flex-col gap-4 shadow-xl">
            <h2 className="font-display font-semibold text-xl text-on-surface">Add Recipient</h2>

            <div className="flex items-center gap-2 border-b-2 border-primary pb-2">
              <span className="font-body text-on-surface-variant">@</span>
              <input
                ref={el => { el?.focus() }}
                type="text"
                placeholder="username"
                value={recipientInput}
                onChange={e => handleRecipientInputChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addRecipient(recipientInput)
                  if (e.key === 'Escape') closeModal()
                }}
                className="flex-1 bg-transparent font-body text-lg text-on-surface outline-none placeholder:text-outline-variant"
              />
              {searching && (
                <svg className="animate-spin text-primary flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              )}
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto -mx-2">
                {searchResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => addRecipient(r.username)}
                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-fixed border border-primary flex items-center justify-center text-xs font-display font-semibold text-primary flex-shrink-0">
                      {r.username.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-body text-sm text-on-surface">@{r.username}</span>
                  </button>
                ))}
              </div>
            )}

            {recipientInput.trim() && !searching && searchResults.length === 0 && (
              <p className="font-body text-xs text-on-surface-variant text-center">
                No users found.
              </p>
            )}

            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={closeModal}>Cancel</Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => addRecipient(recipientInput)}
                disabled={!canAddRecipient}
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
