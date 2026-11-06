import { useSyncExternalStore } from 'react'

/**
 * The forecast hour lives outside React state. Scrubbing and playback update
 * it up to 60 times a second; the map subscribes directly and repaints only
 * the heatmap, while React components that show the time re-render through
 * useForecastHour.
 */
export function createClock(maxHour: number) {
  let hour = 0
  let playing = false
  let raf = 0
  let last = 0
  let stopAt = maxHour
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  const HOURS_PER_SECOND = 4

  function tick(now: number) {
    const dt = last ? (now - last) / 1000 : 0
    last = now
    hour += dt * HOURS_PER_SECOND
    if (hour >= stopAt) {
      hour = stopAt
      playing = false
    }
    emit()
    if (playing) raf = requestAnimationFrame(tick)
  }

  return {
    maxHour,
    get: () => hour,
    isPlaying: () => playing,
    set(h: number) {
      hour = Math.min(maxHour, Math.max(0, h))
      emit()
    },
    /** Play forward, stopping at `untilHour` (e.g. the truck's arrival) or the end of the track. */
    play(untilHour = maxHour) {
      if (playing) return
      stopAt = Math.min(maxHour, untilHour)
      if (hour >= stopAt) hour = 0
      playing = true
      last = 0
      raf = requestAnimationFrame(tick)
      emit()
    },
    pause() {
      playing = false
      cancelAnimationFrame(raf)
      emit()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export type Clock = ReturnType<typeof createClock>

export function useForecastHour(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get)
}

export function usePlaying(clock: Clock): boolean {
  return useSyncExternalStore(clock.subscribe, clock.isPlaying)
}
