// Weather badges drawn on demand as MapLibre images. An image id encodes the
// badge: "badge:<level>:<elements>", e.g. "badge:3:ws" = Severe, wind + snow.
import type { Map as MapLibre } from 'maplibre-gl'
import { RISK_LEVELS } from '@/lib/risk'

// Lucide line icons (24x24, stroked), the same set the UI uses: wind, cloud-rain, snowflake, ban.
const ICONS: Record<string, string[]> = {
  w: ["M12.8 19.6A2 2 0 1 0 14 16H2", "M17.5 8a2.5 2.5 0 1 1 2 4H2", "M9.8 4.4A2 2 0 1 1 11 8H2"],
  r: ["M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242", "M16 14v6", "M8 14v6", "M12 16v6"],
  s: ["m10 20-1.25-2.5L6 18", "M10 4 8.75 6.5 6 6", "m14 20 1.25-2.5L18 18", "m14 4 1.25 2.5L18 6", "m17 21-3-6h-4", "m17 3-3 6 1.5 3", "M2 12h6.5L10 9", "m20 10-1.5 2 1.5 2", "M22 12h-6.5L14 15", "m4 10 1.5 2L4 14", "m7 21 3-6-1.5-3", "m7 3 3 6h4"],
  ban: ["M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20", "M4.929 4.929 19.07 19.071"],
}

const SCALE = 2 // render at 2x for crisp badges on retina screens

function svgFor(level: number, elements: string): { svg: string; width: number; height: number } {
  const color = RISK_LEVELS[level].color
  const glyphs = elements.split('').concat(level === 4 ? ['ban'] : [])
  const icon = 15
  const gap = 3
  const pad = 7
  const bang = level === 3 ? 7 : 0
  const w = pad * 2 + glyphs.length * icon + (glyphs.length - 1) * gap + bang
  const h = 26
  const stem = 8
  const fill = level === 2 ? '#131A20' : color
  const ink = level === 2 ? color : '#ffffff'
  const stroke = level === 4 ? '#ffffff' : color
  let x = pad
  const paths = glyphs
    .map((g) => {
      const out = `<g transform="translate(${x} ${(h - icon) / 2}) scale(${icon / 24})" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[g].map((d) => `<path d="${d}"/>`).join('')}</g>`
      x += icon + gap
      return out
    })
    .join('')
  const ex = bang ? `<text x="${x - gap + 1}" y="${h / 2 + 5}" font-family="DM Sans, sans-serif" font-weight="700" font-size="14" fill="${ink}">!</text>` : ''
  const halo = level === 4 ? `<rect x="1" y="1" width="${w + 4}" height="${h + 4}" rx="${(h + 4) / 2}" fill="${color}" opacity="0.35"/>` : ''
  const o = level === 4 ? 3 : 1
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w + 6) * SCALE}" height="${(h + stem + 6) * SCALE}" viewBox="0 0 ${w + 6} ${h + stem + 6}">
    ${halo}
    <line x1="${w / 2 + o}" y1="${h + o}" x2="${w / 2 + o}" y2="${h + stem + o}" stroke="${color}" stroke-width="2"/>
    <rect x="${o}" y="${o}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <g transform="translate(${o} ${o})">${paths}${ex}</g>
  </svg>`
  return { svg, width: (w + 6) * SCALE, height: (h + stem + 6) * SCALE }
}

const COMBOS = ['w', 'r', 's', 'wr', 'ws', 'rs', 'wrs']

/** Draw every badge variant up front (3 levels x 7 element combos) so symbols never wait on an image. */
export async function loadBadgeImages(map: MapLibre): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const level of [2, 3, 4])
    for (const combo of COMBOS) {
      const id = `badge:${level}:${combo}`
      const { svg, width, height } = svgFor(level, combo)
      const img = new Image(width, height)
      jobs.push(
        new Promise((resolve) => {
          img.onload = () => {
            if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: SCALE })
            resolve()
          }
          img.onerror = () => resolve()
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        }),
      )
    }
  await Promise.all(jobs)
}
