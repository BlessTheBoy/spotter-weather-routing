import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StartGate } from './components/StartGate'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { setDataMode, type DataMode } from './lib/dataMode'
import './index.css'

// The app (map engine included) starts downloading as soon as this file runs,
// while the start screen is up, so it's ready when the user picks a mode.
const loadApp = () => import('./App')
const appModule = loadApp()
const App = lazy(() => appModule)

function Root() {
  const [appLoaded, setAppLoaded] = useState(false)
  const [pending, setPending] = useState<DataMode | null>(null)
  const [mode, setMode] = useState<DataMode | null>(null)

  useEffect(() => {
    appModule.then(() => setAppLoaded(true))
  }, [])

  // Lift the gate only once the choice is recorded and everything it needs has loaded.
  useEffect(() => {
    if (!pending || !appLoaded) return
    let cancelled = false
    const extra = pending === 'demo' ? import('./mocks/mockApi') : Promise.resolve()
    extra.then(() => !cancelled && setMode(pending))
    return () => {
      cancelled = true
    }
  }, [pending, appLoaded])

  function choose(m: DataMode) {
    setDataMode(m)
    setPending(m)
  }

  // From inside the app: live weather is out of quota, so carry on with demo data.
  async function switchToDemo() {
    await import('./mocks/mockApi')
    setDataMode('demo')
    setMode('demo')
  }

  return (
    <>
      {appLoaded ? (
        <Suspense>
          <App demo={mode === 'demo'} onUseDemo={switchToDemo} />
        </Suspense>
      ) : (
        <div className="h-full bg-cover bg-center" style={{ backgroundImage: 'url(/backdrop.jpg)' }} aria-hidden />
      )}
      {!mode && <StartGate pending={pending} onChoose={choose} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={200}>
      <Root />
      <Toaster position="top-center" theme="dark" />
    </TooltipProvider>
  </StrictMode>,
)
