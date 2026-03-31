# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server (Vite)
npm run build     # Production build
npm run lint      # ESLint check
npm run preview   # Preview production build
```

No test framework is configured.

## Architecture

This is a React + TypeScript + Vite audio visualization challenge starter kit. The goal is to build a real-time audio visualizer using microphone input.

**The only file intended for modification is `src/visualizers/Visualizer.tsx`.**

### Data flow

```
Microphone → useAudio (Web Audio API) → frequencyData / timeDomainData refs
                                       → Visualizer.tsx (reads refs in rAF loop)
                                       → Canvas rendering
```

### Audio pipeline (`src/audio/useAudio.ts`) — do not modify

Returns from the `useAudio` hook:
- `frequencyData`: `React.RefObject<Uint8Array>` — 1024 FFT bins, values 0–255
- `timeDomainData`: `React.RefObject<Uint8Array>` — 2048 waveform samples, values 0–255 (128 = silence)
- `isActive`: boolean — whether mic is streaming
- `error`: string | null
- `start()` / `stop()`: control mic capture

The hook updates the typed arrays **in-place every frame** via `requestAnimationFrame`, so reads inside a canvas animation loop will always see fresh data with zero React re-renders.

### App.tsx — do not modify

Stripped down to bare minimum. No controls overlay. Canvas fills the full viewport. Key details:
- `ANALYSER_OPTIONS` and `AUDIO_OPTIONS` are **module-level constants** (not inline objects) — this is required to prevent an infinite re-render loop in `useAudio`, which uses them as dependencies.
- Auto-calls `start()` on mount via `useEffect(() => { start() }, [start])` — no manual mic button.
- Passes `window.innerWidth / window.innerHeight` as canvas dims, updates on resize.
- `App.css` is empty — all styles removed.

### Visualizer.tsx — the only file to edit

Canvas-based component. Receives `frequencyData`, `timeDomainData`, `isActive`, `width`, `height`. Runs its own `requestAnimationFrame` loop.

#### Current implementation: Speech-Sculpted Terrain Builder

The visualizer is a **3D terrain builder driven by voice/speech**. Speaking causes terrain formations to grow on a static grid. The user builds up a landscape one utterance at a time.

**Rendering pipeline:**
- 3D perspective projection on a 2D canvas (`screenX = (worldX / worldZ) * fl + centerX`)
- Camera is high and overhead (bird's-eye, Nintendo DS style)
- `fl` (focal length) and `camY` (camera height) are computed dynamically from `width`/`height` to ensure the terrain plot fits on screen at any viewport size
- Painter's algorithm (back-to-front row order) for filled polygon quads
- Dark grid lines drawn on top of fills
- Fog blends far cells toward sky color

**Two persistent data arrays (refs, reset on each effect run):**
- `heightMap: Float32Array` — `GRID_COLS × GRID_ROWS`, row-major, height values in `[MIN_HEIGHT, MAX_HEIGHT]`
- `colorMap: Float32Array` — same shape, stores HSL hue (0–360) per cell, initialized to 130 (green)

**Speech detection (hysteresis):**
- Volume = RMS of `timeDomainData`, amplified by `GAIN`
- Start threshold: `SILENCE_GATE = 0.012` (easy to trigger)
- Stop threshold: `STOP_GATE = 0.06` (harder to deactivate — prevents gaps between words from breaking a formation)
- Transition silence→speech picks a new random formation

**Formation system:**
Each speech onset randomly picks a `Formation` type and a hue from `NICE_HUES`:

| Type | Shape | Spread behavior |
|------|-------|-----------------|
| `mountain` | wide Gaussian bump | grows broadly |
| `valley` | inverted Gaussian (subtracts height → ocean/lake) | grows broadly |
| `spire` | very narrow, tall Gaussian | stays needle-thin |
| `ridge` | anisotropic Gaussian at a random angle | elongates |
| `crater` | Gaussian rim + inverted center pit | medium spread |
| `plateau` | flat top + steep cliff edge | spreads fast |

`FORMATION_POOL` weights mountains and ridges more heavily. Each formation has its own `minSpread`, `maxSpread`, `spreadRate`, `heightRate` in the `CFG` map.

**Coloring:**
- Each formation gets a random hue from `NICE_HUES = [30, 60, 90, 130, 165, 200, 260, 290, 320, 350]`
- As a formation grows, it blends its hue into `colorMap[idx]` weighted by influence strength
- `cellRGB(hue, height)` converts colorMap hue + height to RGB via HSL: height maps to lightness (18%=deep/dark → 80%=bright peak)
- Fog blends cell color toward `(SKY_R, SKY_G, SKY_B)` with distance

## TypeScript notes

- Strict mode is on; `noUnusedLocals` and `noUnusedParameters` are enforced
- ESLint flat config; unused vars are allowed only when the name starts with an uppercase letter (component names)
- `frequencyData` is in `VisualizerProps` and passed from `App.tsx` but currently unused inside the component body — do not destructure it to avoid lint errors
