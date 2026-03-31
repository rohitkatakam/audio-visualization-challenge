import { useRef, useEffect, useState } from 'react'

export interface VisualizerProps {
  frequencyData: React.RefObject<Uint8Array<ArrayBuffer>>
  timeDomainData: React.RefObject<Uint8Array<ArrayBuffer>>
  isActive: boolean
  width: number
  height: number
}

// World / grid constants
const GRID_COLS  = 30
const GRID_ROWS  = 30
const MAX_HEIGHT = 4.0
const MIN_HEIGHT = -1.2   // valleys / craters can dip below sea level
const GRID_WIDTH = 12
const GRID_NEAR  = 3.0
const GRID_FAR   = 18.0

// Speech constants
const GAIN         = 10.0
const SILENCE_GATE = 0.012
const STOP_GATE    = 0.06

// Sky color (used for fog blending)
const SKY_R = 148, SKY_G = 210, SKY_B = 245

// Curated hues that look vivid and distinct
const NICE_HUES = [30, 60, 90, 130, 165, 200, 260, 290, 320, 350]

// -------------------------------------------------------------------
// Formation system
// -------------------------------------------------------------------
type Formation = 'mountain' | 'valley' | 'spire' | 'ridge' | 'crater' | 'plateau'

const FORMATION_POOL: Formation[] = [
  'mountain', 'mountain',
  'valley',
  'spire',
  'ridge', 'ridge',
  'crater',
  'plateau',
]

type FormationCfg = {
  minSpread: number
  maxSpread: number
  spreadRate: number
  heightRate: number
}

const CFG: Record<Formation, FormationCfg> = {
  mountain: { minSpread: 1.8, maxSpread: 9.0, spreadRate: 0.40, heightRate: 1.8 },
  valley:   { minSpread: 1.8, maxSpread: 8.0, spreadRate: 0.40, heightRate: 1.5 },
  spire:    { minSpread: 0.5, maxSpread: 1.4, spreadRate: 0.04, heightRate: 3.5 },
  ridge:    { minSpread: 1.2, maxSpread: 5.5, spreadRate: 0.45, heightRate: 2.2 },
  crater:   { minSpread: 1.0, maxSpread: 4.5, spreadRate: 0.30, heightRate: 1.6 },
  plateau:  { minSpread: 1.5, maxSpread: 6.0, spreadRate: 0.50, heightRate: 1.4 },
}

// Returns a signed weight in [-1, 1]: positive = add height, negative = subtract
function formationWeight(
  dx: number, dz: number,
  spread: number,
  type: Formation,
  angle: number,
): number {
  switch (type) {
    case 'mountain': {
      const d = Math.sqrt(dx * dx + dz * dz) / spread
      return Math.exp(-0.5 * d * d)
    }
    case 'valley': {
      const d = Math.sqrt(dx * dx + dz * dz) / spread
      return -Math.exp(-0.5 * d * d)
    }
    case 'spire': {
      const d = Math.sqrt(dx * dx + dz * dz) / spread
      return Math.exp(-3.5 * d * d)   // much sharper than mountain
    }
    case 'ridge': {
      // Anisotropic Gaussian — narrow across the ridge, long along it
      const dxr =  dx * Math.cos(angle) + dz * Math.sin(angle)
      const dzr = -dx * Math.sin(angle) + dz * Math.cos(angle)
      const across = dxr / (spread * 0.35)
      const along  = dzr / (spread * 2.8)
      return Math.exp(-0.5 * (across * across + along * along))
    }
    case 'crater': {
      const dist = Math.sqrt(dx * dx + dz * dz)
      const rim  = Math.abs(dist - spread * 1.1) / (spread * 0.45)
      const pit  = dist / (spread * 0.65)
      return Math.exp(-0.5 * rim * rim) - 0.7 * Math.exp(-0.5 * pit * pit)
    }
    case 'plateau': {
      const d = Math.sqrt(dx * dx + dz * dz) / spread
      // Flat top (weight≈1) inside radius, steep cliff at edge
      if (d < 0.6) return 1.0
      const edge = (d - 0.6) / 0.25
      return Math.exp(-2.5 * edge * edge)
    }
  }
}

