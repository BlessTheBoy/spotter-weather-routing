import { useEffect, useRef, useState } from 'react'
import type { LngLat, Route } from '@/api/types'
import { positionAfter } from './forecast'

const EARTH_RADIUS_MI = 3958.7613
const rad = Math.PI / 180

function haversineMi([x1, y1]: LngLat, [x2, y2]: LngLat): number {
  const h = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h))
}

function bearing([x1, y1]: LngLat, [x2, y2]: LngLat): number {
  const y = Math.sin((x2 - x1) * rad) * Math.cos(y2 * rad)
  const x = Math.cos(y1 * rad) * Math.sin(y2 * rad) - Math.sin(y1 * rad) * Math.cos(y2 * rad) * Math.cos((x2 - x1) * rad)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/** Seconds of driving to reach a mile mark, and the reverse. */
function lookup(xs: number[], ys: number[], x: number): number {
  let lo = 0
  let hi = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[hi]) return ys[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const t = xs[hi] > xs[lo] ? (x - xs[lo]) / (xs[hi] - xs[lo]) : 0
  return ys[lo] + t * (ys[hi] - ys[lo])
}

export type NavSource = 'gps' | 'simulated'
export const SPEEDS = [1, 10, 60, 300] as const

export interface NavState {
  source: NavSource
  position: LngLat
  bearing: number
  mile: number
  elapsedS: number
  speed: number
  playing: boolean
  arrived: boolean
  /** Why GPS isn't used, shown next to the "Simulated" label. */
  reason: string | null
  /** True when the heading comes from the phone's compass. */
  compass: boolean
}

/** Where the camera should be this frame. Updated every animation frame, outside React. */
export interface CameraTarget {
  position: LngLat
  bearing: number
}

/**
 * iOS only exposes the compass after an explicit permission request, which
 * must run inside a user gesture. Call this from the Start button's handler.
 */
export async function requestCompass(): Promise<void> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof D?.requestPermission === 'function') {
    try {
      await D.requestPermission()
    } catch {
      /* user said no: we fall back to the route's direction */
    }
  }
}

/**
 * Drives Navigate. Uses live GPS when it's allowed and the device is near the
 * start; otherwise replays the route at a chosen speed, clearly labelled.
 * The camera target updates every frame through `camera`; React state (for
 * the banners) updates a few times a second.
 */
export function useNavigation(route: Route | null, active: boolean, preview = false) {
  const [state, setState] = useState<NavState | null>(null)
  const camera = useRef<CameraTarget | null>(null)
  const speed = useRef<number>(60)
  const playing = useRef(true)

  useEffect(() => {
    camera.current = null
    if (!route || !active) return setState(null)
    const raw = [0]
    for (let i = 1; i < route.geometry.length; i++) raw.push(raw[i - 1] + haversineMi(route.geometry[i - 1], route.geometry[i]))
    const k = route.distance_mi / (raw[raw.length - 1] || 1)
    const miles = raw.map((x) => x * k)
    const times = route.geometry_times_s

    let elapsed = 0
    let raf = 0
    let last = 0
    let lastEmit = 0
    let watch: number | null = null
    let source: NavSource = 'simulated'
    let reason: string | null = 'Location unavailable'
    let compassHeading: number | null = null
    let gpsPos: LngLat | null = null

    // Heading-up: look a little way down the road so curves turn the map early but gently.
    const routeBearing = (mile: number) => {
      const here = positionAfter(route, lookup(miles, times, mile))
      const ahead = positionAfter(route, lookup(miles, times, Math.min(route.distance_mi, mile + 0.25)))
      return bearing(here, ahead)
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      const ios = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading
      if (typeof ios === 'number') compassHeading = ios
      else if (e.absolute && e.alpha != null) compassHeading = (360 - e.alpha) % 360
    }
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener)
    window.addEventListener('deviceorientation', onOrientation)

    const frame = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0
      last = now
      if (source === 'simulated' && playing.current) elapsed = Math.min(route.duration_s, elapsed + dt * speed.current)
      const mile = lookup(times, miles, elapsed)
      const position = source === 'gps' && gpsPos ? gpsPos : positionAfter(route, elapsed)
      // On a phone with a compass and real GPS, the map turns with the phone, like Google Maps.
      const useCompass = source === 'gps' && compassHeading != null
      const heading = useCompass ? compassHeading! : routeBearing(mile)
      camera.current = { position, bearing: heading }
      if (now - lastEmit > 150) {
        lastEmit = now
        setState({
          source,
          position,
          bearing: heading,
          mile,
          elapsedS: elapsed,
          speed: speed.current,
          playing: playing.current,
          arrived: mile >= route.distance_mi - 0.05,
          reason: source === 'simulated' ? reason : null,
          compass: useCompass,
        })
      }
      raf = requestAnimationFrame(frame)
    }

    const simulate = (why: string) => {
      source = 'simulated'
      reason = why
      if (watch != null) navigator.geolocation.clearWatch(watch)
      watch = null
    }

    if (preview) simulate('Preview of the planned departure')
    else if (!navigator.geolocation) simulate('Location unavailable')
    else {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const here: LngLat = [p.coords.longitude, p.coords.latitude]
          if (haversineMi(here, route.geometry[0]) > 2) return simulate('You’re not at the start')
          source = 'gps'
          watch = navigator.geolocation.watchPosition(
            (q) => {
              gpsPos = [q.coords.longitude, q.coords.latitude]
              // Progress along the route: nearest vertex.
              let best = 0
              let bestD = Infinity
              route.geometry.forEach((g, i) => {
                const d = (g[0] - gpsPos![0]) ** 2 + (g[1] - gpsPos![1]) ** 2
                if (d < bestD) ((bestD = d), (best = i))
              })
              elapsed = times[best]
            },
            () => simulate('Location lost'),
            { enableHighAccuracy: true, maximumAge: 1000 },
          )
        },
        () => simulate('Location not allowed'),
        { timeout: 6000 },
      )
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      if (watch != null) navigator.geolocation.clearWatch(watch)
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
      window.removeEventListener('deviceorientation', onOrientation)
    }
  }, [route, active, preview])

  return {
    state,
    camera,
    setSpeed: (s: number) => (speed.current = s),
    togglePlaying: () => (playing.current = !playing.current),
  }
}
