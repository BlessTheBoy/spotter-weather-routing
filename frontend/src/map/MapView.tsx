import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import { AttributionControl, LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { Plan } from '../api/types'
import type { Clock } from '../lib/clock'
import { hourToTime, LAYERS, positionAt, valuesAt, type Layer } from '../lib/forecast'
import { RISK_LEVELS, UNKNOWN_COLOR } from '../lib/risk'
import { boundsOf, checkpointFeatures, checkpointId, corridorFeatures, endpoints, riskSegments, routeLines } from './geojson'
import { checkpointPopupHtml } from './popup'

// Vite bundles the ESM worker separately; point MapLibre at the emitted file.
setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/fiord'
const TERRAIN_URL = 'https://tiles.mapterhorn.com/tilejson.json'
const EMPTY = { type: 'FeatureCollection', features: [] } as const

const RISK_STEP: ExpressionSpecification = [
  'step',
  ['to-number', ['feature-state', 'v'], -1],
  'rgba(0,0,0,0)',
  0,
  RISK_LEVELS[0].color,
  1,
  RISK_LEVELS[1].color,
  2,
  RISK_LEVELS[2].color,
  3,
  RISK_LEVELS[3].color,
  4,
  RISK_LEVELS[4].color,
]

function fillColor(layer: Layer): ExpressionSpecification {
  if (layer === 'risk') return RISK_STEP
  return ['interpolate', ['linear'], ['to-number', ['feature-state', 'v'], 0], ...LAYERS[layer].stops.flat()] as unknown as ExpressionSpecification
}

function fillOpacity(layer: Layer): ExpressionSpecification {
  // Low-risk hexes stay faint so the eye goes to the cells that matter.
  if (layer === 'risk') return ['case', ['<=', ['to-number', ['feature-state', 'v'], -1], 0], 0.12, 0.5]
  return ['literal', 0.55] as unknown as ExpressionSpecification
}

/** 0..1 height share for 3D columns. */
function heightShare(layer: Layer, v: number): number {
  if (layer === 'risk') return Math.max(0, v) / 4
  const stops = LAYERS[layer].stops
  return Math.min(1, Math.max(0, v / stops[stops.length - 1][0]))
}

/** Cells below this stay flat in 3D, so columns only rise where weather matters. */
const COLUMN_THRESHOLD: Record<Layer, number> = { risk: 1, wind_mph: 20, rain_in_hr: 0.05, snow_in_hr: 0.1 }
const COLUMN_HEIGHT_M = 30_000

const RISK_LINE_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'level'],
  ...RISK_LEVELS.flatMap((r) => [r.level, r.color]),
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification

interface Props {
  plan: Plan | null
  selectedRouteId: string | null
  onSelectRoute: (id: string) => void
  layer: Layer
  showHeatmap: boolean
  is3D: boolean
  clock: Clock
  hoveredCheckpoint: { routeId: string; index: number } | null
  onHoverCheckpoint: (cp: { routeId: string; index: number } | null) => void
}

