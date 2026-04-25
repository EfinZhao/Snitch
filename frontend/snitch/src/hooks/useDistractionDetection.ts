import { useState, useRef, useEffect, useCallback } from 'react'
import type { RefObject } from 'react'
import type {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
  ObjectDetector,
  FaceLandmarkerResult,
  HandLandmarkerResult,
  PoseLandmarkerResult,
  ObjectDetectorResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import {
  analyzeFrame,
  createAnalyzerState,
  type DistractionCategory,
  type DistractionStatus,
  type AnalyzerState,
} from '../utils/distractionAnalyzer'

export type LoadingState = 'idle' | 'loading' | 'ready' | 'error'

interface Models {
  face: FaceLandmarker
  hand: HandLandmarker
  pose: PoseLandmarker
  object: ObjectDetector
}

interface Options {
  active: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  onWarning?: (category: DistractionCategory) => void
  onStrike?: (category: DistractionCategory) => void
}

interface Result {
  loadingState: LoadingState
  loadingStep: number    // 0–4: how many models have finished loading
  errorMessage: string | null
  currentStatus: DistractionStatus
}

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models'

// Throttle inference to ~10 fps
const INFERENCE_INTERVAL_MS = 100

// ── Canvas drawing ────────────────────────────────────────────────────────────

const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
]

const POSE_CONNECTIONS: [number, number][] = [
  [11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],
]

