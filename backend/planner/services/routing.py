"""Three route options: TomTom truck routing first, OSRM as a keyless fallback.

Routes pass through the user's stops in order; TomTom still returns
alternatives with waypoints. Neither provider guarantees three distinct
alternatives. When fewer come back we force more by routing through a via point
pushed sideways off the fastest route's midpoint (inserted into the leg that
holds it), then drop any route that mostly overlaps one we already have.

Each route carries the provider's turn-by-turn guidance, folded into the app's
maneuver vocabulary, and is named after its main numbered roads.
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import numpy as np
import requests
from django.conf import settings

from ..domain.geometry import EARTH_RADIUS_MI, METERS_PER_MILE, LngLat, decode_polyline
from ..domain.guidance import Instruction, main_roads, osrm_maneuver, road_key, tomtom_maneuver
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
    instructions: list[Instruction] = field(default_factory=list)
    # Index of the last point of each leg (one leg per stop-to-stop stretch).
    leg_ends: list[int] = field(default_factory=list)
    forced_via: LngLat | None = None
    id: str = ""
    label: str = ""
    # Main roads from the guidance, e.g. "I-77, I-81".
    roads: str | None = None
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
        "instructionsType": "text",
        "language": "en-US",
    }
    r = session.get(TOMTOM_URL.format(locations=locations), params=params, timeout=TIMEOUT_S)
    if r.status_code in (400, 404):
        detail = (
            r.json().get("detailedError", {}).get("message") if r.headers.get("content-type", "").startswith("application/json") else None
        )
        raise UpstreamError(detail or "TomTom could not find a truck route between these places.")
    r.raise_for_status()

    routes = []
    for raw in r.json().get("routes", []):
        points, leg_ends = [], []
        for leg in raw["legs"]:
            points += [(p["longitude"], p["latitude"]) for p in leg["points"]]
            leg_ends.append(len(points) - 1)
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
                instructions=_tomtom_instructions(raw.get("guidance", {}).get("instructions", [])),
                leg_ends=leg_ends,
            )
        )
    return routes


def _tomtom_instructions(raw: list[dict]) -> list[Instruction]:
    out = []
    for step in raw:
        maneuver = tomtom_maneuver(step.get("maneuver", ""))
        numbers = step.get("roadNumbers") or []
        key = road_key(numbers)
        road = numbers[0] if numbers else step.get("street") or None
        if key and numbers:
            road = next((n for n in numbers if n.replace("I ", "I-", 1).startswith(key)), numbers[0])
        out.append(Instruction(round(step["routeOffsetInMeters"] / METERS_PER_MILE, 1), maneuver, step.get("message", ""), road, key))
    return _single_arrival(out)


def _single_arrival(steps: list[Instruction]) -> list[Instruction]:
    """Providers can describe the arrival in two steps; keep only the last."""
    arrivals = [i for i, s in enumerate(steps) if s.maneuver == "arrive"]
    return [s for i, s in enumerate(steps) if s.maneuver != "arrive" or i == arrivals[-1]]


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
        "steps": "true",
    }
    r = session.get(OSRM_URL.format(locations=locations), params=params, timeout=TIMEOUT_S)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != "Ok":
        raise UpstreamError("No drivable route was found between these places.")
    routes = []
    for raw in body["routes"]:
        points = decode_polyline(raw["geometry"])
        leg_ends, instructions, offset_m = [], [], 0.0
        for leg in raw["legs"]:
            for step in leg["steps"]:
                instructions.append(_osrm_instruction(step, offset_m))
                offset_m += step["distance"]
            leg_ends.append(_nearest_index(points, tuple(leg["steps"][-1]["maneuver"]["location"])))
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
                instructions=_single_arrival(instructions),
                leg_ends=leg_ends,
            )
        )
    return routes


def _osrm_instruction(step: dict, offset_m: float) -> Instruction:
    m = step["maneuver"]
    maneuver = osrm_maneuver(m["type"], m.get("modifier"))
    name = step.get("name") or None
    refs = [r.strip() for r in (step.get("ref") or "").split(";") if r.strip()]
    key = road_key(refs)
    road = key or name
    if maneuver == "depart":
        text = f"Leave from {road}" if road else "Leave from the start"
    elif maneuver == "arrive":
        text = "Arrive at your destination"
    else:
        verb = {
            "straight": "Continue",
            "left": "Turn left",
            "right": "Turn right",
            "slight_left": "Keep left",
            "slight_right": "Keep right",
        }[maneuver]
        text = f"{verb} onto {road}" if road else verb
    return Instruction(round(offset_m / METERS_PER_MILE, 1), maneuver, text, road, key)


def _nearest_index(points: list[LngLat], target: LngLat) -> int:
    return min(range(len(points)), key=lambda i: (points[i][0] - target[0]) ** 2 + (points[i][1] - target[1]) ** 2)


# --- Alternatives ---------------------------------------------------------


def _overlap(a: Route, b: Route, tolerance_mi: float = 1.5) -> float:
    """Share of a's sampled points that lie within tolerance of b."""
    sample_a = np.radians(a.points[:: max(1, len(a.points) // 120)])
    sample_b = np.radians(b.points[:: max(1, len(b.points) // 600)])
    (lng1, lat1), (lng2, lat2) = sample_a.T[:, :, None], sample_b.T[:, None, :]
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    nearest = 2 * EARTH_RADIUS_MI * np.arcsin(np.sqrt(h.min(axis=1)))
    return float(np.mean(nearest <= tolerance_mi))


def _is_distinct(candidate: Route, chosen: list[Route]) -> bool:
    return all(_overlap(candidate, r) < OVERLAP_LIMIT for r in chosen)


def _via_points(base: Route) -> list[tuple[int, LngLat]]:
    """Points pushed sideways from the middle of the route, both sides, two distances.

    Each comes with the leg it belongs in, so stops keep their order.
    """
    mid_i = len(base.points) // 2
    mid = base.points[mid_i]
    leg = next((k for k, end in enumerate(base.leg_ends) if mid_i <= end), 0)
    start = base.points[base.leg_ends[leg - 1] if leg else 0]
    end = base.points[base.leg_ends[leg] if base.leg_ends else -1]
    # Work in a local flat frame: x scaled by cos(latitude).
    k = math.cos(math.radians(mid[1]))
    dx, dy = (end[0] - start[0]) * k, end[1] - start[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length  # unit normal, in degrees of latitude
    vias = []
    for share in (0.12, 0.22):
        for side in (1, -1):
            off = length * share * side
            vias.append((leg, (mid[0] + nx * off / k, mid[1] + ny * off)))
    return vias


def _not_past(departure: datetime) -> datetime:
    """TomTom rejects a departAt in the past."""
    return max(departure, datetime.now(UTC) + timedelta(minutes=1))


def _fetch(stops: list[LngLat], departure: datetime, load_lb: float, alternatives: int, use_tomtom: bool) -> list[Route]:
    key = cache_key("route2", [stops, departure.strftime("%Y%m%d%H%M"), round(load_lb, -2), alternatives, use_tomtom])

    def fetch():
        try:
            if use_tomtom:
                return _tomtom(stops, _not_past(departure), load_lb, alternatives)
            return _osrm(stops, alternatives)
        except requests.RequestException as exc:
            raise UpstreamError("The routing service is unavailable right now.") from exc

    return cached(key, ROUTE_TTL_S, fetch)


def route_options(stops: list[LngLat], departure: datetime, load_lb: float) -> list[Route]:
    """Up to three distinct routes through `stops` (origin, any stops, destination), fastest first."""
    # Quarter-hour slots let nearby plans share a cached route.
    departure = departure.replace(minute=departure.minute // 15 * 15, second=0, microsecond=0)
    use_tomtom = bool(settings.TOMTOM_API_KEY)
    try:
        routes = _fetch(stops, departure, load_lb, WANTED - 1, use_tomtom)
    except UpstreamError:
        if not use_tomtom:
            raise
        log.warning("TomTom failed, falling back to OSRM", exc_info=True)
        use_tomtom = False
        routes = _fetch(stops, departure, load_lb, WANTED - 1, use_tomtom)
    if not routes:
        raise UpstreamError("No route was found between these places.")

    chosen: list[Route] = []
    for r in routes:
        if _is_distinct(r, chosen):
            chosen.append(r)

    for leg, via in _via_points(chosen[0]):
        if len(chosen) >= WANTED:
            break
        try:
            forced = _fetch(stops[: leg + 1] + [via] + stops[leg + 1 :], departure, load_lb, 0, use_tomtom)
        except UpstreamError:
            continue
        if forced and _is_distinct(forced[0], chosen):
            forced[0].forced_via = via
            chosen.append(forced[0])

    chosen.sort(key=lambda r: r.duration_s)
    for i, r in enumerate(chosen[:WANTED]):
        r.id = "ABC"[i]
        r.label = f"Route {r.id}"
        r.roads = main_roads(r.instructions, r.distance_mi)
        if r.forced_via:
            r.notes.append("Alternative forced through a via point; the provider returned fewer than three.")
    return chosen[:WANTED]
