import { useRef, useEffect, useState } from 'react'

export interface VisualizerProps {
  frequencyData: React.RefObject<Uint8Array<ArrayBuffer>>
  timeDomainData: React.RefObject<Uint8Array<ArrayBuffer>>
  isActive: boolean
  width: number
  height: number
}

// Low-res pixel art buffer — 480×270 gives a 30×20 iso grid at 16×8 tiles (4× → 1920×1080)
const LR_W      = 480
const LR_H      = 270
const GRID_COLS = 30
const GRID_ROWS = 20

// Isometric diamond tile dimensions
const ISO_HW = 8   // half-width  → full diamond width  = 16px
const ISO_HH = 4   // half-height → full diamond height =  8px
// Origin: where col=0 row=0 top-vertex lands — right-edge of rightmost tile = 480 exactly
const ISO_OX = 240  // LR_W / 2
const ISO_OY = 14   // small top margin

// Tile intro wave
const TILE_INTRO_DELAY = 0.03  // seconds per depth unit (max depth 48 → ~1.44s total)
const TILE_INTRO_DUR   = 0.25  // fade-in duration per tile in seconds

// Speech detection
const GAIN         = 10.0
const SILENCE_GATE = 0.012
const STOP_GATE    = 0.06
const VOLUME_SCALE = 4.0   // radius growth multiplier; gainedRms≈0.25 → ~1× spreadRate

// Tile types
const TILE_GRASS      = 0
const TILE_WATER      = 1
const TILE_SAND       = 2
const TILE_DARK_GRASS = 3

// SNES-style palette
const PAL = {
  grassLight:      '#68C840',
  grassDark:       '#408020',
  grassShadow:     '#285010',
  waterLight:      '#4888E8',
  waterMid:        '#2060C0',
  waterDark:       '#183898',
  waterFoam:       '#A8D0F8',
  sandLight:       '#D8B870',
  sandMid:         '#B89048',
  sandDark:        '#806028',
  darkGrassLight:  '#487030',
  darkGrassBase:   '#285018',
  darkGrassShadow: '#183010',
  treeTrunk:       '#583818',
  treeCanopyDark:  '#204810',
  treeCanopyMid:   '#308020',
  treeCanopyLight: '#58B838',
  mountainShadow:  '#383838',
  mountainBase:    '#686868',
  mountainMid:     '#909090',
  mountainLight:   '#C0C0C0',
  mountainSnow:    '#F0F0F0',
  bushBase:        '#286018',
  bushLight:       '#48A030',
  flowerRed:       '#E82020',
  flowerYellow:    '#F0D818',
  flowerWhite:     '#F8F8E8',
  flowerBlue:      '#6088F0',
  flowerStem:      '#50A028',
  inactiveBg:      '#100818',
  uiAccent:        '#88F830',
}

const FLOWER_COLORS = [PAL.flowerRed, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerBlue]

// -------------------------------------------------------------------
// Isometric projection helpers
// -------------------------------------------------------------------

/** Convert grid (col, row) → low-res screen (sx, sy) = top vertex of diamond */
function isoSS(col: number, row: number): [number, number] {
  return [
    ISO_OX + (col - row) * ISO_HW,
    ISO_OY + (col + row) * ISO_HH,
  ]
}

// -------------------------------------------------------------------
// Tile drawing — each tile is a two-tone diamond (lit from upper-left)
// Left half = brighter, right half = darker, giving subtle 3-D depth
// -------------------------------------------------------------------

function drawGrassTile(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  // Left face (bright)
  ctx.fillStyle = PAL.grassLight
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.lineTo(sx - ISO_HW, sy + ISO_HH)
  ctx.closePath()
  ctx.fill()
  // Right face (dark)
  ctx.fillStyle = PAL.grassDark
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx + ISO_HW, sy + ISO_HH)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.closePath()
  ctx.fill()
}

function drawWaterTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, phase: number) {
  // Left face
  ctx.fillStyle = PAL.waterLight
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.lineTo(sx - ISO_HW, sy + ISO_HH)
  ctx.closePath()
  ctx.fill()
  // Right face
  ctx.fillStyle = PAL.waterMid
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx + ISO_HW, sy + ISO_HH)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.closePath()
  ctx.fill()
  // Animated foam stripe — one bright pixel row across the middle of the tile
  const stripeOffset = Math.floor(phase * ISO_HH * 2) % (ISO_HH * 2)
  // Map the stripe offset to a point along the left and right edges
  const t = stripeOffset / (ISO_HH * 2)
  const lx = sx + (-ISO_HW) * (1 - Math.abs(t * 2 - 1))
  const rx = sx + ( ISO_HW) * (1 - Math.abs(t * 2 - 1))
  const fy = sy + stripeOffset
  ctx.strokeStyle = PAL.waterFoam
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(lx + 1, fy)
  ctx.lineTo(rx - 1, fy)
  ctx.stroke()
  // Dark bottom edge
  ctx.fillStyle = PAL.waterDark
  ctx.fillRect(sx - 1, sy + ISO_HH * 2 - 1, 2, 1)
}

function drawSandTile(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = PAL.sandLight
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.lineTo(sx - ISO_HW, sy + ISO_HH)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = PAL.sandMid
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx + ISO_HW, sy + ISO_HH)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.closePath()
  ctx.fill()
  // Two dark freckles for texture
  ctx.fillStyle = PAL.sandDark
  ctx.fillRect(sx - 3, sy + ISO_HH - 1, 1, 1)
  ctx.fillRect(sx + 2, sy + ISO_HH,     1, 1)
}

function drawDarkGrassTile(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = PAL.darkGrassLight
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.lineTo(sx - ISO_HW, sy + ISO_HH)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = PAL.darkGrassBase
  ctx.beginPath()
  ctx.moveTo(sx,          sy)
  ctx.lineTo(sx + ISO_HW, sy + ISO_HH)
  ctx.lineTo(sx,          sy + ISO_HH * 2)
  ctx.closePath()
  ctx.fill()
  // Bright speck
  ctx.fillStyle = PAL.darkGrassLight
  ctx.fillRect(sx - 2, sy + 1, 1, 1)
}

// -------------------------------------------------------------------
// Pop animation
// -------------------------------------------------------------------

function popScale(now: number, birthTime: number): number {
  const age = now - birthTime
  if (age <= 0) return 0
  if (age > 0.8) return 1
  const t = age / 0.3
  return 1 - Math.exp(-4 * t) * Math.cos(8 * t)
}

function easeInQuad(t: number): number {
  return t * t
}

// -------------------------------------------------------------------
// Entity drawing — (sx, sy) is the top-vertex of the entity's tile
// Entities are drawn upward from the tile's visual center
// -------------------------------------------------------------------

