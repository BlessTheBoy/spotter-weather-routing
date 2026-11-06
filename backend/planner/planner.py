"""Builds a trip plan: routes -> checkpoints -> weather at ETA -> risk -> recommendation.

Also builds the corridor heatmap: every hex cell's risk and raw weather for
each of the next 49 hours, so the frontend's 0–48h slider never waits on the
network.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .domain.corridor import corridor
from .domain.geometry import Checkpoint, checkpoints_along, simplify
from .domain.recommend import RiskSample, RouteSummary, recommend, summarize
from .domain.risk import Risk, assess
from .services.routing import Route, route_options
from .services.weather import Hourly, forecasts, snap

HEATMAP_HOURS = 49  # 0..48 inclusive
WEATHER_BUDGET = 520  # locations per plan; Open-Meteo allows 600 a minute
MAX_GEOMETRY_POINTS = 1500


@dataclass(frozen=True)
class PlanRequest:
    origin: tuple[float, float]
    destination: tuple[float, float]
    departure: datetime
    load_lb: float
    interval_mi: int


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")


def _checkpoint(cp: Checkpoint, departure_ts: float, wx: Hourly, load_lb: float) -> tuple[dict, RiskSample | None]:
    eta = departure_ts + cp.eta_offset_s
    i = wx.index_at(eta)
    base = {
        "mile": round(cp.mile, 1),
        "lng": round(cp.lng, 5),
        "lat": round(cp.lat, 5),
        "eta": _iso(eta),
        "eta_offset_s": round(cp.eta_offset_s),
        "represents_mi": round(cp.represents_mi, 2),
    }
    if i is None:
        return {**base, "level": None, "drivers": [], "weather": None}, None
    wind, gust, rain, snow = wx.wind_mph[i], wx.gust_mph[i], wx.rain_in[i], wx.snow_in[i]
    a = assess(wind, rain, snow, load_lb)
    weather = {
        "forecast_hour": _iso(wx.start + i * 3600),
        "wind_mph": round(wind, 1),
        "gust_mph": round(gust, 1),
        "rain_in_hr": round(rain, 3),
        "snow_in_hr": round(snow, 3),
    }
    levels = {"wind": a.wind.label, "rain": a.rain.label, "snow": a.snow.label, "load": a.load.label}
    return {**base, "level": int(a.level), "drivers": a.drivers, "levels": levels, "weather": weather}, RiskSample(a.level, cp.represents_mi)


def _summary_json(s: RouteSummary) -> dict:
    return {
        "miles_by_level": {lvl.name.lower(): round(m, 1) for lvl, m in s.miles_by_level.items()},
        "average_risk": round(s.average_risk, 2),
        "max_level": int(s.max_level),
    }


def _reason(winner: RouteSummary, runner: RouteSummary | None, criterion: str | None, labels: dict[str, str]) -> str:
    if runner is None:
        return "Only one distinct route was found."
    other = labels[runner.route_id]
    m, n = winner.miles_by_level, runner.miles_by_level
    if criterion == "no_travel_miles":
        return f"Fewest No Travel miles: {m[Risk.NO_TRAVEL]:.1f} vs {n[Risk.NO_TRAVEL]:.1f} on {other}."
    if criterion == "severe_miles":
        return f"Fewest Severe miles: {m[Risk.SEVERE]:.1f} vs {n[Risk.SEVERE]:.1f} on {other}."
    if criterion == "high_miles":
        return f"Same Severe miles, fewest High miles: {m[Risk.HIGH]:.1f} vs {n[Risk.HIGH]:.1f} on {other}."
    if criterion == "average_risk":
        return f"Same Severe and High miles, lowest average risk: {winner.average_risk:.2f} vs {runner.average_risk:.2f} on {other}."
    if criterion == "travel_time":
        saved = round((runner.duration_s - winner.duration_s) / 60)
        return f"Ties {other} on every risk measure and is {saved} min faster."
    return f"Ties {other} on every measure."


def _route_json(r: Route, departure_ts: float, checkpoints: list[dict], summary: RouteSummary) -> dict:
    keep = simplify(r.points, MAX_GEOMETRY_POINTS)
    return {
        "id": r.id,
        "label": r.label,
        "provider": r.provider,
        "forced_via": list(r.via) if r.via else None,
        "notes": r.notes,
        "distance_mi": round(r.distance_mi, 1),
        "duration_s": round(r.duration_s),
        "departure": _iso(departure_ts),
        "arrival": _iso(departure_ts + r.duration_s),
        "geometry": [[round(r.points[i][0], 5), round(r.points[i][1], 5)] for i in keep],
        "geometry_times_s": [round(r.times_s[i]) for i in keep],
        "summary": _summary_json(summary),
        "checkpoints": checkpoints,
    }


def build_plan(req: PlanRequest) -> dict:
    now = datetime.now(UTC)
    departure = max(req.departure, now)
    departure_ts = departure.timestamp()

    routes = route_options(req.origin, req.destination, departure, req.load_lb)
    route_cps = [checkpoints_along(r.points, r.times_s, req.interval_mi, r.distance_mi) for r in routes]

    cp_points = {snap((c.lng, c.lat)) for cps in route_cps for c in cps}
    cell_budget = max(120, WEATHER_BUDGET - len(cp_points))
    res, cells = corridor([r.points for r in routes], cell_budget)

    wx = forecasts([(c.lng, c.lat) for cps in route_cps for c in cps] + [c.center for c in cells])

    summaries, routes_json = [], []
    for r, cps in zip(routes, route_cps):
        cp_json, samples = [], []
        for cp in cps:
            data, sample = _checkpoint(cp, departure_ts, wx[snap((cp.lng, cp.lat))], req.load_lb)
            cp_json.append(data)
            if sample:
                samples.append(sample)
        if len(samples) < len(cps):
            r.notes.append("Some checkpoints fall past the forecast horizon and are left out of the risk totals.")
        s = summarize(r.id, r.distance_mi, r.duration_s, samples)
        summaries.append(s)
        routes_json.append(_route_json(r, departure_ts, cp_json, s))

    rec = recommend(summaries)
    by_id = {s.route_id: s for s in summaries}
    labels = {r.id: r.label for r in routes}
    runner = by_id[rec.ranking[1]] if len(rec.ranking) > 1 else None

    hour0 = now.replace(minute=0, second=0, microsecond=0).timestamp()
    hours = [hour0 + h * 3600 for h in range(HEATMAP_HOURS)]
    risk, wind, rain, snow = [], [], [], []
    for ts in hours:
        for c in cells:
            series = wx[snap(c.center)]
            i = series.index_at(ts)
            if i is None:  # can't happen inside an 8-day series; keeps arrays aligned
                risk.append(-1), wind.append(0), rain.append(0), snow.append(0)
                continue
            w, ra, sn = series.wind_mph[i], series.rain_in[i], series.snow_in[i]
            risk.append(int(assess(w, ra, sn, req.load_lb).level))
            wind.append(round(w, 1))
            rain.append(round(ra, 3))
            snow.append(round(sn, 3))

    return {
        "generated_at": _iso(now.timestamp()),
        "departure": _iso(departure_ts),
        "departure_adjusted": departure > req.departure + timedelta(minutes=1),
        "load_lb": req.load_lb,
        "interval_mi": req.interval_mi,
        "routes": routes_json,
        "recommendation": {
            "route_id": rec.route_id,
            "ranking": rec.ranking,
            "deciding_criterion": rec.deciding_criterion,
            "reason": _reason(by_id[rec.route_id], runner, rec.deciding_criterion, labels),
        },
        "corridor": {
            "resolution": res,
            "hours": [_iso(t) for t in hours],
            "cells": [{"id": c.id, "center": list(c.center), "boundary": [list(p) for p in c.boundary]} for c in cells],
            # Flattened [hour * cell_count + cell] arrays.
            "risk": risk,
            "wind_mph": wind,
            "rain_in_hr": rain,
            "snow_in_hr": snow,
        },
    }
