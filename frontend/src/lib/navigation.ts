import { useEffect, useRef, useState } from 'react'
import type { LngLat, Route } from '../api/types'
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

/** Miles along the route reached after `elapsed` seconds of driving. */
function mileAfter(route: Route, miles: number[], elapsed: number): number {
  const times = route.geometry_times_s
  let lo = 0
  let hi = times.length - 1
  if (elapsed >= times[hi]) return miles[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= elapsed) lo = mid
    else hi = mid
  }
  const t = times[hi] > times[lo] ? (elapsed - times[lo]) / (times[hi] - times[lo]) : 0
  return miles[lo] + t * (miles[hi] - miles[lo])
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
}

/**
 * Drives Navigate. Uses live GPS when it's allowed and the device is near the
 * start; otherwise replays the route at a chosen speed, clearly labelled.
 */
export function useNavigation(route: Route | null, active: boolean) {
  const miles = useRef<number[]>([])
  const [state, setState] = useState<NavState | null>(null)
  const speed = useRef(60)
  const playing = useRef(true)

  useEffect(() => {
    if (!route || !active) return setState(null)
    const m = [0]
    for (let i = 1; i < route.geometry.length; i++) m.push(m[i - 1] + haversineMi(route.geometry[i - 1], route.geometry[i]))
    const k = route.distance_mi / (m[m.length - 1] || 1)
    miles.current = m.map((x) => x * k)
    let elapsed = 0
    let raf = 0
    let last = 0
    let watch: number | null = null
    let source: NavSource = 'simulated'
    let reason: string | null = 'Location unavailable'

    const emit = (pos: LngLat, mile: number) => {
      const ahead = positionAfter(route, elapsed + 90 * Math.max(1, speed.current / 10))
      setState({
        source,
        position: pos,
        bearing: bearing(pos, ahead),
        mile,
        elapsedS: elapsed,
        speed: speed.current,
        playing: playing.current,
        arrived: mile >= route.distance_mi - 0.05,
        reason: source === 'simulated' ? reason : null,
      })
    }

    let lastEmit = 0
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0
      last = now
      if (playing.current) elapsed = Math.min(route.duration_s, elapsed + dt * speed.current)
      // ~8 updates a second is smooth with the camera's eased moves and keeps React re-renders cheap.
      if (now - lastEmit > 120) {
        lastEmit = now
        emit(positionAfter(route, elapsed), mileAfter(route, miles.current, elapsed))
      }
      raf = requestAnimationFrame(tick)
    }
    const simulate = (why: string) => {
      source = 'simulated'
      reason = why
      if (watch != null) navigator.geolocation.clearWatch(watch)
      watch = null
      raf = requestAnimationFrame(tick)
    }

    if (!navigator.geolocation) simulate('Location unavailable')
    else {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const here: LngLat = [p.coords.longitude, p.coords.latitude]
          if (haversineMi(here, route.geometry[0]) > 2) return simulate('You’re not at the start')
          source = 'gps'
          watch = navigator.geolocation.watchPosition(
            (q) => {
              const pos: LngLat = [q.coords.longitude, q.coords.latitude]
              // Snap to the nearest route vertex for progress along the route.
              let best = 0
              let bestD = Infinity
              route.geometry.forEach((g, i) => {
                const d = (g[0] - pos[0]) ** 2 + (g[1] - pos[1]) ** 2
                if (d < bestD) ((bestD = d), (best = i))
              })
              elapsed = route.geometry_times_s[best]
              emit(pos, miles.current[best])
            },
            () => simulate('Location lost'),
            { enableHighAccuracy: true, maximumAge: 2000 },
          )
        },
        () => simulate('Location not allowed'),
        { timeout: 6000 },
      )
    }
    emit(route.geometry[0], 0)
    return () => {
      cancelAnimationFrame(raf)
      if (watch != null) navigator.geolocation.clearWatch(watch)
    }
  }, [route, active])

  return {
    state,
    setSpeed: (s: number) => (speed.current = s),
    togglePlaying: () => (playing.current = !playing.current),
  }
}
