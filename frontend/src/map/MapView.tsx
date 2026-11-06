import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import { AttributionControl, LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { Interval, LngLat, Plan } from '../api/types'
import type { Clock } from '../lib/clock'
import { hourToTime, LAYERS, positionAt, valuesAt, type Layer } from '../lib/forecast'
import { routeStates, type CheckpointState } from '../lib/plan'
import { RISK_LEVELS, UNKNOWN_COLOR } from '../lib/risk'
import { loadBadgeImages } from './badges'
import { badgeFeatures, boundsOf, checkpointFeatures, corridorFeatures, endpoints, riskSegments, routeLines } from './geojson'
import { checkpointPopupHtml } from './popup'

// Vite bundles the ESM worker separately; point MapLibre at the emitted file.
setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/fiord'
const TERRAIN_URL = 'https://tiles.mapterhorn.com/tilejson.json'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const SOURCES = ['corridor', 'columns', 'routes', 'segments', 'checkpoints', 'badges', 'endpoints', 'trucks', 'you'] as const

const RISK_STEP = [
  'step',
  ['to-number', ['feature-state', 'v'], -1],
  'rgba(0,0,0,0)',
  ...RISK_LEVELS.flatMap((r) => [r.level, r.color]),
] as unknown as ExpressionSpecification

function fillColor(layer: Layer): ExpressionSpecification {
  if (layer === 'risk') return RISK_STEP
  return ['interpolate', ['linear'], ['to-number', ['feature-state', 'v'], 0], ...LAYERS[layer].stops.flat()] as ExpressionSpecification
}

function fillOpacity(layer: Layer): ExpressionSpecification {
  // Low-risk hexes stay faint so the eye goes to the cells that matter.
  if (layer === 'risk') return ['case', ['<=', ['to-number', ['feature-state', 'v'], -1], 0], 0.06, 0.45]
  return ['literal', 0.5] as unknown as ExpressionSpecification
}

/** 0..1 height share for 3D columns. */
function heightShare(layer: Layer, v: number): number {
  if (layer === 'risk') return Math.max(0, v) / 4
  const stops = LAYERS[layer].stops
  return Math.min(1, Math.max(0, v / stops[stops.length - 1][0]))
}

/** Cells below this stay flat in 3D, so columns only rise where weather matters. */
const COLUMN_THRESHOLD: Record<Layer, number> = { risk: 2, wind_mph: 25, rain_in_hr: 0.1, snow_in_hr: 0.5 }
const COLUMN_HEIGHT_M = 30_000

const RISK_LINE_COLOR = ['match', ['get', 'level'], ...RISK_LEVELS.flatMap((r) => [r.level, r.color]), UNKNOWN_COLOR] as unknown as ExpressionSpecification

export type MapMode = 'plan' | 'compare' | 'navigate'

/** Camera target while navigating. */
export interface Follow {
  position: LngLat
  bearing: number
  /** Mile reached so far; the risk line ahead starts here. */
  mile: number
}

interface Props {
  plan: Plan | null
  mode: MapMode
  interval: Interval
  departureMs: number
  selectedRouteId: string | null
  onSelectRoute: (id: string) => void
  layer: Layer
  showHeatmap: boolean
  is3D: boolean
  clock: Clock
  hoveredCheckpoint: number | null
  onHoverCheckpoint: (index: number | null) => void
  follow: Follow | null
  /** Space the panel or sheet covers, so fitBounds keeps the routes visible. */
  padding: { top: number; bottom: number; left: number; right: number }
}

export function MapView(props: Props) {
  const { plan, mode, interval, departureMs, selectedRouteId, layer, showHeatmap, is3D, clock, hoveredCheckpoint, follow } = props
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const readyRef = useRef<Promise<void> | null>(null)
  const values = useRef(new Float32Array(0))
  const corridorData = useRef<ReturnType<typeof corridorFeatures> | null>(null)
  const columnKey = useRef('')
  const statesRef = useRef<CheckpointState[]>([])
  const latest = useRef(props)
  latest.current = props

  const whenReady = (fn: (map: MapLibre) => void) => {
    const map = mapRef.current
    readyRef.current?.then(() => {
      if (map && mapRef.current === map) fn(map)
    })
  }
  const set = (map: MapLibre, id: (typeof SOURCES)[number], data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource).setData(data)

  // --- create the map once ------------------------------------------------
  useEffect(() => {
    const map = new MapLibre({
      container: container.current!,
      style: STYLE_URL,
      center: [-97, 38.5],
      zoom: 3.6,
      maxPitch: 70,
      attributionControl: false,
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new AttributionControl({ compact: true, customAttribution: ['Weather © Open-Meteo.com (CC BY 4.0)', 'Routing © TomTom', '© Mapterhorn'] }), 'bottom-right')
    mapRef.current = map
    readyRef.current = new Promise((resolve) =>
      map.on('load', async () => {
        await loadBadgeImages(map)
        addLayers(map)
        bindInteractions(map, latest)
        resolve()
      }),
    )
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // --- plan geometry ------------------------------------------------------
  useEffect(() => {
    whenReady((map) => {
      if (!plan) {
        for (const id of SOURCES) set(map, id, EMPTY)
        return
      }
      map.removeFeatureState({ source: 'corridor' })
      corridorData.current = corridorFeatures(plan.corridor)
      columnKey.current = ''
      set(map, 'corridor', corridorData.current)
      set(map, 'routes', routeLines(plan))
      set(map, 'endpoints', endpoints(plan))
      const [sw, ne] = boundsOf(plan.routes)
      map.fitBounds(new LngLatBounds(sw, ne), { padding: latest.current.padding, duration: 900 })
      paintHour()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  // --- selected route at the pin's departure: risk line, checkpoints, badges
  const mileStep = Math.floor(follow?.mile ?? 0)
  useEffect(() => {
    whenReady((map) => {
      const route = plan?.routes.find((r) => r.id === selectedRouteId)
      if (!plan || !route) {
        for (const id of ['segments', 'checkpoints', 'badges'] as const) set(map, id, EMPTY)
        return
      }
      const states = routeStates(plan, route, interval, departureMs)
      statesRef.current = states
      // While navigating only the road ahead keeps its colour.
      set(map, 'segments', riskSegments(route, states, mode === 'navigate' ? mileStep : 0))
      set(map, 'checkpoints', checkpointFeatures(route, states))
      set(map, 'badges', badgeFeatures(states))
      map.setPaintProperty('route-alt', 'line-opacity', ['case', ['==', ['get', 'route'], selectedRouteId ?? ''], 0, 0.9])
      paintHour()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, selectedRouteId, interval, departureMs, mode, mileStep])

  // --- forecast hour -> heatmap colours and truck positions ----------------
  function paintHour() {
    const map = mapRef.current
    const { plan, layer, is3D, departureMs, mode, selectedRouteId } = latest.current
    if (!map || !plan || !map.getSource('corridor')) return
    const hour = clock.get()
    const n = plan.corridor.cells.length
    if (values.current.length !== n) values.current = new Float32Array(n)
    valuesAt(plan.corridor, layer, hour, values.current)
    for (let i = 0; i < n; i++) map.setFeatureState({ source: 'corridor', id: i }, { v: values.current[i] })
    if (is3D) paintColumns(map, n, layer)
    if (mode === 'compare') {
      const t = hourToTime(plan.corridor, hour)
      const trucks = plan.routes
        .map((r) => ({ r, p: positionAt(r, departureMs, t) }))
        .filter((x) => x.p)
        .map(({ r, p }) => ({ type: 'Feature' as const, properties: { route: r.id, selected: r.id === selectedRouteId }, geometry: { type: 'Point' as const, coordinates: p! } }))
      set(map, 'trucks', { type: 'FeatureCollection', features: trucks })
    } else set(map, 'trucks', EMPTY)
  }

  // 3D columns live in their own source holding only the cells above the
  // threshold. Membership changes at most once per hour step, so setData is rare;
  // heights and colours in between move through feature-state.
  function paintColumns(map: MapLibre, n: number, layer: Layer) {
    const ids: number[] = []
    for (let i = 0; i < n; i++) if (values.current[i] >= COLUMN_THRESHOLD[layer]) ids.push(i)
    const key = layer + ids.join(',')
    if (key !== columnKey.current && corridorData.current) {
      columnKey.current = key
      set(map, 'columns', { type: 'FeatureCollection', features: ids.map((i) => corridorData.current!.features[i]) })
    }
    for (const i of ids) map.setFeatureState({ source: 'columns', id: i }, { v: values.current[i], h: heightShare(layer, values.current[i]) })
  }

  useEffect(() => {
    let frame = 0
    const unsub = clock.subscribe(() => {
      // Coalesce bursts of slider events into one paint per frame.
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), paintHour()))
    })
    return () => {
      unsub()
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock])

  // --- heatmap layer choice -----------------------------------------------
  useEffect(() => {
    whenReady((map) => {
      map.setPaintProperty('corridor-fill', 'fill-color', fillColor(layer))
      map.setPaintProperty('corridor-fill', 'fill-opacity', fillOpacity(layer))
      map.setPaintProperty('corridor-3d', 'fill-extrusion-color', fillColor(layer))
      columnKey.current = ''
      paintHour()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer])

  // --- visibility per mode, heatmap on/off, 2D vs 3D ----------------------
  useEffect(() => {
    whenReady((map) => {
      const heat = showHeatmap && mode === 'compare'
      map.setLayoutProperty('corridor-fill', 'visibility', heat ? 'visible' : 'none')
      map.setLayoutProperty('corridor-3d', 'visibility', heat && is3D ? 'visible' : 'none')
      map.setLayoutProperty('route-alt', 'visibility', mode === 'compare' ? 'visible' : 'none')
      map.setLayoutProperty('route-alt-casing', 'visibility', mode === 'compare' ? 'visible' : 'none')
      map.setLayoutProperty('you', 'visibility', mode === 'navigate' ? 'visible' : 'none')
      const terrain = is3D || mode === 'navigate'
      map.setLayoutProperty('hillshade', 'visibility', terrain ? 'visible' : 'none')
      map.setTerrain(terrain ? { source: 'terrain', exaggeration: 1.4 } : null)
      if (mode === 'compare') map.easeTo({ pitch: is3D ? 58 : 0, bearing: is3D ? -15 : 0, duration: 900 })
      columnKey.current = ''
      paintHour()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeatmap, is3D, mode])

  // --- navigation camera --------------------------------------------------
  useEffect(() => {
    whenReady((map) => {
      if (!follow) return
      set(map, 'you', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: follow.position } }] })
      map.easeTo({ center: follow.position, bearing: follow.bearing, pitch: 60, zoom: 13, duration: 450, easing: (t) => t, padding: { top: 180, bottom: 200, left: 0, right: 0 } })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow?.position[0], follow?.position[1], follow?.bearing])

  // Leaving navigation: back to the whole trip.
  useEffect(() => {
    if (mode === 'navigate' || !plan) return
    whenReady((map) => {
      const [sw, ne] = boundsOf(plan.routes)
      map.fitBounds(new LngLatBounds(sw, ne), { padding: latest.current.padding, pitch: is3D ? 58 : 0, bearing: 0, duration: 900 })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // --- checkpoint hover (map or panel strip) -------------------------------
  useEffect(() => {
    const map = mapRef.current
    const route = plan?.routes.find((r) => r.id === selectedRouteId)
    if (!map || !plan || !route || hoveredCheckpoint == null || !map.getSource('checkpoints')) return
    const s = routeStates(plan, route, interval, departureMs)[hoveredCheckpoint]
    if (!s) return
    map.setFeatureState({ source: 'checkpoints', id: hoveredCheckpoint }, { hover: true })
    const popup = new Popup({ closeButton: false, closeOnClick: false, className: 'cp-popup', offset: 14, maxWidth: '260px' })
      .setLngLat([s.lng, s.lat])
      .setHTML(checkpointPopupHtml(route, s, plan.load_lb))
      .addTo(map)
    return () => {
      map.setFeatureState({ source: 'checkpoints', id: hoveredCheckpoint }, { hover: false })
      popup.remove()
    }
  }, [hoveredCheckpoint, plan, selectedRouteId, interval, departureMs])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}

function addLayers(map: MapLibre) {
  // Draw data under the basemap's labels so place names stay readable.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  map.addSource('terrain', { type: 'raster-dem', url: TERRAIN_URL, encoding: 'terrarium', tileSize: 512 })
  map.addSource('hillshade-dem', { type: 'raster-dem', url: TERRAIN_URL, encoding: 'terrarium', tileSize: 512 })
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY })

  map.addLayer(
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'hillshade-dem',
      layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#4a6070' },
    },
    firstLabel,
  )
  map.addLayer(
    { id: 'corridor-fill', type: 'fill', source: 'corridor', paint: { 'fill-color': RISK_STEP, 'fill-opacity': fillOpacity('risk'), 'fill-outline-color': 'rgba(255,255,255,0.04)' } },
    firstLabel,
  )
  map.addLayer(
    {
      id: 'corridor-3d',
      type: 'fill-extrusion',
      source: 'columns',
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': RISK_STEP,
        'fill-extrusion-height': ['*', ['to-number', ['feature-state', 'h'], 0], COLUMN_HEIGHT_M],
        'fill-extrusion-opacity': 0.75,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    firstLabel,
  )
  // Alternatives are quiet grey lines you can click. The selected route is hidden here and drawn by risk below.
  map.addLayer({ id: 'route-alt-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b1a22', 'line-width': 7, 'line-opacity': 0.6 } })
  map.addLayer({ id: 'route-alt', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8A9BA8', 'line-width': 4 } })
  map.addLayer({ id: 'route-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 20 } })
  map.addLayer({ id: 'segments-casing', type: 'line', source: 'segments', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b1a22', 'line-width': 10 } })
  map.addLayer({ id: 'segments', type: 'line', source: 'segments', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RISK_LINE_COLOR, 'line-width': 6 } })
  map.addLayer({
    id: 'checkpoints',
    type: 'circle',
    source: 'checkpoints',
    paint: {
      'circle-color': RISK_LINE_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['boolean', ['feature-state', 'hover'], false], 8, 3.5], 9, ['case', ['boolean', ['feature-state', 'hover'], false], 11, 6]],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', '#0b1a22'],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
    },
  })
  map.addLayer({
    id: 'endpoints',
    type: 'circle',
    source: 'endpoints',
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'stop', 6, 8],
      'circle-color': ['match', ['get', 'kind'], 'origin', '#40E0D0', 'stop', '#F2C94C', '#ffffff'],
      'circle-stroke-color': '#043344',
      'circle-stroke-width': 3,
    },
  })
  // Badges collide with each other; the most severe (lowest rank) is placed first and wins.
  map.addLayer({
    id: 'badges',
    type: 'symbol',
    source: 'badges',
    layout: {
      'icon-image': ['get', 'image'],
      'icon-anchor': 'bottom',
      'icon-offset': [0, -4],
      'icon-allow-overlap': false,
      'icon-padding': 10,
      'symbol-sort-key': ['get', 'rank'],
    },
  })
  map.addLayer({
    id: 'trucks',
    type: 'circle',
    source: 'trucks',
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 11, 8],
      'circle-color': '#043344',
      'circle-stroke-color': ['case', ['get', 'selected'], '#40E0D0', '#8A9BA8'],
      'circle-stroke-width': 2.5,
    },
  })
  map.addLayer({
    id: 'truck-labels',
    type: 'symbol',
    source: 'trucks',
    layout: { 'text-field': ['get', 'route'], 'text-size': ['case', ['get', 'selected'], 12, 10], 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: 'you',
    type: 'symbol',
    source: 'you',
    layout: {
      visibility: 'none',
      'text-field': '▲',
      'text-size': 30,
      'text-font': ['Noto Sans Bold'],
      'text-allow-overlap': true,
      'text-rotation-alignment': 'viewport',
    },
    paint: { 'text-color': '#40E0D0', 'text-halo-color': '#043344', 'text-halo-width': 3 },
  })
  map.setSky({ 'sky-color': '#0b1a22', 'horizon-color': '#1c3a48', 'fog-color': '#0b1a22', 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.6 })
}

function bindInteractions(map: MapLibre, latest: { current: Props }) {
  map.on('click', 'route-hit', (e) => {
    const id = e.features?.[0]?.properties?.route
    if (id && latest.current.mode === 'compare') latest.current.onSelectRoute(id)
  })
  map.on('mousemove', 'checkpoints', (e) => {
    const f = e.features?.[0]
    if (!f) return
    map.getCanvas().style.cursor = 'pointer'
    const index = (f.properties as { index: number }).index
    if (latest.current.hoveredCheckpoint !== index) latest.current.onHoverCheckpoint(index)
  })
  map.on('mouseleave', 'checkpoints', () => {
    map.getCanvas().style.cursor = ''
    latest.current.onHoverCheckpoint(null)
  })
  map.on('click', 'badges', (e) => {
    const index = e.features?.[0]?.properties?.index
    if (index != null) latest.current.onHoverCheckpoint(Number(index))
  })
  map.on('mouseenter', 'route-hit', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'route-hit', () => (map.getCanvas().style.cursor = ''))
}
