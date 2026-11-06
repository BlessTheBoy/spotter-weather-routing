"""Polyline maths: distances, and checkpoints at fixed mile intervals with ETAs."""

import math
from bisect import bisect_left
from dataclasses import dataclass

EARTH_RADIUS_MI = 3958.7613
METERS_PER_MILE = 1609.344

LngLat = tuple[float, float]


def haversine_mi(a: LngLat, b: LngLat) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(h))


def cumulative_miles(points: list[LngLat]) -> list[float]:
    out = [0.0]
    for prev, cur in zip(points, points[1:]):
        out.append(out[-1] + haversine_mi(prev, cur))
    return out


@dataclass(frozen=True)
class Checkpoint:
    mile: float
    lng: float
    lat: float
    eta_offset_s: float
    # Miles of the route this checkpoint stands for (half the gap to each neighbour).
    represents_mi: float


def _interpolate(x: float, xs: list[float], ys: list[float]) -> float:
    i = bisect_left(xs, x)
    if i <= 0:
        return ys[0]
    if i >= len(xs):
        return ys[-1]
    x0, x1 = xs[i - 1], xs[i]
    t = 0.0 if x1 == x0 else (x - x0) / (x1 - x0)
    return ys[i - 1] + t * (ys[i] - ys[i - 1])


def checkpoints_along(
    points: list[LngLat],
    times_s: list[float],
    interval_mi: float,
    total_mi: float | None = None,
) -> list[Checkpoint]:
    """Checkpoints at 0, interval, 2*interval, ... and at the destination.

    `times_s` is the travel time from the start to each polyline vertex. The
    route's own reported length (total_mi) scales our haversine miles so that
    checkpoint miles agree with the routing provider's distance.
    """
    if len(points) < 2 or len(points) != len(times_s):
        raise ValueError("need at least two points with a time for each")
    raw = cumulative_miles(points)
    scale = (total_mi / raw[-1]) if total_mi and raw[-1] > 0 else 1.0
    miles = [m * scale for m in raw]
    length = miles[-1]

    marks = [i * interval_mi for i in range(int(length // interval_mi) + 1)]
    if length - marks[-1] > 1e-6:
        marks.append(length)

    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    out = []
    for i, mile in enumerate(marks):
        prev_gap = mile - marks[i - 1] if i > 0 else 0.0
        next_gap = marks[i + 1] - mile if i + 1 < len(marks) else 0.0
        out.append(
            Checkpoint(
                mile=mile,
                lng=_interpolate(mile, miles, lngs),
                lat=_interpolate(mile, miles, lats),
                eta_offset_s=_interpolate(mile, miles, times_s),
                represents_mi=(prev_gap + next_gap) / 2,
            )
        )
    return out


def decode_polyline(encoded: str, precision: int = 5) -> list[LngLat]:
    """Google encoded polyline (used by OSRM) to [lng, lat] pairs."""
    coords, index, lat, lng = [], 0, 0, 0
    factor = 10**precision
    while index < len(encoded):
        for is_lng in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lng:
                lng += delta
            else:
                lat += delta
        coords.append((lng / factor, lat / factor))
    return coords


def simplify(points: list[LngLat], max_points: int) -> list[int]:
    """Indices of an evenly thinned subset, always keeping both ends."""
    n = len(points)
    if n <= max_points:
        return list(range(n))
    step = (n - 1) / (max_points - 1)
    return sorted({round(i * step) for i in range(max_points)})