function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, scale: number) {
  // cx = horizontal center of tile diamond, cy = tile's vertical center
  const cx = sx
  const cy = sy + ISO_HH

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  // Trunk — short stub just above tile center
  ctx.fillStyle = PAL.treeTrunk
  ctx.fillRect(cx - 1, cy - 3, 2, 4)

  // Shadow base ellipse (iso-squished)
  ctx.fillStyle = PAL.treeCanopyDark
  ctx.beginPath()
  ctx.ellipse(cx, cy - 7, 5, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  // Mid canopy
  ctx.fillStyle = PAL.treeCanopyMid
  ctx.beginPath()
  ctx.ellipse(cx, cy - 8, 4, 3, 0, 0, Math.PI * 2)
  ctx.fill()

  // Highlight
  ctx.fillStyle = PAL.treeCanopyLight
  ctx.fillRect(cx - 2, cy - 11, 2, 2)

  ctx.restore()
}

function drawMountain(ctx: CanvasRenderingContext2D, sx: number, sy: number, scale: number) {
  // Mountains are 2×2 tiles. (sx, sy) is the top-vertex of the NW tile (col, row).
  // The visible base of the mountain sits at the center of the 2×2 block,
  // which in isometric is directly below (sx, sy) by 2 tile heights.
  const cx   = sx
  const base = sy + ISO_HH * 4   // 2 tile heights down
  const peak = sy - 18            // mountain height above the NW tile top

  ctx.save()
  ctx.translate(cx, base)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -base)

  // Left face (dark) — from peak to base-left
  ctx.fillStyle = PAL.mountainBase
  ctx.beginPath()
  ctx.moveTo(cx,           peak)
  ctx.lineTo(cx - ISO_HW,  base - ISO_HH)
  ctx.lineTo(cx,           base)
  ctx.closePath()
  ctx.fill()

  // Right face (lighter)
  ctx.fillStyle = PAL.mountainMid
  ctx.beginPath()
  ctx.moveTo(cx,           peak)
  ctx.lineTo(cx,           base)
  ctx.lineTo(cx + ISO_HW,  base - ISO_HH)
  ctx.closePath()
  ctx.fill()

  // Top face (lightest) — a small flat diamond at peak
  ctx.fillStyle = PAL.mountainLight
  ctx.beginPath()
  ctx.moveTo(cx,     peak)
  ctx.lineTo(cx + 4, peak + 3)
  ctx.lineTo(cx,     peak + 6)
  ctx.lineTo(cx - 4, peak + 3)
  ctx.closePath()
  ctx.fill()

  // Shadow outline on left face
  ctx.fillStyle = PAL.mountainShadow
  ctx.fillRect(cx - 1, peak + 2, 1, base - peak - 4)

  // Snow cap
  ctx.fillStyle = PAL.mountainSnow
  ctx.beginPath()
  ctx.moveTo(cx,     peak)
  ctx.lineTo(cx + 3, peak + 4)
  ctx.lineTo(cx - 3, peak + 4)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

function drawBush(ctx: CanvasRenderingContext2D, sx: number, sy: number, scale: number) {
  const cx = sx
  const cy = sy + ISO_HH

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  ctx.fillStyle = PAL.bushBase
  ctx.beginPath(); ctx.ellipse(cx - 3, cy - 1, 3, 2, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx + 3, cy - 1, 3, 2, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx,     cy - 3, 3, 2, 0, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = PAL.bushLight
  ctx.fillRect(cx - 2, cy - 4, 2, 1)
  ctx.fillRect(cx + 1, cy - 3, 2, 1)

  ctx.restore()
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  variant: number,
) {
  const cx = sx
  const cy = sy + ISO_HH

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  ctx.fillStyle = PAL.flowerStem
  ctx.fillRect(cx, cy - 1, 1, 3)

  ctx.fillStyle = FLOWER_COLORS[variant % FLOWER_COLORS.length]
  ctx.fillRect(cx - 1, cy - 2, 1, 1)
  ctx.fillRect(cx + 1, cy - 2, 1, 1)
  ctx.fillRect(cx,     cy - 3, 1, 1)
  ctx.fillRect(cx,     cy - 1, 1, 1)

  ctx.fillStyle = PAL.flowerYellow
  ctx.fillRect(cx, cy - 2, 1, 1)

  ctx.restore()
}

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

type EntityKind = 'tree' | 'mountain' | 'bush' | 'flower'

type Entity = {
  col: number
  row: number
  kind: EntityKind
  birthTime: number
  variant: number
}

type DevelopmentType = 'trees' | 'mountain' | 'flowers' | 'water_spread' | 'dark_grove'

type ActiveDevelopment = {
  centerCol: number
  centerRow: number
  radius: number
  maxRadius: number
  spreadRate: number
  type: DevelopmentType
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  r: number
  g: number
  b: number
}

type Cloud = { x: number; y: number; speed: number }

const DEVELOPMENT_TYPES: DevelopmentType[] = ['trees', 'mountain', 'flowers', 'water_spread', 'dark_grove']

const DEV_CFG: Record<DevelopmentType, { maxRadius: number; spreadRate: number }> = {
  mountain:     { maxRadius: 4,  spreadRate: 0.7 },
  trees:        { maxRadius: 7,  spreadRate: 1.4 },
  dark_grove:   { maxRadius: 5,  spreadRate: 1.1 },
  water_spread: { maxRadius: 8,  spreadRate: 0.4 },  // slow, deliberate flooding
  flowers:      { maxRadius: 3,  spreadRate: 0.9 },
}

// -------------------------------------------------------------------
// World seeding — pre-populate a starter landscape
// All entities get birthTime: Infinity (fixed up on first rAF frame)
// -------------------------------------------------------------------

function seedWorld(
  tileMap: Uint8Array,
  entities: Entity[],
  occupied: Set<number>,
) {
  // --- Lake ---
  const lakeCCol = 8  + Math.floor(Math.random() * 5)   // 8..12
  const lakeCRow = 8  + Math.floor(Math.random() * 5)   // 8..12
  const waterCells: [number, number][] = []
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (Math.abs(dr) + Math.abs(dc) <= 3) {
        const r = lakeCRow + dr
        const c = lakeCCol + dc
        if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
          const idx = r * GRID_COLS + c
          if (!occupied.has(idx)) {
            tileMap[idx] = TILE_WATER
            waterCells.push([r, c])
          }
        }
      }
    }
  }
  // Sand border around water
  for (const [wr, wc] of waterCells) {
    const adj: [number, number][] = [[wr-1,wc],[wr+1,wc],[wr,wc-1],[wr,wc+1]]
    for (const [nr, nc] of adj) {
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
        const nidx = nr * GRID_COLS + nc
        if (tileMap[nidx] === TILE_GRASS) tileMap[nidx] = TILE_SAND
      }
    }
  }

  // --- Tree cluster ---
  const treeCount = 4 + Math.floor(Math.random() * 3)   // 4..6
  for (let i = 0; i < treeCount; i++) {
    const c = 20 + Math.floor(Math.random() * 6)         // 20..25
    const r =  5 + Math.floor(Math.random() * 6)         //  5..10
    const idx = r * GRID_COLS + c
    if (!occupied.has(idx) && tileMap[idx] !== TILE_WATER) {
      entities.push({ col: c, row: r, kind: 'tree', birthTime: Infinity, variant: 0 })
      occupied.add(idx)
    }
  }

  // --- Mountain ---
  for (let attempt = 0; attempt < 40; attempt++) {
    const c = 2 + Math.floor(Math.random() * (GRID_COLS - 6))
    const r = 2 + Math.floor(Math.random() * (GRID_ROWS - 6))
    if (c >= GRID_COLS - 2 || r >= GRID_ROWS - 2) continue
    const fp1 =  r      * GRID_COLS +  c
    const fp2 = (r + 1) * GRID_COLS +  c
    const fp3 =  r      * GRID_COLS + (c + 1)
    const fp4 = (r + 1) * GRID_COLS + (c + 1)
    if (
      !occupied.has(fp1) && !occupied.has(fp2) &&
      !occupied.has(fp3) && !occupied.has(fp4) &&
      tileMap[fp1] !== TILE_WATER && tileMap[fp2] !== TILE_WATER &&
      tileMap[fp3] !== TILE_WATER && tileMap[fp4] !== TILE_WATER
    ) {
      entities.push({ col: c, row: r, kind: 'mountain', birthTime: Infinity, variant: 0 })
      occupied.add(fp1); occupied.add(fp2); occupied.add(fp3); occupied.add(fp4)
      break
    }
  }
}

