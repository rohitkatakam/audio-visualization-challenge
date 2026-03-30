import { useEffect, useState } from 'react'
import { useAudio } from './audio/useAudio'
import { Visualizer } from './visualizers/Visualizer'

const ANALYSER_OPTIONS: AnalyserOptions = {
  fftSize: 2048,
  smoothingTimeConstant: 0.5,
  minDecibels: -100,
  maxDecibels: -30,
}

const AUDIO_OPTIONS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
}

function App() {
  const [dims, setDims] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const onResize = () => setDims({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { frequencyData, timeDomainData, isActive, start } = useAudio({
    analyser: ANALYSER_OPTIONS,
    audio: AUDIO_OPTIONS,
  })

  useEffect(() => {
    start()
  }, [start])

  return (
    <Visualizer
      frequencyData={frequencyData}
      timeDomainData={timeDomainData}
      isActive={isActive}
      width={dims.width}
      height={dims.height}
    />
  )
}

export default App
