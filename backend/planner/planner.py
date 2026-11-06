"""Builds a v2 trip plan, the shape in frontend/src/api/types.ts.

routes -> timeline -> checkpoints every 10, 25 and 50 mi -> each checkpoint's
hourly weather and risk -> the ranking for every departure hour the pin can
reach -> the corridor heatmap for every track hour.

Everything the departure pin and the interval switch can change is computed
here, so the UI never waits on the network after the plan arrives.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np

from .domain.corridor import center, corridor
from .domain.geometry import checkpoints_along, douglas_peucker
from .domain.recommend import RiskSample, RouteSummary, reason, recommend, summarize
from .domain.risk import Risk, load_levels, rain_levels, snow_levels, wind_levels
from .domain.timeline import HOUR, TRACK_HOURS, Timeline, timeline_for
from .services.routing import Route, route_options
from .services.weather import Hourly, forecasts, snap

INTERVALS = (10, 25, 50)
WEATHER_BUDGET = 520  # locations per plan; Open-Meteo allows 600 a minute
MIN_CORRIDOR_CELLS = 120
# Snap grids for weather lookups, finest first; long trips step up to stay in budget.
GRIDS = (0.1, 0.2, 0.3, 0.5)
GEOMETRY_TOLERANCE_M = 5.0
LEVEL_KEYS = ("level", "wind_level", "rain_level", "snow_level", "load_level")


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lng: float

    @property
    def lnglat(self) -> tuple[float, float]:
        return (self.lng, self.lat)

    def json(self) -> dict:
        return {"label": self.label, "lat": self.lat, "lng": self.lng}


@dataclass(frozen=True)
class PlanRequest:
    origin: Place
    destination: Place
    stops: list[Place]
    departure: datetime
    load_lb: float


def _iso(ts: float) -> str:
    """Millisecond ISO-8601 in UTC, as JavaScript's toISOString writes it."""
    ms = round(ts * 1000)
    return datetime.fromtimestamp(ms // 1000, UTC).strftime("%Y-%m-%dT%H:%M:%S") + f".{ms % 1000:03d}Z"


class _Weather:
    """Each snapped point's whole forecast as numpy arrays, with every risk level per hour."""

    def __init__(self, wx: dict, grid: float, load_lb: float):
        self.wx, self.grid, self.load_lb = wx, grid, load_lb
        self._arrays: dict = {}

    def arrays(self, point: tuple[float, float]) -> tuple[Hourly, dict[str, np.ndarray]]:
        key = snap(point, self.grid)
        hourly = self.wx[key]
        if key not in self._arrays:
            wind = np.asarray(hourly.wind_mph)
            rain = np.asarray(hourly.rain_in)
            snow = np.asarray(hourly.snow_in)
            a = {
                "wind_mph": wind,
                "gust_mph": np.asarray(hourly.gust_mph),
                "rain_in_hr": rain,
                "snow_in_hr": snow,
                "wind_level": wind_levels(wind),
                "rain_level": rain_levels(rain),
                "snow_level": snow_levels(snow),
                "load_level": load_levels(wind, self.load_lb),
            }
            a["level"] = np.maximum.reduce([a["wind_level"], a["rain_level"], a["snow_level"], a["load_level"]])
            self._arrays[key] = a
        return hourly, self._arrays[key]

    def window(self, point: tuple[float, float], start: float, hours: int) -> tuple[dict[str, np.ndarray], bool]:
        """`hours` hourly values from `start`. Hours past the forecast repeat its last hour."""
        hourly, a = self.arrays(point)
        idx = round((start - hourly.start) / HOUR) + np.arange(hours)
        n = len(hourly.wind_mph)
        return {k: v[np.clip(idx, 0, n - 1)] for k, v in a.items()}, bool(idx[-1] >= n)


def _series_json(w: dict[str, np.ndarray]) -> dict:
    out = {
        "wind_mph": np.round(w["wind_mph"], 1).tolist(),
        "gust_mph": np.round(w["gust_mph"], 1).tolist(),
        "rain_in_hr": np.round(w["rain_in_hr"], 3).tolist(),
        "snow_in_hr": np.round(w["snow_in_hr"], 3).tolist(),
    }
    for k in LEVEL_KEYS:
        out[k] = w[k].tolist()
    return out


def _summary_json(s: RouteSummary) -> dict:
    return {
        "miles_by_level": {lvl.name.lower(): round(m, 1) for lvl, m in s.miles_by_level.items()},
        "average_risk": round(s.average_risk, 2),
        "max_level": int(s.max_level),
    }


@dataclass
class _RouteWork:
    route: Route
    # The Douglas–Peucker line: what the map draws and checkpoints are placed on.
    points: list[tuple[float, float]]
    times: list[float]
    # Per interval: checkpoint JSON, eta offsets, represented miles and the (checkpoints x hours) level matrix.
    checkpoints: dict
    etas: dict
    miles: dict
    levels: dict


def _choose_grid(points: list[tuple[float, float]]) -> tuple[float, set]:
    """The finest snap grid that leaves room for a corridor in the weather budget."""
    for grid in GRIDS:
        snapped = {snap(p, grid) for p in points}
        if len(snapped) + MIN_CORRIDOR_CELLS <= WEATHER_BUDGET:
            break
    return grid, snapped


def _schedule(work: list[_RouteWork], timeline: Timeline, interval: int) -> list[dict]:
    departures = np.asarray(timeline.departures())
    labels = {w.route.id: w.route.label for w in work}
    sampled = {}
    for w in work:
        # Hour index at each checkpoint for each departure, rounded as JavaScript's Math.round does.
        idx = np.floor((departures[:, None] + w.etas[interval][None, :] - timeline.series_start) / HOUR + 0.5).astype(int)
        idx = np.clip(idx, 0, timeline.series_hours - 1)
        sampled[w.route.id] = np.take_along_axis(w.levels[interval], idx.T, axis=1).T  # (departures x checkpoints)

    options = []
    for d, dep in enumerate(departures):
        summaries = {}
        for w in work:
            r = w.route
            samples = [RiskSample(Risk(int(lvl)), m) for lvl, m in zip(sampled[r.id][d], w.miles[interval])]
            summaries[r.id] = summarize(r.id, r.distance_mi, r.duration_s, samples)
        rec = recommend(list(summaries.values()))
        runner = summaries[rec.ranking[1]] if len(rec.ranking) > 1 else None
        options.append(
            {
                "departure": _iso(float(dep)),
                "summaries": {rid: _summary_json(s) for rid, s in summaries.items()},
                "recommendation": {
                    "route_id": rec.route_id,
                    "ranking": rec.ranking,
                    "deciding_criterion": rec.deciding_criterion,
                    "reason": reason(summaries[rec.route_id], runner, rec.deciding_criterion, labels),
                },
            }
        )
    return options


def _route_json(w: _RouteWork) -> dict:
    r = w.route
    return {
        "id": r.id,
        "label": r.label,
        "via": r.roads,
        "provider": r.provider,
        "notes": r.notes,
        "distance_mi": round(r.distance_mi, 1),
        "duration_s": round(r.duration_s),
        "geometry": [[round(lng, 5), round(lat, 5)] for lng, lat in w.points],
        "geometry_times_s": [round(t) for t in w.times],
        "instructions": [{"mile": i.mile, "maneuver": i.maneuver, "text": i.text, "road": i.road} for i in r.instructions],
        "checkpoints": {str(k): v for k, v in w.checkpoints.items()},
    }


def build_plan(req: PlanRequest) -> dict:
    now = datetime.now(UTC)
    stops = [req.origin.lnglat, *(s.lnglat for s in req.stops), req.destination.lnglat]
    routes = route_options(stops, max(req.departure, now), req.load_lb)
    timeline = timeline_for(now.timestamp(), req.departure.timestamp(), max(r.duration_s for r in routes))

    work = []
    for r in routes:
        keep = douglas_peucker(r.points, GEOMETRY_TOLERANCE_M)
        work.append(_RouteWork(r, [r.points[i] for i in keep], [r.times_s[i] for i in keep], {}, {}, {}, {}))
    raw_cps = {(w.route.id, k): checkpoints_along(w.points, w.times, k, w.route.distance_mi) for w in work for k in INTERVALS}

    grid, cp_points = _choose_grid([(c.lng, c.lat) for cps in raw_cps.values() for c in cps])
    # A corridor costs the lookups its cells add beyond the checkpoints' (fine cells share grid points).
    res, cells = corridor(
        [w.points for w in work],
        max(MIN_CORRIDOR_CELLS, WEATHER_BUDGET - len(cp_points)),
        lambda ids: len({snap(center(c), grid) for c in ids} - cp_points),
    )
    wx = _Weather(forecasts([(c.lng, c.lat) for cps in raw_cps.values() for c in cps] + [c.center for c in cells], grid), grid, req.load_lb)

    past_horizon = False
    for w in work:
        for k in INTERVALS:
            cps = raw_cps[(w.route.id, k)]
            out, levels = [], []
            for cp in cps:
                series, beyond = wx.window((cp.lng, cp.lat), timeline.series_start, timeline.series_hours)
                past_horizon |= beyond
                levels.append(series["level"])
                out.append(
                    {
                        "mile": round(cp.mile, 1),
                        "lng": round(cp.lng, 5),
                        "lat": round(cp.lat, 5),
                        "eta_offset_s": round(cp.eta_offset_s),
                        "represents_mi": round(cp.represents_mi, 2),
                        "series": _series_json(series),
                    }
                )
            w.checkpoints[k] = out
            w.etas[k] = np.asarray([c.eta_offset_s for c in cps])
            w.miles[k] = [c.represents_mi for c in cps]
            w.levels[k] = np.vstack(levels)
    if past_horizon:
        for w in work:
            w.route.notes.append("The forecast ends before this trip could; its last hour is repeated after that.")

    hours = [timeline.start + h * HOUR for h in range(TRACK_HOURS + 1)]
    grid_cols = {key: [] for key in ("risk", "wind_mph", "rain_in_hr", "snow_in_hr")}
    for c in cells:
        series, _ = wx.window(c.center, timeline.start, len(hours))
        grid_cols["risk"].append(series["level"])
        grid_cols["wind_mph"].append(np.round(series["wind_mph"], 1))
        grid_cols["rain_in_hr"].append(np.round(series["rain_in_hr"], 3))
        grid_cols["snow_in_hr"].append(np.round(series["snow_in_hr"], 3))
    # (cells x hours) -> flattened [hour * cell_count + cell].
    flat = {k: (np.vstack(v).T.ravel().tolist() if v else []) for k, v in grid_cols.items()}

    return {
        "generated_at": _iso(now.timestamp()),
        "origin": req.origin.json(),
        "destination": req.destination.json(),
        "stops": [s.json() for s in req.stops],
        "load_lb": req.load_lb,
        "timeline": {
            "now": _iso(timeline.now),
            "start": _iso(timeline.start),
            "end": _iso(timeline.end),
            "departure": _iso(timeline.departure),
            "departure_min": _iso(timeline.departure_min),
            "departure_max": _iso(timeline.departure_max),
            "long_range_after": _iso(timeline.long_range_after),
            "series_start": _iso(timeline.series_start),
        },
        "routes": [_route_json(w) for w in work],
        "schedule": {str(k): _schedule(work, timeline, k) for k in INTERVALS},
        "corridor": {
            "resolution": res,
            "hours": [_iso(t) for t in hours],
            "cells": [{"id": c.id, "center": list(c.center), "boundary": [list(p) for p in c.boundary]} for c in cells],
            "risk": flat["risk"],
            "wind_mph": flat["wind_mph"],
            "rain_in_hr": flat["rain_in_hr"],
            "snow_in_hr": flat["snow_in_hr"],
        },
    }
