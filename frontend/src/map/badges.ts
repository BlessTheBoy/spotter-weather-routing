// Weather badges drawn on demand as MapLibre images. An image id encodes the
// badge: "badge:<level>:<elements>", e.g. "badge:3:ws" = Severe, wind + snow.
import type { Map as MapLibre } from 'maplibre-gl'
import { RISK_LEVELS } from '../lib/risk'

// Material icon paths (24×24): Air, WaterDrop, AcUnit, Block.
const ICONS: Record<string, string> = {
  w: 'M14.5 17c0 1.65-1.35 3-3 3s-3-1.35-3-3h2c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1H2v-2h9.5c1.65 0 3 1.35 3 3M19 6.5C19 4.57 17.43 3 15.5 3S12 4.57 12 6.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S16.33 8 15.5 8H2v2h13.5c1.93 0 3.5-1.57 3.5-3.5m-.5 4.5H2v2h16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5v2c1.93 0 3.5-1.57 3.5-3.5S20.43 11 18.5 11',
  r: 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8',
  s: 'M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z',
  ban: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2M4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12m8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8',
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
      const out = `<g transform="translate(${x} ${(h - icon) / 2}) scale(${icon / 24})"><path d="${ICONS[g]}" fill="${ink}"/></g>`
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
