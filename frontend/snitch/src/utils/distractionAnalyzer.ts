import type {
  FaceLandmarkerResult,
  PoseLandmarkerResult,
  ObjectDetectorResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export type DistractionCategory = 'out_of_frame' | 'phone_detected' | 'looking_away'
export type DistractionStatus = 'focused' | 'warning' | 'distracted'

type CategoryStatus = 'idle' | 'warning' | 'distracted'

interface CategoryState {
  status: CategoryStatus
  warningSince: number
  warningThresholdMs: number
  cooldownUntil: number
}

export interface AnalyzerState {
  categories: Record<DistractionCategory, CategoryState>
  outOfFrameCount: number
  lookingAwayWarningCount: number   // consecutive 3-second look-away windows
}

export interface AnalyzerResult {
  newWarnings: DistractionCategory[]
  newStrikes: DistractionCategory[]
  currentStatus: DistractionStatus
}

const CATEGORIES: DistractionCategory[] = ['out_of_frame', 'phone_detected', 'looking_away']

// How long after a strike before the same category can warn/strike again
const STRIKE_COOLDOWN_MS = 15_000
const PHONE_COOLDOWN_MS  = 10_000  // phone strikes are instant but debounced tighter

// How many consecutive frames of no face/pose before triggering out_of_frame
const OUT_OF_FRAME_FRAMES = 5
const LOOKING_AWAY_WARNING_FRAMES = 3

function defaultCategoryState(): CategoryState {
  return { status: 'idle', warningSince: 0, warningThresholdMs: 0, cooldownUntil: 0 }
}

export function createAnalyzerState(): AnalyzerState {
  return {
    categories: {
      out_of_frame:  defaultCategoryState(),
      phone_detected: defaultCategoryState(),
      looking_away:  defaultCategoryState(),
    },
    outOfFrameCount: 0,
    lookingAwayWarningCount: 0,
  }
}

// Random 5–10 second threshold so users can't time-game the warning window
function randomThresholdMs(): number {
  return 5_000 + Math.random() * 5_000
}

// ── Detection logic ──────────────────────────────────────────────────────────

function isOutOfFrame(
  face: FaceLandmarkerResult,
  pose: PoseLandmarkerResult,
  state: AnalyzerState,
): boolean {
  if (face.faceLandmarks.length === 0 && pose.landmarks.length === 0) {
    state.outOfFrameCount = Math.min(state.outOfFrameCount + 1, OUT_OF_FRAME_FRAMES + 1)
  } else {
    state.outOfFrameCount = 0
  }
  return state.outOfFrameCount >= OUT_OF_FRAME_FRAMES
}

function isPhoneDetected(objects: ObjectDetectorResult): boolean {
  return objects.detections.some(d =>
    d.categories.some(c => c.categoryName === 'cell phone' && c.score > 0.5)
  )
}

// MediaPipe FaceLandmarker key indices
// 1   = nose tip
// 33  = left eye outer corner  (camera-left = person's right)
// 133 = left eye inner corner
// 263 = right eye outer corner (camera-right = person's left)
// 362 = right eye inner corner
// 468 = left iris center  (only present in 478-point model)
// 473 = right iris center
function isLookingAway(face: FaceLandmarkerResult): boolean {
  const lm: NormalizedLandmark[] | undefined = face.faceLandmarks[0]
  if (!lm || lm.length < 10) return false

  // ── Head yaw: nose tip should be roughly centered between the two eye outer corners ──
  // When the face turns sideways the nose shifts toward one eye.
  const nose = lm[1]
  const eyeL = lm[33]
  const eyeR = lm[263]

  const eyeMinX = Math.min(eyeL.x, eyeR.x)
  const eyeSpan = Math.abs(eyeL.x - eyeR.x)
  if (eyeSpan < 0.02) return false  // face too small / edge case

  // 0 = nose over left eye, 1 = nose over right eye, ~0.5 = frontal
  const yawRatio = (nose.x - eyeMinX) / eyeSpan
  if (yawRatio < 0.22 || yawRatio > 0.78) return true  // head significantly turned

  // ── Iris offset within the eye socket ────────────────────────────────────────
  // Requires the 478-point iris-refined model.
  if (lm.length < 478) return false

  const leftIris  = lm[468]
  const rightIris = lm[473]
  const leftInner  = lm[133]
  const rightInner = lm[362]

  const leftSpan  = Math.abs(eyeL.x - leftInner.x)
  const rightSpan = Math.abs(eyeR.x - rightInner.x)

  // Normalised horizontal offset: 0 = centred, 1 = fully at corner
  const leftOffset  = leftSpan  > 0.005 ? Math.abs(leftIris.x  - (eyeL.x + leftInner.x)  / 2) / leftSpan  : 0
  const rightOffset = rightSpan > 0.005 ? Math.abs(rightIris.x - (eyeR.x + rightInner.x) / 2) / rightSpan : 0

  // Require both eyes to agree — one eye alone could be noise or occlusion
  return leftOffset > 0.42 && rightOffset > 0.42
}

function isLookingAwayStrike(state: AnalyzerState): boolean {
  return state.lookingAwayWarningCount >= LOOKING_AWAY_WARNING_FRAMES
}


// ── State machine ────────────────────────────────────────────────────────────

function advanceCategory(
  cat: DistractionCategory,
  detected: boolean,
  state: AnalyzerState,
  now: number,
  result: AnalyzerResult,
) {
  const s = state.categories[cat]

  if (!detected) {
    // Keep the phone cooldown running even if detection flickers off for a frame,
    // otherwise a brief detection gap resets the state and the next frame fires another instant strike.
    if (s.status === 'distracted' && now < s.cooldownUntil) return
    s.status = 'idle'
    // Reset looking away counter when not detecting
    if (cat === 'looking_away') {
      state.lookingAwayWarningCount = 0
    }
    return
  }

  // Still serving post-strike cooldown — ignore continued detection
  if (s.status === 'distracted') {
    if (now < s.cooldownUntil) return
    s.status = 'idle'  // cooldown expired, allow a new cycle
  }

  if (s.status === 'idle') {
    if (cat === 'phone_detected') {
      // Phone skips the warning stage — instant strike
      s.status = 'distracted'
      s.cooldownUntil = now + PHONE_COOLDOWN_MS
      result.newStrikes.push(cat)
    } else {
      s.status = 'warning'
      s.warningSince = now
      s.warningThresholdMs = randomThresholdMs()
      result.newWarnings.push(cat)
      
      // Increment looking away warning count
      if (cat === 'looking_away') {
        state.lookingAwayWarningCount++
      }
    }
    return
  }

  if (s.status === 'warning') {
    // For looking_away, check if we've hit the 3-warning threshold
    if (cat === 'looking_away' && state.lookingAwayWarningCount >= LOOKING_AWAY_WARNING_FRAMES) {
      s.status = 'distracted'
      s.cooldownUntil = now + STRIKE_COOLDOWN_MS
      state.lookingAwayWarningCount = 0  // Reset after strike
      result.newStrikes.push(cat)
      return
    }
    
    // Standard warning timeout for other categories
    if (now - s.warningSince >= s.warningThresholdMs) {
      s.status = 'distracted'
      s.cooldownUntil = now + STRIKE_COOLDOWN_MS
      result.newStrikes.push(cat)
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function analyzeFrame(
  face: FaceLandmarkerResult,
  pose: PoseLandmarkerResult,
  objects: ObjectDetectorResult,
  state: AnalyzerState,
): AnalyzerResult {
  const now = Date.now()
  const result: AnalyzerResult = { newWarnings: [], newStrikes: [], currentStatus: 'focused' }

  const outOfFrame = isOutOfFrame(face, pose, state)

  const detected: Record<DistractionCategory, boolean> = {
    out_of_frame:  outOfFrame,
    phone_detected: isPhoneDetected(objects),
    looking_away:  !outOfFrame && isLookingAway(face),
  }

  for (const cat of CATEGORIES) {
    advanceCategory(cat, detected[cat], state, now, result)
  }

  const cats = state.categories
  const hasDistracted = CATEGORIES.some(c => cats[c].status === 'distracted')
  const hasWarning    = CATEGORIES.some(c => cats[c].status === 'warning')
  result.currentStatus = hasDistracted ? 'distracted' : hasWarning ? 'warning' : 'focused'

  return result
}
