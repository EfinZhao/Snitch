import { useState, useRef, useCallback, useEffect } from 'react'

export type VoiceCommandState = 'idle' | 'listening' | 'processing' | 'error'
export type BreakReason = 'restroom' | 'drink' | 'stretch' | 'call' | 'meal' | 'break'

interface Options {
  apiKey: string
  onBreakDetected: (durationMs: number, reason: BreakReason) => void
}

interface Result {
  voiceState: VoiceCommandState
  voiceError: string | null
  nlpReady: boolean
  toggleListening: () => Promise<void>
  cancelRecording: () => void
}

// ── Web Worker bridge ─────────────────────────────────────────────────────────
// Running the NLP model in a worker keeps ONNX Runtime's IDB lifecycle
// completely isolated from the main thread and React's component lifecycle.

type WorkerOutMsg =
  | { type: 'ready' }
  | { type: 'result'; id: number; labels: string[]; scores: number[] }
  | { type: 'error'; id?: number; message: string }

let worker: Worker | null = null
let workerReady = false
const readyCallbacks: Array<() => void> = []
const errorCallbacks: Array<(msg: string) => void> = []
const pendingClassify = new Map<number, { resolve: (r: { labels: string[]; scores: number[] }) => void; reject: (e: Error) => void }>()
let nextMsgId = 0

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(
    new URL('../workers/nlpWorker.ts', import.meta.url),
    { type: 'module' },
  )

  worker.onmessage = ({ data }: MessageEvent<WorkerOutMsg>) => {
    if (data.type === 'ready') {
      workerReady = true
      readyCallbacks.splice(0).forEach(cb => cb())
    } else if (data.type === 'result') {
      const pending = pendingClassify.get(data.id)
      if (pending) { pendingClassify.delete(data.id); pending.resolve({ labels: data.labels, scores: data.scores }) }
    } else if (data.type === 'error') {
      if (data.id !== undefined) {
        const pending = pendingClassify.get(data.id)
        if (pending) { pendingClassify.delete(data.id); pending.reject(new Error(data.message)) }
      } else {
        errorCallbacks.splice(0).forEach(cb => cb(data.message))
      }
    }
  }

  worker.onerror = (e) => {
    errorCallbacks.splice(0).forEach(cb => cb(e.message ?? 'Worker error'))
  }

  return worker
}

function warmUpWorker(): Promise<void> {
  if (workerReady) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    readyCallbacks.push(resolve)
    errorCallbacks.push((msg) => reject(new Error(msg)))
    getWorker().postMessage({ type: 'load' })
  })
}

function classifyText(text: string, labels: string[]): Promise<{ labels: string[]; scores: number[] }> {
  const id = nextMsgId++
  return new Promise((resolve, reject) => {
    pendingClassify.set(id, { resolve, reject })
    getWorker().postMessage({ type: 'classify', id, text, labels })
  })
}

// ── Break categories ──────────────────────────────────────────────────────────

interface BreakCategory {
  label: string
  reason: BreakReason | null
  maxMs: number
  displayName: string
}

const BREAK_CATEGORIES: BreakCategory[] = [
  { label: 'taking a bathroom or restroom break',                       reason: 'restroom', maxMs:  5 * 60_000, displayName: 'a restroom break' },
  { label: 'getting water, coffee, or another beverage',               reason: 'drink',    maxMs:  2 * 60_000, displayName: 'getting a drink'  },
  { label: 'stretching, walking, or brief physical movement',           reason: 'stretch',  maxMs:  3 * 60_000, displayName: 'a stretch break'  },
  { label: 'taking a phone call or handling an urgent matter',          reason: 'call',     maxMs:  7 * 60_000, displayName: 'a phone call'     },
  { label: 'eating a meal or snack',                                    reason: 'meal',     maxMs: 30 * 60_000, displayName: 'a meal break'     },
  { label: 'taking a short mental rest or general break from work',     reason: 'break',    maxMs:  5 * 60_000, displayName: 'a general break'  },
  { label: 'recreational entertainment, gaming, or social media use',   reason: null,       maxMs:  0,          displayName: 'entertainment'    },
]

const CLASSIFICATION_LABELS = BREAK_CATEGORIES.map(c => c.label)
const CONFIDENCE_THRESHOLD = 0.35

// ── Duration extraction (regex — models are unreliable for numbers) ───────────

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30,
}

