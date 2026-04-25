// Runs as a Web Worker — isolated JS context keeps ONNX Runtime's IDB
// lifecycle completely separate from the main thread and React's component lifecycle.

type InMsg =
  | { type: 'load' }
  | { type: 'classify'; id: number; text: string; labels: string[] }

type OutMsg =
  | { type: 'ready' }
  | { type: 'result'; id: number; labels: string[]; scores: number[] }
  | { type: 'error'; id?: number; message: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let classifier: ((text: string, labels: string[], opts?: object) => Promise<any>) | null = null

self.onmessage = async ({ data }: MessageEvent<InMsg>) => {
  if (data.type === 'load') {
    try {
      const { pipeline, env } = await import('@xenova/transformers')
      env.useBrowserCache = false
      classifier = await pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-small') as typeof classifier
      self.postMessage({ type: 'ready' } satisfies OutMsg)
    } catch (e) {
      self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies OutMsg)
    }
    return
  }

  if (data.type === 'classify') {
    const { id, text, labels } = data
    try {
      if (!classifier) throw new Error('Model not loaded')
      const raw = await classifier(text, labels, { multi_label: false })
      // pipeline may return a single result or an array — normalise to one object
      const result = Array.isArray(raw) ? raw[0] : raw
      self.postMessage({ type: 'result', id, labels: result.labels, scores: result.scores } satisfies OutMsg)
    } catch (e) {
      self.postMessage({ type: 'error', id, message: e instanceof Error ? e.message : String(e) } satisfies OutMsg)
    }
  }
}
