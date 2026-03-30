import { useRef, useEffect } from 'react'

export interface VisualizerProps {
  frequencyData: React.RefObject<Uint8Array<ArrayBuffer>>
  timeDomainData: React.RefObject<Uint8Array<ArrayBuffer>>
  isActive: boolean
  width: number
  height: number
}

// Grid / camera constants
const GRID_COLS    = 40
const GRID_ROWS    = 35
const MAX_HEIGHT   = 4.0
const GRID_WIDTH   = 10
const GRID_NEAR    = 1.0
const GRID_FAR     = 20.0
const FOCAL_LENGTH = 380
const CAM_Y        = 2.5
const BG_COLOR     = '#020408'

// Speech / mountain constants
const GAIN         = 10.0
const SILENCE_GATE = 0.012   // threshold to start a mountain
const STOP_GATE    = 0.06    // threshold to stop (higher = harder to deactivate)
const HEIGHT_RATE  = 1.8
const SPREAD_RATE  = 0.4
const MIN_SPREAD   = 1.8
const MAX_SPREAD   = 9.0

function heightToColor(height: number, fogAlpha: number): string {
  const t = Math.max(0, Math.min(1, height / MAX_HEIGHT))
  let r: number, g: number, b: number
  if (t < 0.5) {
    const s = t / 0.5
    r = 0
    g = Math.round(35 + s * (180 - 35))
    b = Math.round(15 + s * (70 - 15))
  } else {
    const s = (t - 0.5) / 0.5
    r = Math.round(s * 255)
    g = Math.round(180 + s * (255 - 180))
    b = Math.round(70 + s * (255 - 70))
  }
  return `rgba(${r},${g},${b},${fogAlpha.toFixed(3)})`
}

export function Visualizer({
  timeDomainData,
  isActive,
  width,
  height,
}: VisualizerProps) {
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const heightMapRef     = useRef(new Float32Array(GRID_COLS * GRID_ROWS))
  const activeMtnRef     = useRef<{ col: number; row: number; spread: number } | null>(null)
  const wasSpeakingRef   = useRef(false)
  const lastTimestampRef = useRef(0)
  const animFrameRef     = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    heightMapRef.current = new Float32Array(GRID_COLS * GRID_ROWS)
    activeMtnRef.current = null
    wasSpeakingRef.current = false
    lastTimestampRef.current = 0

    if (!isActive) {
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(0, 200, 80, 0.5)'
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
      const dt = lastTimestampRef.current === 0
        ? 0.016
        : Math.min((timestamp - lastTimestampRef.current) / 1000, 0.1)
      lastTimestampRef.current = timestamp

      // --- Volume ---
      const waveData = timeDomainData.current
      let sumSq = 0
      for (let i = 0; i < waveData.length; i++) {
        const s = (waveData[i] - 128) / 128
        sumSq += s * s
      }
      const rms = Math.sqrt(sumSq / waveData.length)
      const gainedRms = Math.min(rms * GAIN, 1.0)
      const isSpeaking = wasSpeakingRef.current
        ? gainedRms > STOP_GATE
        : gainedRms > SILENCE_GATE

      // --- Speech onset → new mountain ---
      if (isSpeaking && !wasSpeakingRef.current) {
        activeMtnRef.current = {
          col: 2 + Math.floor(Math.random() * (GRID_COLS - 4)),
          row: 2 + Math.floor(Math.random() * (GRID_ROWS - 4)),
          spread: MIN_SPREAD,
        }
      }
      wasSpeakingRef.current = isSpeaking

      // --- Grow mountain ---
      const mtn = activeMtnRef.current
      const hm = heightMapRef.current
      if (isSpeaking && mtn !== null) {
        mtn.spread = Math.min(mtn.spread + SPREAD_RATE * dt, MAX_SPREAD)
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let j = 0; j < GRID_COLS; j++) {
            const dx = j - mtn.col
            const dz = r - mtn.row
            const dist = Math.sqrt(dx * dx + dz * dz) / mtn.spread
            const weight = Math.exp(-0.5 * dist * dist)
            const idx = r * GRID_COLS + j
            hm[idx] = Math.min(hm[idx] + gainedRms * HEIGHT_RATE * weight * dt, MAX_HEIGHT)
          }
        }
      }

      // --- Clear ---
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, width, height)

      const zRange = GRID_FAR - GRID_NEAR

      // --- Horizontal rows: back to front ---
      for (let r = GRID_ROWS - 1; r >= 0; r--) {
        const worldZ = GRID_NEAR + r * zRange / (GRID_ROWS - 1)
        const fogAlpha = Math.max(0, Math.min(1,
          1 - (worldZ - GRID_NEAR) / (zRange - 1.5)
        ))
        if (fogAlpha < 0.01) continue

        const lw = Math.max(0.5, 1.5 * fogAlpha)

        for (let j = 0; j < GRID_COLS - 1; j++) {
          const h1 = hm[r * GRID_COLS + j]
          const h2 = hm[r * GRID_COLS + j + 1]
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
          ctx.strokeStyle = heightToColor(avgH, fogAlpha)
          ctx.lineWidth = lw
          ctx.moveTo(sx1, sy1)
          ctx.lineTo(sx2, sy2)
          ctx.stroke()
        }
      }

      // --- Vertical rails: one polyline per column ---
      ctx.strokeStyle = 'rgba(0,80,40,0.4)'
      ctx.lineWidth = 0.5

      for (let j = 0; j < GRID_COLS; j++) {
        const xw = (j / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
        let started = false

        ctx.beginPath()
        for (let r = GRID_ROWS - 1; r >= 0; r--) {
          const worldZ = GRID_NEAR + r * zRange / (GRID_ROWS - 1)
          const fogAlpha = Math.max(0, Math.min(1,
            1 - (worldZ - GRID_NEAR) / (zRange - 1.5)
          ))
          if (fogAlpha < 0.01) continue

          const yw = hm[r * GRID_COLS + j] - CAM_Y
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
  }, [isActive, timeDomainData, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block' }}
    />
  )
}
