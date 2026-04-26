import { useRef, useState, useCallback, useEffect } from 'react'
import { useDistractionDetection } from './useDistractionDetection'
import type { LoadingState } from './useDistractionDetection'
import { apiPost } from '../api/client'
import type { DistractionCategory, DistractionStatus } from '../utils/distractionAnalyzer'

export type PermissionStatus = 'prompt' | 'granted' | 'denied'
export type BreakReason = 'restroom' | 'drink' | 'stretch' | 'call' | 'meal' | 'break'

export interface DistractionEvent {
  id: number
  category: DistractionCategory
  stage: 'warning' | 'distracted'
  timestamp: number
}

export interface CameraMonitorState {
  permission: PermissionStatus
  active: boolean
  strikes: number
  events: DistractionEvent[]
  currentStatus: DistractionStatus
  loadingState: LoadingState
  loadingStep: number
  errorMessage: string | null
  breakUntil: number | null
  breakRemaining: number
  streamRef: React.MutableRefObject<MediaStream | null>
  setDisplayCanvas: (canvas: HTMLCanvasElement | null) => void
  startCamera: () => Promise<void>
  stopCamera: () => void
  startBreak: (durationMs: number, reason: BreakReason) => void
  endBreak: () => void
  handleWarning: (cat: DistractionCategory) => void
  handleStrike: (cat: DistractionCategory) => void
  handleExternalStrike: (cat: DistractionCategory) => void
}

export function useCameraMonitor(token: string | null): CameraMonitorState {
  // Off-DOM elements — never rendered, purely for inference
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (bgVideoRef.current === null) {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    bgVideoRef.current = v
  }
  if (bgCanvasRef.current === null) bgCanvasRef.current = document.createElement('canvas')

  // The canvas detection actually draws to — defaults to bgCanvas (off-DOM),
  // but DistractionMonitor can redirect it to a visible overlay canvas.
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (activeCanvasRef.current === null) activeCanvasRef.current = bgCanvasRef.current

  const setDisplayCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    activeCanvasRef.current = canvas ?? bgCanvasRef.current
  }, [])

  const streamRef = useRef<MediaStream | null>(null)
  const eventIdRef = useRef(0)
  // Tracks whether the camera is active — read by handleWarning/handleStrike
  // to decide whether to dispatch browser events for extension notifications.
  const activeRef = useRef(false)

  const [permission, setPermission] = useState<PermissionStatus>('prompt')
  const [active, setActive] = useState(false)
  const [strikes, setStrikes] = useState(0)
  const [events, setEvents] = useState<DistractionEvent[]>([])

  const breakUntilRef = useRef<number | null>(null)
  const breakReasonRef = useRef<BreakReason | null>(null)
  const [breakUntil, setBreakUntilState] = useState<number | null>(null)
  const [breakRemaining, setBreakRemaining] = useState(0)

  // Keep activeRef in sync
  useEffect(() => { activeRef.current = active }, [active])

  function _setBreakUntil(ts: number | null) {
    breakUntilRef.current = ts
    setBreakUntilState(ts)
  }

  const endBreak = useCallback(() => {
    breakReasonRef.current = null
    _setBreakUntil(null)
    setBreakRemaining(0)
  }, [])

  const startBreak = useCallback((durationMs: number, reason: BreakReason) => {
    const until = Date.now() + durationMs
    breakUntilRef.current = until
    breakReasonRef.current = reason
    setBreakUntilState(until)
    setBreakRemaining(Math.ceil(durationMs / 1000))
  }, [])

  useEffect(() => {
    if (!breakUntil) return
    const id = setInterval(() => {
      const rem = Math.max(0, Math.ceil((breakUntil - Date.now()) / 1000))
      setBreakRemaining(rem)
      if (rem === 0) {
        breakUntilRef.current = null
        setBreakUntilState(null)
      }
    }, 500)
    return () => clearInterval(id)
  }, [breakUntil])

  function addEvent(category: DistractionCategory, stage: 'warning' | 'distracted') {
    setEvents(prev =>
      [{ id: ++eventIdRef.current, category, stage, timestamp: Date.now() }, ...prev].slice(0, 20),
    )
  }

  const handleWarning = useCallback((cat: DistractionCategory) => {
    if (breakUntilRef.current && Date.now() < breakUntilRef.current) return
    addEvent(cat, 'warning')
    if (activeRef.current) {
      window.dispatchEvent(new CustomEvent('snitch-alert', { detail: { alertType: 'warning', category: cat } }))
    }
  }, [])

  const handleStrike = useCallback((cat: DistractionCategory) => {
    const onBreak = breakUntilRef.current !== null && Date.now() < breakUntilRef.current
    if (onBreak) {
      if (cat === 'out_of_frame') return
      if (cat === 'phone_detected' && breakReasonRef.current === 'call') return
      breakUntilRef.current = null
      breakReasonRef.current = null
      setBreakUntilState(null)
    }
    setStrikes(s => s + 1)
    addEvent(cat, 'distracted')
    if (activeRef.current) {
      window.dispatchEvent(new CustomEvent('snitch-alert', { detail: { alertType: 'strike', category: cat } }))
    }
    if (token) {
      apiPost('/sessions/report-distraction', { hostname: cat, url: `snitch://distraction/${cat}` }, token)
        .catch(() => {})
    }
  }, [token])

  // For extension-detected distractions: updates UI state without posting to backend
  // (the extension already posted directly).
  const handleExternalStrike = useCallback((cat: DistractionCategory) => {
    const onBreak = breakUntilRef.current !== null && Date.now() < breakUntilRef.current
    if (onBreak) {
      breakUntilRef.current = null
      breakReasonRef.current = null
      setBreakUntilState(null)
    }
    setStrikes(s => s + 1)
    addEvent(cat, 'distracted')
  }, [])

  const { loadingState, loadingStep, errorMessage, currentStatus } = useDistractionDetection({
    active,
    videoRef: bgVideoRef,
    canvasRef: activeCanvasRef,
    onWarning: handleWarning,
    onStrike: handleStrike,
  })

  const startCamera = useCallback(async () => {
    if (streamRef.current) return
    setStrikes(0)
    setEvents([])
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      const video = bgVideoRef.current!
      video.srcObject = stream
      await video.play()
      const canvas = bgCanvasRef.current!
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      setPermission('granted')
      setActive(true)
    } catch {
      setPermission('denied')
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (bgVideoRef.current) bgVideoRef.current.srcObject = null
    setActive(false)
    endBreak()
  }, [endBreak])

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  return {
    permission,
    active,
    strikes,
    events,
    currentStatus,
    loadingState,
    loadingStep,
    errorMessage,
    breakUntil,
    breakRemaining,
    streamRef,
    setDisplayCanvas,
    startCamera,
    stopCamera,
    startBreak,
    endBreak,
    handleWarning,
    handleStrike,
    handleExternalStrike,
  }
}