export function MapView(props: Props) {
  const { plan, selectedRouteId, layer, showHeatmap, is3D, clock, hoveredCheckpoint } = props
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const readyRef = useRef<Promise<void> | null>(null)
  const values = useRef(new Float32Array(0))
  const corridorData = useRef<ReturnType<typeof corridorFeatures> | null>(null)
  const columnKey = useRef('')
  const callbacks = useRef(props)
  callbacks.current = props

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
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: ['Weather © Open-Meteo.com (CC BY 4.0)', 'Routing © TomTom', '© Mapterhorn'] }),
      'bottom-right',
    )
    mapRef.current = map
    if (import.meta.env.DEV) Object.assign(window, { __map: map })
    readyRef.current = new Promise((resolve) =>
      map.on('load', () => {
        addLayers(map)
        bindInteractions(map, callbacks)
        resolve()
      }),
    )
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // --- plan data ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    readyRef.current!.then(() => {
      if (cancelled) return
      const set = (id: string, data: GeoJSON.FeatureCollection | typeof EMPTY) => (map.getSource(id) as GeoJSONSource).setData(data as GeoJSON.FeatureCollection)
      if (!plan) {
        for (const id of ['corridor', 'columns', 'routes', 'segments', 'checkpoints', 'endpoints', 'trucks']) set(id, EMPTY)
        return
      }
      values.current = new Float32Array(plan.corridor.cells.length).fill(-1)
      map.removeFeatureState({ source: 'corridor' })
      corridorData.current = corridorFeatures(plan.corridor)
      columnKey.current = ''
      set('corridor', corridorData.current)
      set('routes', routeLines(plan))
      set('segments', riskSegments(plan))
      set('checkpoints', checkpointFeatures(plan))
      set('endpoints', endpoints(plan))
      const [sw, ne] = boundsOf(plan)
      map.fitBounds(new LngLatBounds(sw, ne), { padding: { top: 70, bottom: 230, left: 70, right: 70 }, duration: 900 })
      paintHour()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  // --- forecast hour -> heatmap colours and truck positions ----------------
  function paintHour() {
    const map = mapRef.current
    const { plan, layer, is3D } = callbacks.current
    if (!map || !plan || !map.getSource('corridor')) return
    const hour = clock.get()
    const n = plan.corridor.cells.length
    if (values.current.length !== n) values.current = new Float32Array(n)
    valuesAt(plan.corridor, layer, hour, values.current)
    for (let i = 0; i < n; i++) map.setFeatureState({ source: 'corridor', id: i }, { v: values.current[i] })
    if (is3D) paintColumns(map, plan.corridor.cells.length, layer)
    const t = hourToTime(plan.corridor, hour)
    const trucks = plan.routes
      .map((r) => ({ r, p: positionAt(r, t) }))
      .filter((x) => x.p)
      .map(({ r, p }) => ({ type: 'Feature' as const, properties: { route: r.id }, geometry: { type: 'Point' as const, coordinates: p! } }))
    ;(map.getSource('trucks') as GeoJSONSource).setData({ type: 'FeatureCollection', features: trucks })
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
      const features = ids.map((i) => corridorData.current!.features[i])
      ;(map.getSource('columns') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    }
    for (const i of ids) {
      const v = values.current[i]
      map.setFeatureState({ source: 'columns', id: i }, { v, h: heightShare(layer, v) })
    }
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
    const map = mapRef.current
    readyRef.current?.then(() => {
      if (!map) return
      map.setPaintProperty('corridor-fill', 'fill-color', fillColor(layer))
      map.setPaintProperty('corridor-fill', 'fill-opacity', fillOpacity(layer))
      map.setPaintProperty('corridor-3d', 'fill-extrusion-color', fillColor(layer))
      columnKey.current = ''
      paintHour()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer])

  // --- visibility: heatmap on/off, 2D vs 3D --------------------------------
  useEffect(() => {
    const map = mapRef.current
    readyRef.current?.then(() => {
      if (!map) return
      map.setLayoutProperty('corridor-fill', 'visibility', showHeatmap ? 'visible' : 'none')
      map.setLayoutProperty('corridor-3d', 'visibility', showHeatmap && is3D ? 'visible' : 'none')
      columnKey.current = ''
      paintHour()
      map.setLayoutProperty('hillshade', 'visibility', is3D ? 'visible' : 'none')
      if (is3D) {
        map.setTerrain({ source: 'terrain', exaggeration: 1.4 })
        map.easeTo({ pitch: 58, bearing: -15, duration: 1200 })
      } else {
        map.setTerrain(null)
        map.easeTo({ pitch: 0, bearing: 0, duration: 900 })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeatmap, is3D])

  // --- selected route -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    readyRef.current?.then(() => {
      if (!map) return
      const selected = selectedRouteId ?? ''
      const isSel: ExpressionSpecification = ['==', ['get', 'route'], selected]
      map.setPaintProperty('route-base', 'line-opacity', ['case', isSel, 1, 0.55])
      map.setPaintProperty('route-base', 'line-width', ['case', isSel, 9, 5])
      map.setPaintProperty('segments', 'line-opacity', ['case', isSel, 1, 0.45])
      map.setPaintProperty('segments', 'line-width', ['case', isSel, 5.5, 2.5])
      map.setPaintProperty('checkpoints', 'circle-opacity', ['case', isSel, 1, 0.5])
      map.setPaintProperty('checkpoints', 'circle-stroke-opacity', ['case', isSel, 1, 0.5])
      map.setLayoutProperty('segments', 'line-sort-key', ['case', isSel, 1, 0])
    })
  }, [selectedRouteId, plan])

  // --- checkpoint hover from the sidebar strip ------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !plan || !hoveredCheckpoint) return
    const id = checkpointId(plan, hoveredCheckpoint.routeId, hoveredCheckpoint.index)
    map.setFeatureState({ source: 'checkpoints', id }, { hover: true })
    const route = plan.routes.find((r) => r.id === hoveredCheckpoint.routeId)!
    const cp = route.checkpoints[hoveredCheckpoint.index]
    const popup = new Popup({ closeButton: false, closeOnClick: false, className: 'cp-popup', offset: 12 })
      .setLngLat([cp.lng, cp.lat])
      .setHTML(checkpointPopupHtml(route, cp))
      .addTo(map)
    return () => {
      map.setFeatureState({ source: 'checkpoints', id }, { hover: false })
      popup.remove()
    }
  }, [hoveredCheckpoint, plan])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} />
}

