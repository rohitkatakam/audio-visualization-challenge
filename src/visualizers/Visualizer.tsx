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

// Speech detection
const GAIN         = 10.0
const SILENCE_GATE = 0.012
const STOP_GATE    = 0.06

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

const DEV_CFG: Record<DevelopmentType, { maxRadius: number; spreadRate: number }> = {
  mountain:     { maxRadius: 4,  spreadRate: 0.7 },
  trees:        { maxRadius: 7,  spreadRate: 1.4 },
  dark_grove:   { maxRadius: 5,  spreadRate: 1.1 },
  water_spread: { maxRadius: 8,  spreadRate: 0.4 },  // slow, deliberate flooding
  flowers:      { maxRadius: 3,  spreadRate: 0.9 },
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
  const simPulseRef      = useRef({ speaking: false, timer: 0, rms: 0.35, bass: 0.3 })
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

      // ---- Audio / simulation ----
      let gainedRms: number
      let bassLevel: number

      if (simulatingRef.current) {
        const pulse = simPulseRef.current
        pulse.timer -= dt
        if (pulse.timer <= 0) {
          pulse.speaking = !pulse.speaking
          if (pulse.speaking) {
            const roll = Math.random()
            if (roll < 0.20) {
              pulse.rms  = 0.25 + Math.random() * 0.1
              pulse.bass = 0.5  + Math.random() * 0.3
            } else if (roll < 0.40) {
              pulse.rms  = 0.65 + Math.random() * 0.3
              pulse.bass = Math.random() * 0.3
            } else if (roll < 0.65) {
              pulse.rms  = 0.25 + Math.random() * 0.3
              pulse.bass = Math.random() * 0.3
            } else if (roll < 0.85) {
              pulse.rms  = 0.09 + Math.random() * 0.15
              pulse.bass = Math.random() * 0.3
            } else {
              pulse.rms  = 0.013 + Math.random() * 0.06
              pulse.bass = Math.random() * 0.3
            }
            pulse.timer = 1.0 + Math.random() * 2.0
          } else {
            pulse.timer = 0.4 + Math.random() * 0.8
          }
        }
        gainedRms = pulse.speaking ? pulse.rms : 0
        bassLevel = pulse.speaking ? pulse.bass : 0
      } else {
        const waveData = timeDomainData.current
        let sumSq = 0
        for (let i = 0; i < waveData.length; i++) {
          const s = (waveData[i] - 128) / 128
          sumSq += s * s
        }
        gainedRms = Math.min(Math.sqrt(sumSq / waveData.length) * GAIN, 1.0)
        const freqData = frequencyData.current
        let bassSum = 0
        for (let i = 0; i < 20; i++) bassSum += freqData[i]
        bassLevel = bassSum / (20 * 255)
      }

      const isSpeaking = wasSpeakingRef.current
        ? gainedRms > STOP_GATE
        : gainedRms > SILENCE_GATE

      // ---- Speech onset ----
      if (isSpeaking && !wasSpeakingRef.current) {
        let type: DevelopmentType
        if (bassLevel > 0.45)      type = 'water_spread'
        else if (gainedRms > 0.6)  type = 'mountain'
        else if (gainedRms > 0.25) type = 'trees'
        else if (gainedRms > 0.08) type = 'dark_grove'
        else                       type = 'flowers'

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
        dev.radius = Math.min(dev.radius + dev.spreadRate * dt, dev.maxRadius)

        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            const dx   = c - dev.centerCol
            const dr   = r - dev.centerRow
            const dist = Math.sqrt(dx * dx + dr * dr)
            if (dist > dev.radius) continue

            const sigma     = Math.max(dev.radius * 0.5, 0.5)
            const influence = Math.exp(-0.5 * (dist / sigma) ** 2)
            const idx       = r * GRID_COLS + c

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
            }
          }
        }
      }

      wavePhaseRef.current = (wavePhaseRef.current + dt * 1.5) % 1.0
      const wavePhase = wavePhaseRef.current

      // ---- Draw: tiles + entities merged in iso back-to-front order ----
      // Background
      oct.fillStyle = '#1a2040'
      oct.fillRect(0, 0, LR_W, LR_H)

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

      for (const item of items) {
        if (item.kind === 'tile') {
          const [sx, sy] = isoSS(item.col, item.row)
          const tile = tileMap[item.row * GRID_COLS + item.col]
          if      (tile === TILE_WATER)      drawWaterTile(oct, sx, sy, wavePhase)
          else if (tile === TILE_SAND)       drawSandTile(oct, sx, sy)
          else if (tile === TILE_DARK_GRASS) drawDarkGrassTile(oct, sx, sy)
          else                               drawGrassTile(oct, sx, sy)
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
