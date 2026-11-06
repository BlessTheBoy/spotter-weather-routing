import type { Place } from '@/api/types'

export const REGION_MESSAGE = 'Routing is available in the US and Canada.'

/** Rough US + Canada box (incl. Alaska); the backend does the exact check. */
export function inRoutingRegion(p: { lat: number; lng: number }): boolean {
  return p.lat >= 24 && p.lat <= 72 && p.lng >= -170 && p.lng <= -52
}

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share your location. Type a starting place.'))
    navigator.geolocation.getCurrentPosition(resolve, (e) => {
      reject(
        new Error(
          e.code === e.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in your browser’s site settings, or type a starting place.'
            : 'Couldn’t get your location. Try again or type a starting place.',
        ),
      )
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 })
  })
}

/**
 * Asks for location (this is what triggers the browser's permission prompt)
 * and names the place, so the user can see it worked.
 */
export async function describeCurrentLocation(): Promise<Place> {
  const p = await position()
  const lat = p.coords.latitude
  const lng = p.coords.longitude
  let name = `${lat.toFixed(3)}, ${lng.toFixed(3)}`
  try {
    // Photon's reverse geocoder is keyless and CORS-enabled.
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`)
    const f = (await r.json()).features?.[0]?.properties
    if (f) name = [f.city ?? f.name, f.state, f.countrycode].filter(Boolean).join(', ')
  } catch {
    /* keep coordinates */
  }
  return { label: `Your location · ${name}`, lat, lng }
}