function addLayers(map: MapLibre) {
  // Draw data under the basemap's labels so place names stay readable.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  const empty = () => ({ type: 'geojson' as const, data: EMPTY as unknown as GeoJSON.FeatureCollection })

  map.addSource('terrain', { type: 'raster-dem', url: TERRAIN_URL, encoding: 'terrarium', tileSize: 512 })
  map.addSource('hillshade-dem', { type: 'raster-dem', url: TERRAIN_URL, encoding: 'terrarium', tileSize: 512 })
  for (const id of ['corridor', 'columns', 'routes', 'segments', 'checkpoints', 'endpoints', 'trucks']) map.addSource(id, empty())

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
    {
      id: 'corridor-fill',
      type: 'fill',
      source: 'corridor',
      paint: { 'fill-color': RISK_STEP, 'fill-opacity': fillOpacity('risk'), 'fill-outline-color': 'rgba(255,255,255,0.06)' },
    },
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
  map.addLayer({
    id: 'route-base',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0b1a22', 'line-width': 7 },
  })
  map.addLayer({
    id: 'segments',
    type: 'line',
    source: 'segments',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': RISK_LINE_COLOR, 'line-width': 4 },
  })
  map.addLayer({
    id: 'route-hit',
    type: 'line',
    source: 'routes',
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 },
  })
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
      'circle-radius': 8,
      'circle-color': ['match', ['get', 'kind'], 'origin', '#40E0D0', '#ffffff'],
      'circle-stroke-color': '#043344',
      'circle-stroke-width': 3,
    },
  })
  map.addLayer({
    id: 'trucks',
    type: 'circle',
    source: 'trucks',
    paint: { 'circle-radius': 11, 'circle-color': '#043344', 'circle-stroke-color': '#40E0D0', 'circle-stroke-width': 2.5 },
  })
  map.addLayer({
    id: 'truck-labels',
    type: 'symbol',
    source: 'trucks',
    layout: { 'text-field': ['get', 'route'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  })
  map.setSky({ 'sky-color': '#0b1a22', 'horizon-color': '#1c3a48', 'fog-color': '#0b1a22', 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.6 })
}

function bindInteractions(map: MapLibre, callbacks: { current: Props }) {
  map.on('click', 'route-hit', (e) => {
    const id = e.features?.[0]?.properties?.route
    if (id) callbacks.current.onSelectRoute(id)
  })
  map.on('mousemove', 'checkpoints', (e) => {
    const f = e.features?.[0]
    if (!f) return
    map.getCanvas().style.cursor = 'pointer'
    const { route, index } = f.properties as { route: string; index: number }
    const cur = callbacks.current.hoveredCheckpoint
    if (cur?.routeId !== route || cur.index !== index) callbacks.current.onHoverCheckpoint({ routeId: route, index })
  })
  map.on('mouseleave', 'checkpoints', () => {
    map.getCanvas().style.cursor = ''
    callbacks.current.onHoverCheckpoint(null)
  })
  map.on('mouseenter', 'route-hit', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'route-hit', () => (map.getCanvas().style.cursor = ''))
}
