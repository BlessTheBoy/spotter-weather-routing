import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, fetchPlan } from '@/api/client'
import type { Interval, Place, Plan } from '@/api/types'
import { ComparePanel, RouteChips, RouteDetails, RouteSummaryLine, StartButton, TripTitle, routeName, type CompareProps } from '@/components/ComparePanel'
import { NavigateOverlay } from '@/components/NavigateOverlay'
import { PlanPanel, type TripDraft } from '@/components/PlanPanel'
import { LayersButton, TimelineBar } from '@/components/TimelineBar'
import { TopDeck } from '@/components/TopDeck'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { createClock } from '@/lib/clock'
import type { Layer } from '@/lib/forecast'
import { requestCompass, useNavigation } from '@/lib/navigation'
import { optionAt, routeStates } from '@/lib/plan'
import { formatDuration, formatTime } from '@/lib/format'
import { riskColor } from '@/lib/risk'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { MapView, type MapClock, type MapMode } from '@/map/MapView'

const ScenarioSwitcher = lazy(() =>
  import('@/components/ScenarioSwitcher').then((m) => ({
    default: m.ScenarioSwitcher,
  })),
)

const HOUR = 3600_000

const DEFAULT_DRAFT: TripDraft = {
  origin: {
    label: 'Charlotte, North Carolina, US',
    lat: 35.2272,
    lng: -80.8431,
  },
  destination: { label: 'New York, New York, US', lat: 40.7128, lng: -74.006 },
  stops: [],
  departure: new Date(Math.ceil((Date.now() + 2 * HOUR) / (15 * 60_000)) * 15 * 60_000),
  load: '42000',
}