function drawHand(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], W: number, H: number) {
  ctx.strokeStyle = 'rgba(160,202,248,0.85)'
  ctx.lineWidth = 1.5
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath()
    ctx.moveTo(lm[a].x * W, lm[a].y * H)
    ctx.lineTo(lm[b].x * W, lm[b].y * H)
    ctx.stroke()
  }
  ctx.fillStyle = '#335f87'
  for (const p of lm) {
    ctx.beginPath()
    ctx.arc(p.x * W, p.y * H, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawIris(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], W: number, H: number) {
  if (lm.length < 474) return
  ctx.fillStyle = '#335f87'
  for (const idx of [468, 473]) {
    ctx.beginPath()
    ctx.arc(lm[idx].x * W, lm[idx].y * H, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawPose(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], W: number, H: number) {
  ctx.strokeStyle = 'rgba(207,229,255,0.75)'
  ctx.lineWidth = 2
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!lm[a] || !lm[b]) continue
    ctx.beginPath()
    ctx.moveTo(lm[a].x * W, lm[a].y * H)
    ctx.lineTo(lm[b].x * W, lm[b].y * H)
    ctx.stroke()
  }
  ctx.fillStyle = '#4e78a1'
  for (const idx of [11,12,13,14,15,16]) {
    if (!lm[idx]) continue
    ctx.beginPath()
    ctx.arc(lm[idx].x * W, lm[idx].y * H, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawObjects(ctx: CanvasRenderingContext2D, result: ObjectDetectorResult) {
  for (const det of result.detections) {
    const cat = det.categories[0]
    const box = det.boundingBox
    if (!box) continue
    const { originX, originY, width, height } = box
    // Normalize if necessary (ObjectDetector may return pixel or normalized coords
    // depending on runningMode; in VIDEO mode it returns pixel coords)
    const isPhone = cat.categoryName === 'cell phone'
    ctx.strokeStyle = isPhone ? '#ef4444' : 'rgba(114,119,127,0.7)'
    ctx.lineWidth = isPhone ? 2.5 : 1.5
    ctx.strokeRect(originX, originY, width, height)
    ctx.fillStyle = isPhone ? '#ef4444' : '#72777f'
    ctx.font = 'bold 11px sans-serif'
    ctx.fillText(
      `${cat.categoryName} ${Math.round(cat.score * 100)}%`,
      originX + 4,
      Math.max(originY - 4, 14),
    )
  }
}

function drawResults(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  face: FaceLandmarkerResult,
  hand: HandLandmarkerResult,
  pose: PoseLandmarkerResult,
  objects: ObjectDetectorResult,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (canvas.width !== video.videoWidth)   canvas.width  = video.videoWidth
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  for (const lm of pose.landmarks) drawPose(ctx, lm, W, H)
  for (const lm of hand.landmarks) drawHand(ctx, lm, W, H)
  for (const lm of face.faceLandmarks) drawIris(ctx, lm, W, H)
  drawObjects(ctx, objects)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDistractionDetection({ active, videoRef, canvasRef, onWarning, onStrike }: Options): Result {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [loadingStep, setLoadingStep]   = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<DistractionStatus>('focused')

  const modelsRef       = useRef<Models | null>(null)
  const rafRef          = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyzerState   = useRef<AnalyzerState>(createAnalyzerState())
  const activeRef       = useRef(active)

  // Keep callback refs stable so the RAF loop never captures stale closures
  const onWarningRef = useRef(onWarning)
  const onStrikeRef  = useRef(onStrike)
  useEffect(() => { onWarningRef.current = onWarning }, [onWarning])
  useEffect(() => { onStrikeRef.current  = onStrike  }, [onStrike])

  useEffect(() => { activeRef.current = active }, [active])

  // ── Model loading ──────────────────────────────────────────────────────────

  const loadModels = useCallback(async () => {
    if (modelsRef.current) return
    setLoadingState('loading')
    setLoadingStep(0)
    try {
      const { FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker, ObjectDetector } =
        await import('@mediapipe/tasks-vision')

      const vision = await FilesetResolver.forVisionTasks(WASM_CDN)

      const face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
      })
      setLoadingStep(1)

      const hand = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      })
      setLoadingStep(2)

      const pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
      setLoadingStep(3)

      const object = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.4,
        maxResults: 5,
      })
      setLoadingStep(4)

      modelsRef.current = { face, hand, pose, object }
      setLoadingState('ready')
    } catch (err) {
      setLoadingState('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load AI models')
    }
  }, [])

  // ── Inference loop ─────────────────────────────────────────────────────────
  // Uses setInterval instead of requestAnimationFrame so inference continues
  // even when the tab is in the background (RAF is frozen by browsers in hidden tabs).

  const runInference = useCallback(() => {
    if (!activeRef.current) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    const models = modelsRef.current

    if (!video || !canvas || !models) return
    if (video.paused || video.ended || video.readyState < 2) return

    const ts = performance.now()

    let face:   FaceLandmarkerResult
    let hand:   HandLandmarkerResult
    let pose:   PoseLandmarkerResult
    let object: ObjectDetectorResult

    try {
      face   = models.face.detectForVideo(video, ts)
      hand   = models.hand.detectForVideo(video, ts)
      pose   = models.pose.detectForVideo(video, ts)
      object = models.object.detectForVideo(video, ts)
    } catch {
      return
    }

    const { newWarnings, newStrikes, currentStatus: status } =
      analyzeFrame(face, pose, object, analyzerState.current)

    setCurrentStatus(status)

    for (const cat of newWarnings) onWarningRef.current?.(cat)
    for (const cat of newStrikes)  onStrikeRef.current?.(cat)

    // Skip canvas drawing in background — inference still runs, just no visual output
    if (document.visibilityState === 'visible') {
      drawResults(canvas, video, face, hand, pose, object)
    }
  }, [videoRef, canvasRef])

  // ── Effect: start/stop loop ────────────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        clearInterval(rafRef.current)
        rafRef.current = null
      }
      setCurrentStatus('focused')

      // Clear canvas
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

      return
    }

    // Load models on first activation, then start loop
    if (!modelsRef.current) {
      loadModels().then(() => {
        if (activeRef.current) {
          rafRef.current = setInterval(runInference, INFERENCE_INTERVAL_MS)
        }
      })
    } else {
      rafRef.current = setInterval(runInference, INFERENCE_INTERVAL_MS)
    }

    return () => {
      if (rafRef.current !== null) {
        clearInterval(rafRef.current)
        rafRef.current = null
      }
    }
  }, [active, loadModels, runInference, canvasRef])

  return { loadingState, loadingStep, errorMessage, currentStatus }
}
