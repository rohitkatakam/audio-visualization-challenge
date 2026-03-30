import { useRef, useEffect } from 'react'

export interface VisualizerProps {
  frequencyData: React.RefObject<Uint8Array<ArrayBuffer>>
  timeDomainData: React.RefObject<Uint8Array<ArrayBuffer>>
  isActive: boolean
  width: number
  height: number
}

// Grid / camera constants
const GRID_COLS     = 60
const GRID_ROWS     = 120
const SCROLL_RATE   = 12      // rows per second (~10s of visible history)
const MAX_HEIGHT    = 1.8     // world units
const GRID_WIDTH    = 8       // world X: -4 to +4
const GRID_NEAR     = 1.0     // closest Z
const GRID_FAR      = 18.0    // farthest Z
const FOCAL_LENGTH  = 350     // pixels
const CAM_Y         = 1.8     // camera height above flat ground
const BG_COLOR      = '#050510'

// Speech analysis constants
const VOICE_BIN_LOW  = 2      // ~43Hz at 44100/2048 — low end of voice range
const VOICE_BIN_HIGH = 30     // ~645Hz — captures speech fundamentals + first formant
const PITCH_SCALE    = 0.80   // fraction of MAX_HEIGHT for pitch contribution
const TEXTURE_SCALE  = 0.35   // fraction of MAX_HEIGHT for waveform texture
const GAIN           = 100.0    // amplify quiet speech; raw RMS for soft voice ≈ 0.02–0.08

// Pre-computed 7-tap Gaussian kernel (sigma=2)
const GAUSS_KERNEL: Float32Array = (() => {
  const size = 7, sigma = 2.0, center = Math.floor(size / 2)
  const k = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    k[i] = Math.exp(-0.5 * ((i - center) / sigma) ** 2)
    sum += k[i]
  }
  for (let i = 0; i < size; i++) k[i] /= sum
  return k
})()

function gaussianBlur(row: Float32Array): Float32Array {
  const out = new Float32Array(GRID_COLS)
  const half = Math.floor(GAUSS_KERNEL.length / 2)
  for (let j = 0; j < GRID_COLS; j++) {
    let v = 0
    for (let k = 0; k < GAUSS_KERNEL.length; k++) {
      const idx = Math.max(0, Math.min(GRID_COLS - 1, j + k - half))
      v += row[idx] * GAUSS_KERNEL[k]
    }
    out[j] = v
  }
  return out
}

type TerrainRow = { heights: Float32Array; voicing: number }