export default function App({ demo, onUseDemo }: { demo: boolean; onUseDemo: () => Promise<void> }) {
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
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [retryInDemo, setRetryInDemo] = useState(false)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [departureMs, setDepartureMs] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [layer, setLayer] = useState<Layer>('risk')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [is3D, setIs3D] = useState(false)
  // Mobile: the top deck folds away while the user explores the map; details open in a sheet.
  const [deckOpen, setDeckOpen] = useState(true)
  const [deckH, setDeckH] = useState(260)
  const [detailsOpen, setDetailsOpen] = useState(false)
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
    toast(`Leaving ${formatTime(ms)}`, {
      action: { label: 'Undo', onClick: () => changeDeparture(previous) },
    })
  }

  async function submit() {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchPlan(
        {
          origin: draft.origin!,
          destination: draft.destination!,
          stops: draft.stops as Place[],
          departure: draft.departure.toISOString(),
          load_lb: Number(draft.load),
        },
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
      setDeckOpen(true)
    } catch (e) {
      if (!ctrl.signal.aborted)
        setError({
          message: e instanceof Error ? e.message : 'Something went wrong.',
          code: e instanceof ApiError ? e.code : undefined,
        })
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

  // After switching to demo data from a live-weather error, re-run the same trip.
  useEffect(() => {
    if (demo && retryInDemo) {
      setRetryInDemo(false)
      void submit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, retryInDemo])

  // Esc leaves navigation.
  useEffect(() => {
    if (mode !== 'navigate') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMode('compare')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  const compareProps: CompareProps | null =
    plan && route
      ? {
          plan,
          interval,
          departureMs,
          onApplyDeparture: applyDeparture,
          selectedRouteId: route.id,
          onSelectRoute: (id) => (setSelectedRouteId(id), setHovered(null)),
          states,
          hoveredCheckpoint: hovered,
          onHoverCheckpoint: setHovered,
          onEdit: () => (setMode('plan'), setDeckOpen(true)),
          onStart: start,
        }
      : null

  const planPanel = (
    <PlanPanel
      draft={draft}
      onDraftChange={setDraft}
      interval={interval}
      onIntervalChange={setInterval}
      loading={loading}
      error={error?.message ?? null}
      onUseDemo={!demo && error?.code === 'weather_quota' ? () => (setError(null), setRetryInDemo(true), void onUseDemo()) : undefined}
      onSubmit={submit}
      compact={!desktop}
    />
  )
  const comparing = mode === 'compare' && compareProps

  const badge = (
    <span
      className={
        demo
          ? 'shrink-0 rounded-full bg-risk-moderate/15 px-2 py-0.5 text-[10px] font-bold text-risk-moderate'
          : 'shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary'
      }
      title="Refresh the page to switch"
    >
      {demo ? 'DEMO' : 'LIVE'}
    </span>
  )
  const header = (
    <div className="mb-4 flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div>
        <h1 className="text-base leading-tight font-semibold">Weather-Aware Truck Routing</h1>
        <p className="text-xs text-muted-foreground">Forecast at your ETA, ranked by risk</p>
      </div>
      <span className="ml-auto">{badge}</span>
    </div>
  )

  const timeline =
    comparing && route ? (
      <TimelineBar
        plan={plan!}
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
        bare={!desktop}
      />
    ) : null
  const scenario = demo && (
    <Suspense>
      <ScenarioSwitcher onChange={() => plan && submit()} />
    </Suspense>
  )

  // Keep the routes inside the part of the map not covered by the panel, deck or floating buttons.
  const mapPadding = desktop
    ? { top: comparing ? 170 : 60, bottom: 40, left: 60, right: 60 }
    : {
        top: (mode === 'navigate' ? 0 : deckH) + 28,
        bottom: comparing ? 96 : 24,
        left: 24,
        right: 24,
      }
  const navigating = mode === 'navigate' && plan && route && nav.state

  return (
    <div className="flex h-full bg-background">
      {desktop && mode !== 'navigate' && (
        <aside className="flex h-full w-[400px] shrink-0 flex-col overflow-y-auto border-r p-5">
          {header}
          <div className="flex-1">{comparing ? <ComparePanel {...compareProps} /> : planPanel}</div>
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
          onUserMove={() => !desktop && mode !== 'navigate' && setDeckOpen(false)}
        />

        {desktop && mode !== 'navigate' && (
          <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-2">
            {timeline && <div className="w-[min(880px,calc(100vw-400px-5rem))]">{timeline}</div>}
            <div className="flex gap-2">
              {comparing && (
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  className="bg-popover/90"
                  value={is3D ? '3d' : '2d'}
                  onValueChange={(v) => v && setIs3D(v === '3d')}
                  aria-label="Map view"
                >
                  <ToggleGroupItem value="2d" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    2D
                  </ToggleGroupItem>
                  <ToggleGroupItem value="3d" className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    3D terrain
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
              {scenario}
            </div>
          </div>
        )}

        {!desktop && mode === 'plan' && (
          <TopDeck
            expanded={deckOpen}
            onExpandedChange={setDeckOpen}
            onHeightChange={setDeckH}
            header={
              deckOpen ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <img src="/favicon.svg" alt="" className="size-6" />
                  <h1 className="truncate text-sm font-semibold">Weather-Aware Truck Routing</h1>
                  {badge}
                </div>
              ) : (
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold" onClick={() => setDeckOpen(true)}>
                  {draft.origin && draft.destination ? `${draft.origin.label.split(',')[0]} → ${draft.destination.label.split(',')[0]}` : 'Plan a trip'}
                </button>
              )
            }
          >
            {planPanel}
            {scenario && <div className="self-start">{scenario}</div>}
          </TopDeck>
        )}

        {!desktop && comparing && route && (
          <>
            <TopDeck
              expanded={deckOpen}
              onExpandedChange={setDeckOpen}
              onHeightChange={setDeckH}
              header={
                deckOpen ? (
                  <TripTitle {...compareProps} />
                ) : (
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setDeckOpen(true)}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background: riskColor(optionAt(plan!, interval, departureMs).summaries[route.id].max_level),
                      }}
                      aria-hidden
                    />
                    <span className="truncate text-sm">
                      <span className="font-semibold">{route.label}</span> · {formatDuration(route.duration_s)}
                      <span className="text-muted-foreground"> · leave {formatTime(departureMs)}</span>
                    </span>
                  </button>
                )
              }
            >
              <RouteChips {...compareProps} />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <RouteSummaryLine {...compareProps} />
                </div>
                <Button size="sm" variant="link" className="-my-1 h-auto shrink-0 px-0 py-1" onClick={() => setDetailsOpen(true)}>
                  Details
                </Button>
              </div>
              {timeline}
              {scenario && <div className="self-start">{scenario}</div>}
            </TopDeck>

            <div className="absolute right-3 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)] z-20 flex flex-col gap-2">
              <Toggle
                pressed={is3D}
                onPressedChange={setIs3D}
                variant="outline"
                className="size-11 rounded-full bg-popover/95 text-xs font-bold shadow-lg data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                aria-label="3D terrain"
              >
                3D
              </Toggle>
              <LayersButton layer={layer} onLayerChange={setLayer} showHeatmap={showHeatmap} onShowHeatmapChange={setShowHeatmap} round />
            </div>

            <div className="absolute inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20">
              <StartButton {...compareProps} className="h-12 rounded-full shadow-xl" />
            </div>

            <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
              <DrawerContent className="max-h-[85dvh]">
                <DrawerHeader className="pb-2 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
                  <DrawerTitle>{routeName(route)}</DrawerTitle>
                  <DrawerDescription>
                    {formatDuration(route.duration_s)} · leave {formatTime(departureMs)}
                  </DrawerDescription>
                </DrawerHeader>
                <div className="overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                  <RouteDetails {...compareProps} rankOpen />
                </div>
              </DrawerContent>
            </Drawer>
          </>
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
      </main>
    </div>
  )
}
