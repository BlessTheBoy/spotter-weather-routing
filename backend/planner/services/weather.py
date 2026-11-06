"""Hourly forecasts from Open-Meteo, batched and cached per grid cell.

Open-Meteo's free tier charges its rate limit per location (600 a minute), so
every point is snapped to a 0.1° grid (about 7 miles) before fetching. Each
snapped point's whole 10-day hourly series is cached until shortly after the
next model hour, which lets the three routes, all three checkpoint intervals,
every departure hour and every heatmap hour share the same few hundred lookups.
Ten days covers a departure a week out plus a long trip and the 48 h track.

Very long trips can pass a coarser grid (0.2°, 0.3°...) to stay in budget.
Coarser grid points are also 0.1° points, so they share the same cache.
"""

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import requests

from django.core.cache import cache

from ..domain.geometry import LngLat
from .http import TIMEOUT_S, UpstreamError, session

log = logging.getLogger("planner")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
GRID_DEG = 0.1
FORECAST_DAYS = 10
CHUNK = 200
HOURLY = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")


@dataclass(frozen=True)
class Hourly:
    """One location's series. Index 0 is `start` (00:00 UTC today)."""

    start: int  # unix seconds
    wind_mph: tuple[float, ...]
    gust_mph: tuple[float, ...]
    rain_in: tuple[float, ...]  # rain + showers over the preceding hour == in/hr
    snow_in: tuple[float, ...]  # new snowfall over the preceding hour == in/hr

    def index_at(self, ts: float) -> int | None:
        i = round((ts - self.start) / 3600)
        return i if 0 <= i < len(self.wind_mph) else None


def snap(point: LngLat, grid: float = GRID_DEG) -> LngLat:
    return (round(round(point[0] / grid) * grid, 4), round(round(point[1] / grid) * grid, 4))


def _key(point: LngLat) -> str:
    return f"wx{FORECAST_DAYS}:{point[0]}:{point[1]}"


def _num(values: list) -> tuple[float, ...]:
    return tuple(float(v) if v is not None else 0.0 for v in values)


def _parse(block: dict) -> Hourly:
    h = block["hourly"]
    rain = [r + s for r, s in zip(_num(h["rain"]), _num(h["showers"]))]
    return Hourly(
        start=int(h["time"][0]),
        wind_mph=_num(h["wind_speed_10m"]),
        gust_mph=_num(h["wind_gusts_10m"]),
        rain_in=tuple(rain),
        snow_in=_num(h["snowfall"]),
    )


def _request(points: list[LngLat]) -> list[Hourly]:
    data = {
        "latitude": ",".join(str(p[1]) for p in points),
        "longitude": ",".join(str(p[0]) for p in points),
        "hourly": ",".join(HOURLY),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "timeformat": "unixtime",
        "forecast_days": FORECAST_DAYS,
        "models": "best_match",
    }
    for attempt in range(3):
        try:
            r = session.post(OPEN_METEO_URL, data=data, timeout=TIMEOUT_S * 2)
        except requests.RequestException as exc:
            raise UpstreamError("The weather service is unavailable right now.") from exc
        if r.status_code == 429 and attempt < 2:
            wait = min(float(r.headers.get("Retry-After", 5)), 15)
            log.warning("Open-Meteo rate limited, retrying in %ss", wait)
            time.sleep(wait)
            continue
        if not r.ok:
            raise UpstreamError("The weather service is unavailable right now.")
        body = r.json()
        blocks = body if isinstance(body, list) else [body]
        return [_parse(b) for b in blocks]
    raise UpstreamError("The weather service is busy. Try again in a minute.")


def forecasts(points: list[LngLat], grid: float = GRID_DEG) -> dict[LngLat, Hourly]:
    """Forecast for each snapped point. Callers look up with snap(point, grid)."""
    wanted = list(dict.fromkeys(snap(p, grid) for p in points))
    found = cache.get_many([_key(p) for p in wanted])
    out = {p: found[_key(p)] for p in wanted if _key(p) in found}
    missing = [p for p in wanted if p not in out]
    if missing:
        log.info("weather: %d cached, %d to fetch", len(out), len(missing))
    ttl = 3600 - datetime.now(UTC).minute * 60 + 15 * 60  # until next hour + 15 min
    for i in range(0, len(missing), CHUNK):
        chunk = missing[i : i + CHUNK]
        series = _request(chunk)
        fresh = dict(zip(chunk, series))
        cache.set_many({_key(p): s for p, s in fresh.items()}, ttl)
        out.update(fresh)
    return out
