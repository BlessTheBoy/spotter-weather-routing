import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchPlan } from '@/api/client'
import type { Interval, Place, Plan } from '@/api/types'
import { BottomSheet, type SheetSnap } from '@/components/BottomSheet'
import { ComparePanel } from '@/components/ComparePanel'
import { NavigateOverlay } from '@/components/NavigateOverlay'
import { PlanPanel, type TripDraft } from '@/components/PlanPanel'
import { TimelineBar } from '@/components/TimelineBar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { createClock } from '@/lib/clock'
import type { Layer } from '@/lib/forecast'
import { requestCompass, useNavigation } from '@/lib/navigation'
import { optionAt, routeStates } from '@/lib/plan'
import { formatTime } from '@/lib/format'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { MapView, type MapClock, type MapMode } from '@/map/MapView'

const ScenarioSwitcher = lazy(() => import('@/components/ScenarioSwitcher').then((m) => ({ default: m.ScenarioSwitcher })))

const HOUR = 3600_000

const DEFAULT_DRAFT: TripDraft = {
  origin: { label: 'Charlotte, North Carolina, US', lat: 35.2272, lng: -80.8431 },
  destination: { label: 'New York, New York, US', lat: 40.7128, lng: -74.006 },
  stops: [],
  departure: new Date(Math.ceil((Date.now() + 2 * HOUR) / (15 * 60_000)) * 15 * 60_000),
  load: '42000',
}