// -------------------------------------------------------------------
// Component
// -------------------------------------------------------------------

export function Visualizer({
  frequencyData,
  timeDomainData,
  isActive,
  width,
  height,
}: VisualizerProps) {
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const offscreenRef     = useRef<HTMLCanvasElement | null>(null)
  const tileMapRef       = useRef(new Uint8Array(GRID_COLS * GRID_ROWS))
  const entitiesRef      = useRef<Entity[]>([])
  const occupiedRef      = useRef(new Set<number>())
  const activeDevRef     = useRef<ActiveDevelopment | null>(null)
  const wasSpeakingRef   = useRef(false)
  const lastTimestampRef = useRef(0)
  const animFrameRef     = useRef(0)
  const wavePhaseRef     = useRef(0)
  const simulatingRef    = useRef(false)
  const simPulseRef      = useRef({ speaking: false, timer: 0, rms: 0.35 })
  const tileIntroRef     = useRef<Float32Array | null>(null)
  const startTimeRef     = useRef(0)
  const seededRef        = useRef(false)
  const cloudsRef        = useRef<Cloud[]>([])
  const particlesRef     = useRef<Particle[]>([])
  const [simulating, setSimulating] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas')
    }
    const oc = offscreenRef.current
    oc.width  = LR_W
    oc.height = LR_H
    const oct = oc.getContext('2d')
    if (!oct) return

    // Reset world
    tileMapRef.current       = new Uint8Array(GRID_COLS * GRID_ROWS)
    entitiesRef.current      = []
    occupiedRef.current      = new Set<number>()
    activeDevRef.current     = null
    wasSpeakingRef.current   = false
    lastTimestampRef.current = 0
    wavePhaseRef.current     = 0
    tileIntroRef.current     = new Float32Array(GRID_COLS * GRID_ROWS)
    startTimeRef.current     = 0
    seededRef.current        = false
    particlesRef.current     = []
    cloudsRef.current        = Array.from({ length: 5 }, () => ({
      x:     Math.random() * LR_W,
      y:     2 + Math.random() * (ISO_OY - 6),
      speed: 2 + Math.random() * 4,
    }))

    // Pre-seed the world
    seedWorld(tileMapRef.current, entitiesRef.current, occupiedRef.current)

    if (!isActive) {
      ctx.fillStyle = PAL.inactiveBg
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = PAL.uiAccent
      ctx.font = 'bold 14px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('> awaiting microphone input...', width / 2, height / 2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      return
    }

    const scale = Math.max(1, Math.floor(Math.min(width / LR_W, height / LR_H)))
    const drawW = LR_W * scale
    const drawH = LR_H * scale
    const drawX = Math.floor((width  - drawW) / 2)
    const drawY = Math.floor((height - drawH) / 2)

    const draw = (timestamp: DOMHighResTimeStamp) => {
      const dt = lastTimestampRef.current === 0
        ? 0.016
        : Math.min((timestamp - lastTimestampRef.current) / 1000, 0.1)
      lastTimestampRef.current = timestamp
      const now = timestamp / 1000

      // ---- First-frame setup ----
      if (startTimeRef.current === 0) {
        startTimeRef.current = now
        const intro = tileIntroRef.current!
        for (let r = 0; r < GRID_ROWS; r++)
          for (let c = 0; c < GRID_COLS; c++)
            intro[r * GRID_COLS + c] = now + (c + r) * TILE_INTRO_DELAY
      }
      if (!seededRef.current) {
        seededRef.current = true
        for (const e of entitiesRef.current)
          if (e.birthTime === Infinity)
            e.birthTime = now + (e.col + e.row) * TILE_INTRO_DELAY + 0.1
      }

      // ---- Audio / simulation ----
      let gainedRms: number

      if (simulatingRef.current) {
        const pulse = simPulseRef.current
        pulse.timer -= dt
        if (pulse.timer <= 0) {
          pulse.speaking = !pulse.speaking
          if (pulse.speaking) {
            const roll = Math.random()
            if (roll < 0.20) {
              pulse.rms  = 0.25 + Math.random() * 0.1
            } else if (roll < 0.40) {
              pulse.rms  = 0.65 + Math.random() * 0.3
            } else if (roll < 0.65) {
              pulse.rms  = 0.25 + Math.random() * 0.3
            } else if (roll < 0.85) {
              pulse.rms  = 0.09 + Math.random() * 0.15
            } else {
              pulse.rms  = 0.013 + Math.random() * 0.06
            }
            pulse.timer = 1.0 + Math.random() * 2.0
          } else {
            pulse.timer = 0.4 + Math.random() * 0.8
          }
        }
        gainedRms = pulse.speaking ? pulse.rms : 0
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

      // ---- Speech onset ----
      if (isSpeaking && !wasSpeakingRef.current) {
        const type = DEVELOPMENT_TYPES[Math.floor(Math.random() * DEVELOPMENT_TYPES.length)]

        const cfg    = DEV_CFG[type]
        const margin = type === 'mountain' ? 2 : 1
        activeDevRef.current = {
          centerCol:  margin + Math.floor(Math.random() * (GRID_COLS - margin * 2)),
          centerRow:  margin + Math.floor(Math.random() * (GRID_ROWS - margin * 2)),
          radius:     0.5,
          maxRadius:  cfg.maxRadius,
          spreadRate: cfg.spreadRate,
          type,
        }
      }
      wasSpeakingRef.current = isSpeaking

      // ---- Grow active development ----
      const dev      = activeDevRef.current
      const tileMap  = tileMapRef.current
      const entities = entitiesRef.current
      const occupied = occupiedRef.current

      if (isSpeaking && dev !== null) {
        dev.radius = Math.min(dev.radius + dev.spreadRate * gainedRms * VOLUME_SCALE * dt, dev.maxRadius)

        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            const dx   = c - dev.centerCol
            const dr   = r - dev.centerRow
            const dist = Math.sqrt(dx * dx + dr * dr)
            if (dist > dev.radius) continue

            const sigma     = Math.max(dev.radius * 0.5, 0.5)
            const influence = Math.exp(-0.5 * (dist / sigma) ** 2)
            const idx       = r * GRID_COLS + c

            if (Math.random() < influence * gainedRms * VOLUME_SCALE * dt) {
              if (dev.type === 'water_spread') {
                if (tileMap[idx] !== TILE_WATER && !occupied.has(idx)) {
                  tileMap[idx] = TILE_WATER
                  // Sandy shoreline on adjacent empty grass tiles
                  const adj: [number, number][] = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
                  for (const [nr, nc] of adj) {
                    if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
                      const nidx = nr * GRID_COLS + nc
                      if (tileMap[nidx] === TILE_GRASS) tileMap[nidx] = TILE_SAND
                    }
                  }
                }
              } else if (dev.type === 'dark_grove' && tileMap[idx] === TILE_GRASS) {
                tileMap[idx] = TILE_DARK_GRASS
              }
            }

            if (!occupied.has(idx) && Math.random() < influence * gainedRms * 3.0 * dt) {
              if (tileMap[idx] === TILE_WATER) continue
              if (dev.type === 'mountain') {
                if (c >= GRID_COLS - 2 || r >= GRID_ROWS - 2) continue
                // All 4 footprint tiles must be free — prevents overlapping/evicting other mountains
                const fp2 = (r + 1) * GRID_COLS + c
                const fp3 =  r      * GRID_COLS + (c + 1)
                const fp4 = (r + 1) * GRID_COLS + (c + 1)
                if (occupied.has(fp2) || occupied.has(fp3) || occupied.has(fp4)) continue
              }

              const kind: EntityKind =
                dev.type === 'mountain'   ? 'mountain' :
                dev.type === 'trees'      ? 'tree'     :
                dev.type === 'dark_grove' ? 'bush'     : 'flower'

              entities.push({ col: c, row: r, kind, birthTime: now, variant: Math.floor(Math.random() * 4) })
              occupied.add(idx)
              if (kind === 'mountain') {
                occupied.add((r + 1) * GRID_COLS + c)
                occupied.add( r      * GRID_COLS + (c + 1))
                occupied.add((r + 1) * GRID_COLS + (c + 1))
              }

              // Spawn sparkle particles
              const [psx, psy] = isoSS(c, r)
              let pr: number, pg: number, pb: number
              if      (kind === 'tree')     { pr = 60;  pg = 160; pb = 40  }
              else if (kind === 'mountain') { pr = 140; pg = 140; pb = 140 }
              else if (kind === 'flower')   { pr = 220; pg = 190; pb = 50  }
              else                          { pr = 50;  pg = 120; pb = 30  }
              const pCount = 6 + Math.floor(Math.random() * 3)
              for (let p = 0; p < pCount; p++) {
                particlesRef.current.push({
                  x: psx, y: psy + ISO_HH,
                  vx: (Math.random() - 0.5) * 3.0,
                  vy: -0.5 - Math.random() * 2.0,
                  life: 0.5, maxLife: 0.5,
                  r: pr, g: pg, b: pb,
                })
              }
            }
          }
        }
      }

      wavePhaseRef.current = (wavePhaseRef.current + dt * 1.5) % 1.0
      const wavePhase = wavePhaseRef.current

      // ---- Draw: sky gradient + clouds ----

      // Sky gradient
      const skyGrad = oct.createLinearGradient(0, 0, 0, ISO_OY + 8)
      skyGrad.addColorStop(0, '#080618')
      skyGrad.addColorStop(1, '#1a3060')
      oct.fillStyle = skyGrad
      oct.fillRect(0, 0, LR_W, LR_H)

      // Ground void below iso grid
      oct.fillStyle = '#0e1830'
      oct.fillRect(0, LR_H - 20, LR_W, 20)

      // Drifting pixel clouds
      for (const cloud of cloudsRef.current) {
        cloud.x -= cloud.speed * dt
        if (cloud.x < -40) cloud.x = LR_W + 20
        const cx = Math.round(cloud.x)
        const cy = Math.round(cloud.y)
        oct.globalAlpha = 0.75
        oct.fillStyle = '#d8e8f0'
        oct.fillRect(cx,     cy + 2, 10, 3)
        oct.fillRect(cx + 1, cy + 1,  4, 2)
        oct.fillRect(cx + 5, cy,      4, 2)
        oct.fillRect(cx + 3, cy,      3, 1)
        oct.globalAlpha = 1
      }

      // ---- Draw: tiles + entities merged in iso back-to-front order ----

      // Build a combined sorted draw list: sort by col+row (ascending = back to front)
      // Tiles first, then entities, within the same depth band
      type DrawTile   = { kind: 'tile';   col: number; row: number; depth: number }
      type DrawEntity = { kind: 'entity'; entity: Entity;            depth: number }
      type DrawItem   = DrawTile | DrawEntity

      // Precompute tiles covered by mountains (their 2×2 footprint)
      const mountainCovered = new Set<number>()
      for (const e of entities) {
        if (e.kind === 'mountain') {
          const { col: mc, row: mr } = e
          mountainCovered.add( mr      * GRID_COLS +  mc)
          mountainCovered.add((mr + 1) * GRID_COLS +  mc)
          mountainCovered.add( mr      * GRID_COLS + (mc + 1))
          mountainCovered.add((mr + 1) * GRID_COLS + (mc + 1))
        }
      }

      const items: DrawItem[] = []
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          items.push({ kind: 'tile', col: c, row: r, depth: c + r })
        }
      }
      for (const e of entities) {
        const idx = e.row * GRID_COLS + e.col
        // Never draw non-mountain entities on water or inside a mountain's footprint
        if (e.kind !== 'mountain' && tileMap[idx] === TILE_WATER) continue
        if (e.kind !== 'mountain' && mountainCovered.has(idx)) continue
        items.push({ kind: 'entity', entity: e, depth: e.col + e.row })
      }
      items.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth
        // Within same depth band: tiles drawn before entities
        if (a.kind === 'tile'   && b.kind === 'entity') return -1
        if (a.kind === 'entity' && b.kind === 'tile')   return  1
        return 0
      })

      const tileIntro = tileIntroRef.current!

      for (const item of items) {
        if (item.kind === 'tile') {
          const [sx, sy] = isoSS(item.col, item.row)
          const tileIdx  = item.row * GRID_COLS + item.col
          const tile     = tileMap[tileIdx]

          // Tile intro alpha
          const tileBirth = tileIntro[tileIdx]
          const tileAge   = now - tileBirth
          const alpha     = tileAge <= 0
            ? 0
            : tileAge >= TILE_INTRO_DUR
              ? 1
              : easeInQuad(tileAge / TILE_INTRO_DUR)
          oct.globalAlpha = alpha

          if      (tile === TILE_WATER)      drawWaterTile(oct, sx, sy, wavePhase)
          else if (tile === TILE_SAND)       drawSandTile(oct, sx, sy)
          else if (tile === TILE_DARK_GRASS) drawDarkGrassTile(oct, sx, sy)
          else                               drawGrassTile(oct, sx, sy)

          oct.globalAlpha = 1
        } else {
          const e        = item.entity
          const [sx, sy] = isoSS(e.col, e.row)
          const s        = popScale(now, e.birthTime)
          if      (e.kind === 'tree')     drawTree(oct, sx, sy, s)
          else if (e.kind === 'mountain') drawMountain(oct, sx, sy, s)
          else if (e.kind === 'bush')     drawBush(oct, sx, sy, s)
          else                            drawFlower(oct, sx, sy, s, e.variant)
        }
      }

      // ---- Particles ----
      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x    += p.vx * dt
        p.y    += p.vy * dt
        p.life -= dt
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        oct.globalAlpha = p.life / p.maxLife
        oct.fillStyle   = `rgb(${p.r},${p.g},${p.b})`
        oct.fillRect(Math.round(p.x), Math.round(p.y), 1, 1)
      }
      oct.globalAlpha = 1

      // ---- Scale-blit to display canvas ----
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(oc, drawX, drawY, drawW, drawH)

      animFrameRef.current = requestAnimationFrame(draw)
    }

    animFrameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isActive, frequencyData, timeDomainData, width, height])

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