function extractDurationMs(text: string): number {
  const t = text.toLowerCase()
  const digitMatch = t.match(/(\d+)\s*(?:hour|hr|min|minute)/)
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10)
    return Math.max(1, n) * (/hour|hr/.test(digitMatch[0]) ? 3_600_000 : 60_000)
  }
  for (const [word, n] of Object.entries(WORD_NUMS)) {
    if (t.includes(word) && /min|hour/.test(t)) return n * 60_000
  }
  return 5 * 60_000
}

// ── Intent classification ─────────────────────────────────────────────────────

type ParseResult =
  | { ok: true;  durationMs: number; reason: BreakReason }
  | { ok: false; error: string }

async function classifyBreakRequest(transcript: string): Promise<ParseResult | null> {
  const t = transcript.trim()
  if (!t) return null

  const output = await classifyText(t, CLASSIFICATION_LABELS)
  const topLabel = output.labels[0]
  const topScore = output.scores[0]

  if (topScore < CONFIDENCE_THRESHOLD) return null

  const category = BREAK_CATEGORIES.find(c => c.label === topLabel)!

  if (category.reason === null) {
    return { ok: false, error: "Nice try — that sounds like a distraction, not a break." }
  }

  const requestedMs = extractDurationMs(transcript)
  if (requestedMs > category.maxMs) {
    const maxMins = category.maxMs / 60_000
    const reqMins = Math.round(requestedMs / 60_000)
    return { ok: false, error: `${reqMins} min is too long for ${category.displayName}. Max is ${maxMins} min.` }
  }

  return { ok: true, durationMs: requestedMs, reason: category.reason }
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

function getSupportedMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceCommand({ apiKey, onBreakDetected }: Options): Result {
  const [voiceState, setVoiceState] = useState<VoiceCommandState>('idle')
  const [voiceError, setVoiceError]   = useState<string | null>(null)
  const [nlpReady, setNlpReady]       = useState(workerReady)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const streamRef   = useRef<MediaStream | null>(null)

  const onBreakDetectedRef = useRef(onBreakDetected)
  useEffect(() => { onBreakDetectedRef.current = onBreakDetected }, [onBreakDetected])

  // Start loading the model as soon as the hook mounts
  useEffect(() => {
    if (workerReady) return
    warmUpWorker()
      .then(() => setNlpReady(true))
      .catch(() => { /* will be retried when user clicks the mic */ })
  }, [])

  useEffect(() => {
    return () => {
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const cancelRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setVoiceState('idle')
    setVoiceError(null)
  }, [])

  const toggleListening = useCallback(async () => {
    if (voiceState === 'listening') { recorderRef.current?.stop(); return }
    if (voiceState === 'processing') return

    setVoiceError(null)

    // Ensure the worker is ready before recording (handles first-click load)
    if (!workerReady) {
      try {
        await warmUpWorker()
        setNlpReady(true)
      } catch (e) {
        setVoiceError(e instanceof Error ? e.message : 'Failed to load NLP model')
        setVoiceState('error')
        return
      }
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setVoiceError('Microphone access denied')
      setVoiceState('error')
      return
    }

    streamRef.current = stream
    const mimeType = getSupportedMimeType()
    const recorder  = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder
    chunksRef.current   = []

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      streamRef.current = null

      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
      setVoiceState('processing')

      try {
        // Step 1 — transcribe via ElevenLabs Scribe
        const form = new FormData()
        form.append('file', blob, 'voice.webm')
        form.append('model_id', 'scribe_v1')

        const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: form,
        })
        if (!res.ok) throw new Error(`ElevenLabs error ${res.status}`)

        const data     = await res.json() as { text?: string }
        const transcript = data.text ?? ''

        // Step 2 — classify intent via on-device NLI model (running in Web Worker)
        const parsed = await classifyBreakRequest(transcript)

        if (parsed === null) {
          setVoiceError(
            transcript.length > 0
              ? `Not a break request: "${transcript.slice(0, 50)}"`
              : 'No speech detected — try again'
          )
          setVoiceState('error')
        } else if ('error' in parsed) {
          setVoiceError(parsed.error)
          setVoiceState('error')
        } else {
          onBreakDetectedRef.current(parsed.durationMs, parsed.reason)
          setVoiceState('idle')
        }
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Processing failed')
        setVoiceState('error')
      }
    }

    recorder.start()
    setVoiceState('listening')
  }, [voiceState, apiKey])

  return { voiceState, voiceError, nlpReady, toggleListening, cancelRecording }
}