// -------------------------------------------------------------------
// Terrain color — hue from color map, lightness from height
// -------------------------------------------------------------------
function hslToRGB(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function cellRGB(hue: number, height: number): [number, number, number] {
  const t = (height - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT)
  const lightness   = 18 + t * 62    // 18% deep/dark → 80% bright peak
  const saturation  = height < 0 ? 45 : 80
  return hslToRGB(hue, saturation, lightness)
}

function fogBlend(rgb: [number, number, number], fog: number): string {
  const r = Math.round(rgb[0] * fog + SKY_R * (1 - fog))
  const g = Math.round(rgb[1] * fog + SKY_G * (1 - fog))
  const b = Math.round(rgb[2] * fog + SKY_B * (1 - fog))
  return `rgb(${r},${g},${b})`
}

// -------------------------------------------------------------------
// Component
// -------------------------------------------------------------------
type ActiveFormation = {
  col: number
  row: number
  spread: number
  type: Formation
  angle: number   // random ridge angle, ignored by non-ridge types
  hue: number     // random hue for this formation's color
}

export function Visualizer({
  timeDomainData,
  isActive,
  width,
  height,
}: VisualizerProps) {
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const heightMapRef     = useRef(new Float32Array(GRID_COLS * GRID_ROWS))
  const colorMapRef      = useRef(new Float32Array(GRID_COLS * GRID_ROWS).fill(130)) // default green
  const activeFormRef    = useRef<ActiveFormation | null>(null)
  const wasSpeakingRef   = useRef(false)
  const lastTimestampRef = useRef(0)
  const animFrameRef     = useRef(0)
  const simulatingRef    = useRef(false)
  const [simulating, setSimulating] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    heightMapRef.current = new Float32Array(GRID_COLS * GRID_ROWS)
    colorMapRef.current  = new Float32Array(GRID_COLS * GRID_ROWS).fill(130)
    activeFormRef.current = null
    wasSpeakingRef.current = false
    lastTimestampRef.current = 0

    if (!isActive) {
      ctx.fillStyle = `rgb(${SKY_R},${SKY_G},${SKY_B})`
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(60, 30, 140, 0.9)'
      ctx.font = 'bold 14px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('> awaiting microphone input...', width / 2, height / 2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      return
    }

    const centerX = width / 2
    const centerY = Math.round(height * 0.12)
    const fl = Math.round(0.375 * width * GRID_NEAR / (GRID_WIDTH / 2))
    const camY = (0.88 * height - centerY) * GRID_NEAR / fl

    function proj(wx: number, wy: number, wz: number): [number, number] {
      return [
        (wx / wz) * fl + centerX,
        ((camY - wy) / wz) * fl + centerY,
      ]
    }

    function fogAt(worldZ: number): number {
      return Math.max(0, Math.min(1, 1 - (worldZ - GRID_NEAR) / (GRID_FAR - GRID_NEAR) * 1.2))
    }

    const draw = (timestamp: DOMHighResTimeStamp) => {
      const dt = lastTimestampRef.current === 0
        ? 0.016
        : Math.min((timestamp - lastTimestampRef.current) / 1000, 0.1)
      lastTimestampRef.current = timestamp

      // --- Volume ---
      let gainedRms: number
      if (simulatingRef.current) {
        gainedRms = 0.15
      } else {
        const waveData = timeDomainData.current
        let sumSq = 0
        for (let i = 0; i < waveData.length; i++) {
          const s = (waveData[i] - 128) / 128
          sumSq += s * s
        }
        gainedRms = Math.min(Math.sqrt(sumSq / waveData.length) * GAIN, 1.0)
      }
      const isSpeaking = wasSpeakingRef.current
        ? gainedRms > STOP_GATE
        : gainedRms > SILENCE_GATE

      // --- Speech onset → pick a random formation + color ---
      if (isSpeaking && !wasSpeakingRef.current) {
        const type = FORMATION_POOL[Math.floor(Math.random() * FORMATION_POOL.length)]
        const cfg = CFG[type]
        activeFormRef.current = {
          col:    2 + Math.floor(Math.random() * (GRID_COLS - 4)),
          row:    2 + Math.floor(Math.random() * (GRID_ROWS - 4)),
          spread: cfg.minSpread,
          type,
          angle:  Math.random() * Math.PI,
          hue:    NICE_HUES[Math.floor(Math.random() * NICE_HUES.length)],
        }
      }
      wasSpeakingRef.current = isSpeaking

      // --- Grow formation + paint color ---
      const form = activeFormRef.current
      const hm = heightMapRef.current
      const cm = colorMapRef.current
      if (isSpeaking && form !== null) {
        const cfg = CFG[form.type]
        form.spread = Math.min(form.spread + cfg.spreadRate * dt, cfg.maxSpread)
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let j = 0; j < GRID_COLS; j++) {
            const w = formationWeight(j - form.col, r - form.row, form.spread, form.type, form.angle)
            const idx = r * GRID_COLS + j
            hm[idx] = Math.max(MIN_HEIGHT, Math.min(
              hm[idx] + gainedRms * cfg.heightRate * w * dt,
              MAX_HEIGHT,
            ))
            // Blend color toward this formation's hue, weighted by influence
            const blend = Math.min(1, Math.abs(w) * gainedRms * 4 * dt)
            cm[idx] = cm[idx] + (form.hue - cm[idx]) * blend
          }
        }
      }

      // --- Sky gradient ---
      const skyGrad = ctx.createLinearGradient(0, 0, 0, centerY + height * 0.1)
      skyGrad.addColorStop(0, '#3a68b0')
      skyGrad.addColorStop(1, `rgb(${SKY_R},${SKY_G},${SKY_B})`)
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, width, height)

      const zRange = GRID_FAR - GRID_NEAR

      // --- Filled quads: back to front ---
      for (let r = GRID_ROWS - 2; r >= 0; r--) {
        const zBack  = GRID_NEAR + (r + 1) * zRange / (GRID_ROWS - 1)
        const zFront = GRID_NEAR +  r      * zRange / (GRID_ROWS - 1)
        const fogBack  = fogAt(zBack)
        const fogFront = fogAt(zFront)

        for (let j = 0; j < GRID_COLS - 1; j++) {
          const hBL = hm[(r + 1) * GRID_COLS + j]
          const hBR = hm[(r + 1) * GRID_COLS + j + 1]
          const hFL = hm[ r      * GRID_COLS + j]
          const hFR = hm[ r      * GRID_COLS + j + 1]
          const avgH = (hBL + hBR + hFL + hFR) * 0.25

          const xL = (j       / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
          const xR = ((j + 1) / (GRID_COLS - 1) - 0.5) * GRID_WIDTH

          const [sxBL, syBL] = proj(xL, hBL, zBack)
          const [sxBR, syBR] = proj(xR, hBR, zBack)
          const [sxFR, syFR] = proj(xR, hFR, zFront)
          const [sxFL, syFL] = proj(xL, hFL, zFront)

          const avgFog = (fogBack + fogFront) * 0.5
          if (avgFog < 0.02) continue

          const avgHue = (
            cm[(r + 1) * GRID_COLS + j] +
            cm[(r + 1) * GRID_COLS + j + 1] +
            cm[ r      * GRID_COLS + j] +
            cm[ r      * GRID_COLS + j + 1]
          ) * 0.25

          ctx.beginPath()
          ctx.fillStyle = fogBlend(cellRGB(avgHue, avgH), avgFog)
          ctx.moveTo(sxBL, syBL)
          ctx.lineTo(sxBR, syBR)
          ctx.lineTo(sxFR, syFR)
          ctx.lineTo(sxFL, syFL)
          ctx.closePath()
          ctx.fill()
        }
      }

      // --- Grid lines overlay ---
      ctx.lineWidth = 0.6
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'

      for (let r = GRID_ROWS - 1; r >= 0; r--) {
        const worldZ = GRID_NEAR + r * zRange / (GRID_ROWS - 1)
        if (fogAt(worldZ) < 0.05) continue
        ctx.beginPath()
        for (let j = 0; j < GRID_COLS; j++) {
          const xw = (j / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
          const [sx, sy] = proj(xw, hm[r * GRID_COLS + j], worldZ)
          if (j === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()
      }

      for (let j = 0; j < GRID_COLS; j++) {
        const xw = (j / (GRID_COLS - 1) - 0.5) * GRID_WIDTH
        let started = false
        ctx.beginPath()
        for (let r = GRID_ROWS - 1; r >= 0; r--) {
          const worldZ = GRID_NEAR + r * zRange / (GRID_ROWS - 1)
          if (fogAt(worldZ) < 0.05) continue
          const [sx, sy] = proj(xw, hm[r * GRID_COLS + j], worldZ)
          if (!started) { ctx.moveTo(sx, sy); started = true }
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()
      }

      animFrameRef.current = requestAnimationFrame(draw)
    }

    animFrameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isActive, timeDomainData, width, height])

  return (
    <div style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block' }}
      />
      {isActive && (
        <button
          onClick={() => {
            simulatingRef.current = !simulatingRef.current
            setSimulating(s => !s)
          }}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            padding: '6px 14px',
            background: simulating ? 'rgba(200,60,60,0.85)' : 'rgba(30,30,60,0.75)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {simulating ? '■ stop sim' : '▶ simulate noise'}
        </button>
      )}
    </div>
  )
}
