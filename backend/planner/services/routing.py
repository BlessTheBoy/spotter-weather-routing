"""Three route options: TomTom truck routing first, OSRM as a keyless fallback.

Neither provider guarantees three distinct alternatives. When fewer come back
we force more by routing through a via point pushed sideways off the fastest
route's midpoint, then drop any route that mostly overlaps one we already have.
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime

import requests
from django.conf import settings

from ..domain.geometry import METERS_PER_MILE, LngLat, decode_polyline, haversine_mi
from .http import TIMEOUT_S, UpstreamError, cache_key, cached, session

log = logging.getLogger("planner")

TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{locations}"
LB_TO_KG = 0.45359237
WANTED = 3
OVERLAP_LIMIT = 0.8  # routes sharing more than this share of their length are "the same"
ROUTE_TTL_S = 30 * 60  # traffic-aware ETAs go stale


@dataclass
class Route:
    points: list[LngLat]
    times_s: list[float]  # travel time from the start to each point
    distance_mi: float
    duration_s: float
    provider: str
    via: LngLat | None = None
    id: str = ""
    label: str = ""
    notes: list[str] = field(default_factory=list)


# --- TomTom ---------------------------------------------------------------


def _tomtom(stops: list[LngLat], departure: datetime, load_lb: float, alternatives: int) -> list[Route]:
    locations = ":".join(f"{lat:.6f},{lng:.6f}" for lng, lat in stops)
    params = {
        "key": settings.TOMTOM_API_KEY,
        "travelMode": "truck",
        "vehicleCommercial": "true",
        "vehicleWeight": round(load_lb * LB_TO_KG),
        "departAt": departure.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "traffic": "true",
        "routeType": "fastest",
        "maxAlternatives": alternatives,
        "routeRepresentation": "polyline",
        "computeTravelTimeFor": "all",
        "extendedRouteRepresentation": ["distance", "travelTime"],
    }
    r = session.get(TOMTOM_URL.format(locations=locations), params=params, timeout=TIMEOUT_S)
    if r.status_code in (400, 404):
        detail = r.json().get("detailedError", {}).get("message") if r.headers.get("content-type", "").startswith("application/json") else None
        raise UpstreamError(detail or "TomTom could not find a truck route between these places.")
    r.raise_for_status()

    routes = []
    for raw in r.json().get("routes", []):
        points = [(p["longitude"], p["latitude"]) for leg in raw["legs"] for p in leg["points"]]
        progress = raw.get("progress") or []
        # `progress` gives travel time at some point indices; interpolate the rest.
        known = {p["pointIndex"]: float(p.get("travelTimeInSeconds", 0)) for p in progress}
        times = _fill_times(len(points), known, float(raw["summary"]["travelTimeInSeconds"]))
        routes.append(
            Route(
                points=points,
                times_s=times,
                distance_mi=raw["summary"]["lengthInMeters"] / METERS_PER_MILE,
                duration_s=float(raw["summary"]["travelTimeInSeconds"]),
                provider="TomTom truck",
            )
        )
    return routes


def _fill_times(n: int, known: dict[int, float], total_s: float) -> list[float]:
    known = {0: 0.0, **known, n - 1: known.get(n - 1, total_s)}
    idx = sorted(known)
    out = [0.0] * n
    for a, b in zip(idx, idx[1:]):
        for i in range(a, b + 1):
            t = (i - a) / (b - a) if b > a else 0
            out[i] = known[a] + t * (known[b] - known[a])
    return out


# --- OSRM -----------------------------------------------------------------


def _osrm(stops: list[LngLat], alternatives: int) -> list[Route]:
    locations = ";".join(f"{lng:.6f},{lat:.6f}" for lng, lat in stops)
    params = {
        "alternatives": alternatives if alternatives else "false",
        "overview": "full",
        "geometries": "polyline",
        "annotations": "duration",
    }
    r = session.get(OSRM_URL.format(locations=locations), params=params, timeout=TIMEOUT_S)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != "Ok":
        raise UpstreamError("No drivable route was found between these places.")
    routes = []
    for raw in body["routes"]:
        points = decode_polyline(raw["geometry"])
        durations = [d for leg in raw["legs"] for d in leg["annotation"]["duration"]]
        times = [0.0]
        for d in durations:
            times.append(times[-1] + d)
        # Legs repeat the via vertex, so annotation and geometry lengths can drift by a few.
        times = (times + [times[-1]] * len(points))[: len(points)]
        routes.append(
            Route(
                points=points,
                times_s=times,
                distance_mi=raw["distance"] / METERS_PER_MILE,
                duration_s=float(raw["duration"]),
                provider="OSRM (car profile)",
            )
        )
    return routes


# --- Alternatives ---------------------------------------------------------


def _overlap(a: Route, b: Route, tolerance_mi: float = 1.5) -> float:
    """Share of a's sampled points that lie within tolerance of b."""
    sample_a = a.points[:: max(1, len(a.points) // 120)]
    sample_b = b.points[:: max(1, len(b.points) // 600)]
    near = sum(1 for p in sample_a if any(haversine_mi(p, q) <= tolerance_mi for q in sample_b))
    return near / len(sample_a)


def _is_distinct(candidate: Route, chosen: list[Route]) -> bool:
    return all(_overlap(candidate, r) < OVERLAP_LIMIT for r in chosen)


def _via_points(base: Route) -> list[LngLat]:
    """Points pushed sideways from the middle of the route, both sides, two distances."""
    mid = base.points[len(base.points) // 2]
    start, end = base.points[0], base.points[-1]
    # Work in a local flat frame: x scaled by cos(latitude).
    k = math.cos(math.radians(mid[1]))
    dx, dy = (end[0] - start[0]) * k, end[1] - start[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length  # unit normal, in degrees of latitude
    straight_deg = length
    vias = []
    for share in (0.12, 0.22):
        for side in (1, -1):
            off = straight_deg * share * side
            vias.append((mid[0] + nx * off / k, mid[1] + ny * off))
    return vias


def _fetch(stops: list[LngLat], departure: datetime, load_lb: float, alternatives: int, use_tomtom: bool) -> list[Route]:
    key = cache_key("route", [stops, departure.strftime("%Y%m%d%H%M"), round(load_lb, -2), alternatives, use_tomtom])

    def fetch():
        try:
            if use_tomtom:
                return _tomtom(stops, departure, load_lb, alternatives)
            return _osrm(stops, alternatives)
        except requests.RequestException as exc:
            raise UpstreamError("The routing service is unavailable right now.") from exc

    return cached(key, ROUTE_TTL_S, fetch)


def route_options(origin: LngLat, destination: LngLat, departure: datetime, load_lb: float) -> list[Route]:
    use_tomtom = bool(settings.TOMTOM_API_KEY)
    try:
        routes = _fetch([origin, destination], departure, load_lb, WANTED - 1, use_tomtom)
    except UpstreamError:
        if not use_tomtom:
            raise
        log.warning("TomTom failed, falling back to OSRM", exc_info=True)
        use_tomtom = False
        routes = _fetch([origin, destination], departure, load_lb, WANTED - 1, use_tomtom)
    if not routes:
        raise UpstreamError("No route was found between these places.")

    chosen: list[Route] = []
    for r in routes:
        if _is_distinct(r, chosen):
            chosen.append(r)

    for via in _via_points(chosen[0]):
        if len(chosen) >= WANTED:
            break
        try:
            forced = _fetch([origin, via, destination], departure, load_lb, 0, use_tomtom)
        except UpstreamError:
            continue
        if forced and _is_distinct(forced[0], chosen):
            forced[0].via = via
            chosen.append(forced[0])

    chosen.sort(key=lambda r: r.duration_s)
    for i, r in enumerate(chosen[:WANTED]):
        r.id = "ABC"[i]
        r.label = f"Route {r.id}"
        if r.via:
            r.notes.append("Alternative forced through a via point; the provider returned fewer than three.")
    return chosen[:WANTED]
