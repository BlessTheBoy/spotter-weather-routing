"""The heatmap corridor: H3 hexagons covering a band around every route.

The resolution is chosen per trip so the weather lookups stay inside budget:
short trips get fine hexes, cross-country trips coarser ones. The caller says
what a set of cells costs; by default each cell is one lookup.
"""

from collections.abc import Callable
from dataclasses import dataclass

import h3

from .geometry import LngLat, cumulative_miles

# Resolution -> approximate distance between neighbouring hex centres, in miles.
RESOLUTIONS = {6: 3.9, 5: 10.3, 4: 27.2, 3: 72.0}


@dataclass(frozen=True)
class Cell:
    id: str
    center: LngLat
    boundary: list[LngLat]


def _cells_at(routes: list[list[LngLat]], res: int) -> set[str]:
    step = RESOLUTIONS[res] / 2
    cells: set[str] = set()
    for points in routes:
        miles = cumulative_miles(points)
        next_mark = 0.0
        for p, m in zip(points, miles):
            if m >= next_mark:
                cells.add(h3.latlng_to_cell(p[1], p[0], res))
                next_mark = m + step
        cells.add(h3.latlng_to_cell(points[-1][1], points[-1][0], res))
    # One ring of neighbours gives a band roughly three hexes wide.
    return {n for c in cells for n in h3.grid_disk(c, 1)}


def center(cell_id: str) -> LngLat:
    lat, lng = h3.cell_to_latlng(cell_id)
    return (lng, lat)


def corridor(routes: list[list[LngLat]], budget: int, cost: Callable[[set[str]], int] = len) -> tuple[int, list[Cell]]:
    for res in sorted(RESOLUTIONS, reverse=True):
        ids = _cells_at(routes, res)
        if cost(ids) <= budget or res == min(RESOLUTIONS):
            break
    cells = []
    for cid in sorted(ids):
        ring = [(round(x, 5), round(y, 5)) for y, x in h3.cell_to_boundary(cid)]
        cells.append(Cell(cid, center(cid), ring + ring[:1]))
    return res, cells