function buildTerrainRow(freqData: Uint8Array, waveData: Uint8Array): TerrainRow {
  // Step 1: RMS (overall volume gate)
  let sumSq = 0
  for (let i = 0; i < waveData.length; i++) {
    const s = (waveData[i] - 128) / 128
    sumSq += s * s
  }
  const rms = Math.sqrt(sumSq / waveData.length)
  const gainedRms = Math.min(rms * GAIN, 1.0)

  // Step 2: Pitch via energy-weighted centroid of voice bins
  let totalE = 0, weightedBin = 0
  for (let b = VOICE_BIN_LOW; b <= VOICE_BIN_HIGH; b++) {
    const e = freqData[Math.min(b, freqData.length - 1)]
    totalE += e
    weightedBin += e * b
  }
  const centroidBin = totalE > 0
    ? weightedBin / totalE
    : (VOICE_BIN_LOW + VOICE_BIN_HIGH) / 2
  const pitchNorm = (centroidBin - VOICE_BIN_LOW) / (VOICE_BIN_HIGH - VOICE_BIN_LOW)
  // Low pitch → negative (valley), high pitch → positive (peak), gated by volume
  const pitchHeight = (pitchNorm * 2 - 1) * MAX_HEIGHT * PITCH_SCALE * gainedRms

  // Step 3: Voicing via zero-crossing rate
  let crossings = 0
  for (let i = 1; i < waveData.length; i++) {
    const prev = waveData[i - 1] - 128
    const curr = waveData[i] - 128
    if ((prev < 0 && curr >= 0) || (prev >= 0 && curr < 0)) crossings++
  }
  const zcr = crossings / waveData.length
  // Low ZCR → voiced (periodic vowels); high ZCR → unvoiced (noisy fricatives)
  const voicing = rms > 0.008 ? Math.max(0, Math.min(1, 1 - zcr * 10)) : 0

  // Step 4: Waveform texture via box-filter downsample to GRID_COLS
  const texture = new Float32Array(GRID_COLS)
  for (let j = 0; j < GRID_COLS; j++) {
    const lo = Math.floor((j / GRID_COLS) * waveData.length)
    const hi = Math.floor(((j + 1) / GRID_COLS) * waveData.length)
    let avg = 0
    for (let i = lo; i < hi; i++) avg += waveData[i]
    avg /= (hi - lo)
    texture[j] = ((avg - 128) / 128) * gainedRms * MAX_HEIGHT * TEXTURE_SCALE
  }

  // Step 5: Combine pitch offset + texture, then smooth
  const raw = new Float32Array(GRID_COLS)
  for (let j = 0; j < GRID_COLS; j++) {
    raw[j] = pitchHeight + texture[j]
  }

  return { heights: gaussianBlur(raw), voicing }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function heightToColor(height: number, voicing: number, fogAlpha: number): string {
  // Voiced palette: cyan peaks, purple valleys (existing scheme)
  let vr: number, vg: number, vb: number
  if (height > 0.3) {
    const t = (height - 0.3) / (MAX_HEIGHT - 0.3)
    if (t <= 0.8) {
      vr = 0
      vg = Math.round(lerp(68, 255, t / 0.8))
      vb = Math.round(lerp(85, 255, t / 0.8))
    } else {
      const t2 = (t - 0.8) / 0.2
      vr = Math.round(lerp(0, 255, t2))
      vg = 255
      vb = 255
    }
  } else if (height < -0.3) {
    const t = (-height - 0.3) / (MAX_HEIGHT - 0.3)
    vr = Math.round(lerp(0, 170, t))
    vg = Math.round(lerp(68, 0, t))
    vb = Math.round(lerp(85, 255, t))
  } else {
    vr = 0; vg = 68; vb = 85
  }

  // Unvoiced palette: amber/gold (no pitch direction, just energy-based brightness)
  const t = Math.max(0, Math.min(1, Math.abs(height) / MAX_HEIGHT))
  const ur = Math.round(lerp(30, 255, t))
  const ug = Math.round(lerp(15, 160, t))
  const ub = 0

  // Blend between palettes based on voicing (0=unvoiced, 1=voiced)
  const r = Math.round(lerp(ur, vr, voicing))
  const g = Math.round(lerp(ug, vg, voicing))
  const b = Math.round(lerp(ub, vb, voicing))

  return `rgba(${r},${g},${b},${fogAlpha.toFixed(3)})`
}

export function Visualizer({
  frequencyData,
  timeDomainData,
  isActive,
  width,
  height,
}: VisualizerProps) {
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const terrainRowsRef   = useRef<TerrainRow[]>([])
  const scrollAccumRef   = useRef(0)
  const lastTimestampRef = useRef(0)
  const animFrameRef     = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Reset terrain state on every effect run
    terrainRowsRef.current = []
    scrollAccumRef.current = 0
    lastTimestampRef.current = 0

    if (!isActive) {
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(0, 200, 200, 0.4)'
      ctx.font = '13px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('> awaiting microphone input...', width / 2, height / 2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      return
    }

    const centerX = width / 2
    const centerY = Math.round(height * 0.42)

    const draw = (timestamp: DOMHighResTimeStamp) => {
      // --- Timing & row generation ---
      const delta = lastTimestampRef.current === 0
        ? 16
        : Math.min(timestamp - lastTimestampRef.current, 100)
      lastTimestampRef.current = timestamp

      scrollAccumRef.current += SCROLL_RATE * (delta / 1000)

      while (scrollAccumRef.current >= 1.0) {
        terrainRowsRef.current.unshift(
          buildTerrainRow(frequencyData.current, timeDomainData.current)
        )
        if (terrainRowsRef.current.length > GRID_ROWS) {
          terrainRowsRef.current.pop()
        }
        scrollAccumRef.current -= 1.0
      }

      const scrollOffset = scrollAccumRef.current
      const rows = terrainRowsRef.current
      const rowCount = rows.length

      // --- Clear ---
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, width, height)

      const zRange = GRID_FAR - GRID_NEAR

      // --- Horizontal rows: back to front ---
      for (let r = rowCount - 1; r >= 0; r--) {
        const worldZ = GRID_NEAR + (r + scrollOffset) * zRange / GRID_ROWS
        if (worldZ <= 0.01) continue

        const fogAlpha = Math.max(0, Math.min(1,
          1 - (worldZ - GRID_NEAR) / (zRange - 2)
        ))
        if (fogAlpha < 0.01) continue

        const row = rows[r]
        const lw = Math.max(0.5, 1.5 * fogAlpha)

        for (let j = 0; j < GRID_COLS - 1; j++) {
          const h1 = row.heights[j]
          const h2 = row.heights[j + 1]
          const avgH = (h1 + h2) * 0.5

          const x1w = (j / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
          const x2w = ((j + 1) / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
          const y1w = h1 - CAM_Y
          const y2w = h2 - CAM_Y

          const sx1 = (x1w / worldZ) * FOCAL_LENGTH + centerX
          const sy1 = (-y1w / worldZ) * FOCAL_LENGTH + centerY
          const sx2 = (x2w / worldZ) * FOCAL_LENGTH + centerX
          const sy2 = (-y2w / worldZ) * FOCAL_LENGTH + centerY

          ctx.beginPath()
          ctx.strokeStyle = heightToColor(avgH, row.voicing, fogAlpha)
          ctx.lineWidth = lw
          ctx.moveTo(sx1, sy1)
          ctx.lineTo(sx2, sy2)
          ctx.stroke()
        }
      }

      // --- Vertical rails: one polyline per column ---
      ctx.strokeStyle = 'rgba(0,100,120,0.35)'
      ctx.lineWidth = 0.5

      for (let j = 0; j < GRID_COLS; j++) {
        const xw = (j / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
        let started = false

        ctx.beginPath()
        for (let r = rowCount - 1; r >= 0; r--) {
          const worldZ = GRID_NEAR + (r + scrollOffset) * zRange / GRID_ROWS
          if (worldZ <= 0.01) continue

          const fogAlpha = Math.max(0, Math.min(1,
            1 - (worldZ - GRID_NEAR) / (zRange - 2)
          ))
          if (fogAlpha < 0.01) continue

          const yw = rows[r].heights[j] - CAM_Y
          const sx = (xw / worldZ) * FOCAL_LENGTH + centerX
          const sy = (-yw / worldZ) * FOCAL_LENGTH + centerY

          if (!started) {
            ctx.moveTo(sx, sy)
            started = true
          } else {
            ctx.lineTo(sx, sy)
          }
        }
        ctx.stroke()
      }

      animFrameRef.current = requestAnimationFrame(draw)
    }

    animFrameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isActive, frequencyData, timeDomainData, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block' }}
    />
  )
}
