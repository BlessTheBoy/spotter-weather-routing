import { describe, expect, it } from 'vitest'
import type { Corridor, Route } from '../api/types'
import { positionAt, valuesAt } from './forecast'

const corridor = {
  resolution: 4,
  hours: ['2026-11-07T00:00:00Z', '2026-11-07T01:00:00Z'],
  cells: [
    { id: 'a', center: [0, 0], boundary: [] },
    { id: 'b', center: [1, 0], boundary: [] },
  ],
  risk: [0, 1, 2, 3],
  wind_mph: [10, 20, 30, 40],
  rain_in_hr: [0, 0, 0, 0],
  snow_in_hr: [0, 0, 0, 0],
} satisfies Corridor

describe('valuesAt', () => {
  it('blends continuous layers between hours', () => {
    const out = valuesAt(corridor, 'wind_mph', 0.5, new Float32Array(2))
    expect([...out]).toEqual([20, 30])
  })

  it('snaps risk to the nearest hour', () => {
    expect([...valuesAt(corridor, 'risk', 0.4, new Float32Array(2))]).toEqual([0, 1])
    expect([...valuesAt(corridor, 'risk', 0.6, new Float32Array(2))]).toEqual([2, 3])
  })

  it('clamps outside the forecast window', () => {
    expect([...valuesAt(corridor, 'wind_mph', 9, new Float32Array(2))]).toEqual([30, 40])
  })
})

describe('positionAt', () => {
  const route = {
    geometry: [
      [0, 0],
      [10, 0],
    ],
    geometry_times_s: [0, 3600],
  } as unknown as Route

  it('interpolates along the route by time', () => {
    expect(positionAt(route, Date.parse('2026-11-07T00:00:00Z'), Date.parse('2026-11-07T00:30:00Z'))).toEqual([5, 0])
  })

  it('is null before departure and after arrival', () => {
    expect(positionAt(route, Date.parse('2026-11-07T00:00:00Z'), Date.parse('2026-11-06T23:00:00Z'))).toBeNull()
    expect(positionAt(route, Date.parse('2026-11-07T00:00:00Z'), Date.parse('2026-11-07T02:00:00Z'))).toBeNull()
  })
})
