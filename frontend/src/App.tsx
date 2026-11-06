import ThreeDRotationIcon from '@mui/icons-material/ThreeDRotation'
import { Box, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery } from '@mui/material'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPlan } from './api/client'
import type { Interval, Place, Plan } from './api/types'
import { BottomSheet, type SheetSnap } from './components/BottomSheet'
import { ComparePanel } from './components/ComparePanel'
import { NavigateOverlay } from './components/NavigateOverlay'
import { PlanPanel, type TripDraft } from './components/PlanPanel'
import { TimelineBar } from './components/TimelineBar'
import { createClock } from './lib/clock'
import type { Layer } from './lib/forecast'
import { toLocalInput } from './lib/format'
import { requestCompass, useNavigation } from './lib/navigation'
import { routeStates } from './lib/plan'
import { MapView, type MapMode } from './map/MapView'

const MOCK = import.meta.env.VITE_API_MOCK === '1'
const ScenarioSwitcher = lazy(() => import('./components/ScenarioSwitcher').then((m) => ({ default: m.ScenarioSwitcher })))

const INTERVAL_KEY = 'checkpoint-interval'
const HOUR = 3600_000

function storedInterval(): Interval {
  try {
    const v = Number(localStorage.getItem(INTERVAL_KEY))
    return v === 10 || v === 25 || v === 50 ? v : 10
  } catch {
    return 10
  }
}

const DEFAULT_DRAFT: TripDraft = {
  origin: { label: 'Charlotte, North Carolina, US', lat: 35.2272, lng: -80.8431 },
  destination: { label: 'New York, New York, US', lat: 40.7128, lng: -74.006 },
  stops: [],
  departure: toLocalInput(new Date(Date.now() + 2 * HOUR)),
  load: '42000',
}

