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

### App.tsx

Hosts the 640×480 canvas, audio analyzer options (FFT size, smoothing, dB range), and media track constraints (echo cancellation, noise suppression, auto gain control). Passes refs and dimensions to `Visualizer`.

### Visualizer.tsx

Canvas-based component. Receives `frequencyData`, `timeDomainData`, `isActive`, `width`, `height`. Should run its own `requestAnimationFrame` loop to draw each frame using the ref values.

## TypeScript notes

- Strict mode is on; `noUnusedLocals` and `noUnusedParameters` are enforced
- ESLint flat config; unused vars are allowed only when the name starts with an uppercase letter (component names)