export default function App({ demo }: { demo: boolean }) {
  const desktop = useMediaQuery('(min-width: 900px)')
  const clock = useMemo(() => createClock(48), [])
  const [mode, setMode] = useState<MapMode>('plan')
  const [mapClock, setMapClock] = useState<MapClock>('trip')
  const [navPreview, setNavPreview] = useState(false)
  const [draft, setDraft] = useState<TripDraft>(DEFAULT_DRAFT)
  // Chosen in Plan for this visit only; Compare can't change it, so its numbers never shift underfoot.
  const [interval, setIntervalState] = useState<Interval>(10)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [departureMs, setDepartureMs] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [layer, setLayer] = useState<Layer>('risk')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [is3D, setIs3D] = useState(false)
  const [sheet, setSheet] = useState<SheetSnap>('initial')
  const [sheetH, setSheetH] = useState(320)
  const inflight = useRef<AbortController | null>(null)

  const route = plan?.routes.find((r) => r.id === selectedRouteId) ?? null
  // Demo data and Preview drive are always simulated; Live Start uses real GPS and the compass.
  const nav = useNavigation(route, mode === 'navigate', navPreview || demo)
  const states = useMemo(() => (plan && route ? routeStates(plan, route, interval, departureMs) : []), [plan, route, interval, departureMs])

  function setInterval(i: Interval) {
    setIntervalState(i)
    setHovered(null)
  }

  // The recommended route is always the one selected: whenever the pick changes, follow it.
  const pickId = plan ? optionAt(plan, interval, departureMs).recommendation.route_id : null
  useEffect(() => {
    if (pickId) setSelectedRouteId(pickId)
  }, [pickId])

  // A pin moved in Compare is the trip's departure from then on, including after Edit.
  function changeDeparture(ms: number) {
    setDepartureMs(ms)
    setDraft((d) => ({ ...d, departure: new Date(ms) }))
    // The forecast knob follows the flag, so it never sits at a stale hour.
    if (plan) clock.set((ms - Date.parse(plan.timeline.start)) / HOUR)
  }

  /** A suggested departure, applied in one tap with a way back. */
  function applyDeparture(ms: number) {
    const previous = departureMs
    changeDeparture(ms)
    toast(`Leaving ${formatTime(ms)}`, { action: { label: 'Undo', onClick: () => changeDeparture(previous) } })
  }

  async function submit() {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchPlan(
        { origin: draft.origin!, destination: draft.destination!, stops: draft.stops as Place[], departure: draft.departure.toISOString(), load_lb: Number(draft.load) },
        ctrl.signal,
      )
      const dep = Date.parse(next.timeline.departure)
      clock.pause()
      clock.set((dep - Date.parse(next.timeline.start)) / HOUR)
      setDepartureMs(dep)
      setMapClock('trip')
      setHovered(null)
      setSelectedRouteId(next.schedule[interval].find((o) => Date.parse(o.departure) === dep)?.recommendation.route_id ?? next.routes[0].id)
      setPlan(next)
      setMode('compare')
      setSheet('initial')
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (inflight.current === ctrl) setLoading(false)
    }
  }

  function start(kind: 'live' | 'preview') {
    // Ask for the compass inside the click: iOS only allows it from a user gesture.
    if (kind === 'live' && !demo) void requestCompass()
    clock.pause()
    setHovered(null)
    setNavPreview(kind === 'preview')
    setMode('navigate')
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
        departureMs={departureMs}
        onApplyDeparture={applyDeparture}
        selectedRouteId={route.id}
        onSelectRoute={(id) => (setSelectedRouteId(id), setHovered(null))}
        states={states}
        hoveredCheckpoint={hovered}
        onHoverCheckpoint={setHovered}
        onEdit={() => setMode('plan')}
        onStart={start}
      />
    )

  const header = (
    <div className="mb-4 flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div>
        <h1 className="text-base leading-tight font-semibold">Weather-Aware Truck Routing</h1>
        <p className="text-xs text-muted-foreground">Forecast at your ETA, ranked by risk</p>
      </div>
      <span
        className={demo ? 'ml-auto rounded-full bg-risk-moderate/15 px-2 py-0.5 text-[10px] font-bold text-risk-moderate' : 'ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary'}
        title="Refresh the page to switch"
      >
        {demo ? 'DEMO' : 'LIVE'}
      </span>
    </div>
  )

  // Keep the routes inside the part of the map not covered by the panel, timeline or sheet.
  const timelineOnMap = mode === 'compare' && plan && route
  const mapPadding = desktop
    ? { top: timelineOnMap ? 170 : 60, bottom: 40, left: 60, right: 60 }
    : { top: timelineOnMap ? 150 : 60, bottom: sheet === 'peek' ? 140 : sheetH + 16, left: 24, right: 24 }
  const navigating = mode === 'navigate' && plan && route && nav.state

  return (
    <div className="flex h-full bg-background">
      {desktop && mode !== 'navigate' && (
        <aside className="flex h-full w-[400px] shrink-0 flex-col overflow-y-auto border-r p-5">
          {header}
          <div className="flex-1">{panel}</div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1">
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
          mapClock={mapClock}
          hoveredCheckpoint={mode === 'compare' ? hovered : null}
          onHoverCheckpoint={setHovered}
          follow={navigating ? { mile: nav.state!.mile } : null}
          camera={nav.camera}
          padding={mapPadding}
        />

        {mode !== 'navigate' && (
          <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-2">
            {timelineOnMap && (
              <div className={desktop ? 'w-[min(880px,calc(100vw-400px-5rem))]' : 'w-[calc(100vw-1.5rem)]'}>
                <TimelineBar
                  plan={plan}
                  interval={interval}
                  clock={clock}
                  mapClock={mapClock}
                  onMapClockChange={setMapClock}
                  departureMs={departureMs}
                  onDepartureChange={changeDeparture}
                  onApplyDeparture={applyDeparture}
                  tripDurationS={route.duration_s}
                  layer={layer}
                  onLayerChange={setLayer}
                  showHeatmap={showHeatmap}
                  onShowHeatmapChange={setShowHeatmap}
                  compact={!desktop}
                />
              </div>
            )}
            <div className="flex gap-2">
              {mode === 'compare' && (
                <ToggleGroup type="single" size="sm" variant="outline" className="bg-popover/90" value={is3D ? '3d' : '2d'} onValueChange={(v) => v && setIs3D(v === '3d')} aria-label="Map view">
                  <ToggleGroupItem value="2d" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    2D
                  </ToggleGroupItem>
                  <ToggleGroupItem value="3d" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    3D terrain
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
              {demo && (
                <Suspense>
                  <ScenarioSwitcher onChange={() => plan && submit()} />
                </Suspense>
              )}
            </div>
          </div>
        )}

        {navigating && (
          <NavigateOverlay
            route={route}
            nav={nav.state!}
            states={states}
            departureMs={departureMs}
            onSpeedChange={nav.setSpeed}
            onTogglePlaying={nav.togglePlaying}
            onSimulateInstead={nav.simulateInstead}
            onEnd={() => setMode('compare')}
          />
        )}

        {!desktop && mode !== 'navigate' && (
          <BottomSheet snap={sheet} onSnapChange={setSheet} contentKey={`${mode}:${selectedRouteId}:${draft.stops.length}`} onHeightChange={setSheetH}>
            {mode === 'plan' && header}
            {panel}
          </BottomSheet>
        )}
      </main>
    </div>
  )
}