export default function App() {
  const desktop = useMediaQuery('(min-width:900px)')
  const clock = useMemo(() => createClock(48), [])
  const [mode, setMode] = useState<MapMode>('plan')
  const [draft, setDraft] = useState<TripDraft>(DEFAULT_DRAFT)
  const [interval, setIntervalState] = useState<Interval>(storedInterval)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [departureMs, setDepartureMs] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [layer, setLayer] = useState<Layer>('risk')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [is3D, setIs3D] = useState(false)
  const [sheet, setSheet] = useState<SheetSnap>('half')
  const inflight = useRef<AbortController | null>(null)

  const route = plan?.routes.find((r) => r.id === selectedRouteId) ?? null
  const nav = useNavigation(route, mode === 'navigate')
  const states = useMemo(() => (plan && route ? routeStates(plan, route, interval, departureMs) : []), [plan, route, interval, departureMs])

  function setInterval(i: Interval) {
    setIntervalState(i)
    setHovered(null)
    try {
      localStorage.setItem(INTERVAL_KEY, String(i))
    } catch {
      /* not persisted in private mode */
    }
  }

  async function submit() {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchPlan(
        { origin: draft.origin!, destination: draft.destination!, stops: draft.stops as Place[], departure: new Date(draft.departure).toISOString(), load_lb: Number(draft.load) },
        ctrl.signal,
      )
      const dep = Date.parse(next.timeline.departure)
      clock.pause()
      clock.set((dep - Date.parse(next.timeline.start)) / HOUR)
      setDepartureMs(dep)
      setHovered(null)
      setSelectedRouteId(next.schedule[interval].find((o) => Date.parse(o.departure) === dep)?.recommendation.route_id ?? next.routes[0].id)
      setPlan(next)
      setMode('compare')
      setSheet('half')
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (inflight.current === ctrl) setLoading(false)
    }
  }

  // Esc leaves navigation.
  useEffect(() => {
    if (mode !== 'navigate') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMode('compare')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  const panel =
    mode === 'plan' || !plan || !route ? (
      <PlanPanel draft={draft} onDraftChange={setDraft} interval={interval} onIntervalChange={setInterval} loading={loading} error={error} onSubmit={submit} />
    ) : (
      <ComparePanel
        plan={plan}
        interval={interval}
        onIntervalChange={setInterval}
        departureMs={departureMs}
        selectedRouteId={route.id}
        onSelectRoute={(id) => (setSelectedRouteId(id), setHovered(null))}
        hoveredCheckpoint={hovered}
        onHoverCheckpoint={setHovered}
        onEdit={() => setMode('plan')}
        onStart={() => {
          // Ask for the compass inside the click: iOS only allows it from a user gesture.
          void requestCompass()
          clock.pause()
          setHovered(null)
          setMode('navigate')
        }}
      />
    )

  const header = (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 2 }}>
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: 28, height: 28 }} />
      <Box>
        <Typography variant="h1">Weather-Aware Truck Routing</Typography>
        <Typography variant="caption" color="text.secondary">
          Forecast at your ETA, ranked by risk
        </Typography>
      </Box>
    </Stack>
  )

  // Keep the routes inside the part of the map that isn't covered by the panel, timeline or sheet.
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const mapPadding = desktop
    ? { top: 80, bottom: 220, left: 60, right: 60 }
    : { top: mode === 'compare' ? 250 : 70, bottom: sheet === 'peek' ? 150 : Math.round(vh * 0.52) + 16, left: 24, right: 24 }
  const navigating = mode === 'navigate' && plan && route && nav.state

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default' }}>
      {desktop && mode !== 'navigate' && (
        <Box component="aside" sx={{ width: 400, flexShrink: 0, height: '100%', overflowY: 'auto', borderRight: 1, borderColor: 'divider', p: 2.5, display: 'flex', flexDirection: 'column' }}>
          {header}
          <Box sx={{ flex: 1 }}>{panel}</Box>
        </Box>
      )}

      <Box component="main" sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <MapView
          plan={plan}
          mode={mode}
          interval={interval}
          departureMs={departureMs}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          layer={layer}
          showHeatmap={showHeatmap}
          is3D={is3D}
          clock={clock}
          hoveredCheckpoint={mode === 'compare' ? hovered : null}
          onHoverCheckpoint={setHovered}
          follow={navigating ? { mile: nav.state!.mile } : null}
          camera={nav.camera}
          padding={mapPadding}
        />

        {mode !== 'navigate' && (
          <Stack direction="row" spacing={1} sx={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }}>
            {mode === 'compare' && (
              <Paper elevation={6} sx={{ bgcolor: 'rgba(19,26,32,0.92)' }}>
                <ToggleButtonGroup size="small" exclusive value={is3D ? '3d' : '2d'} onChange={(_, v) => v && setIs3D(v === '3d')} aria-label="Map view">
                  <ToggleButton value="2d" sx={{ px: 1.5 }}>
                    2D
                  </ToggleButton>
                  <ToggleButton value="3d" sx={{ px: 1.5, gap: 0.5 }}>
                    <ThreeDRotationIcon fontSize="small" /> 3D
                  </ToggleButton>
                </ToggleButtonGroup>
              </Paper>
            )}
            {MOCK && (
              <Suspense>
                <ScenarioSwitcher onChange={() => plan && submit()} />
              </Suspense>
            )}
          </Stack>
        )}

        {mode === 'compare' && plan && route && (
          <Box sx={{ position: 'absolute', left: 12, right: { xs: 12, md: 56 }, bottom: desktop ? 28 : sheet === 'peek' ? 144 : 'auto', top: desktop ? 'auto' : 56, zIndex: 2, display: !desktop && sheet === 'full' ? 'none' : 'block' }}>
            <TimelineBar
              plan={plan}
              clock={clock}
              departureMs={departureMs}
              onDepartureChange={setDepartureMs}
              tripDurationS={route.duration_s}
              layer={layer}
              onLayerChange={setLayer}
              showHeatmap={showHeatmap}
              onShowHeatmapChange={setShowHeatmap}
            />
          </Box>
        )}

        {navigating && (
          <NavigateOverlay route={route} nav={nav.state!} states={states} departureMs={departureMs} onSpeedChange={nav.setSpeed} onTogglePlaying={nav.togglePlaying} onEnd={() => setMode('compare')} />
        )}

        {!desktop && mode !== 'navigate' && (
          <BottomSheet snap={sheet} onSnapChange={setSheet}>
            {mode === 'plan' && header}
            {panel}
          </BottomSheet>
        )}
      </Box>
    </Box>
  )
}
