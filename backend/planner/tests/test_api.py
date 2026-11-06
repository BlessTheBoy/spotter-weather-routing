"""POST /api/plan end to end, with routing and weather replaced by fakes.

Two routes between the same places: A (faster) bends north through a band
where a 60 mph wind blows for four hours; B bends south and stays calm. The
recommendation should switch to B only for departures that put the truck in
that band during the storm.
"""

import json
import math
from datetime import UTC, datetime, timedelta
from itertools import pairwise

import pytest
from django.test import Client

from planner import planner
from planner.domain.guidance import Instruction
from planner.services.routing import Route
from planner.services.weather import Hourly, snap

ORIGIN = {"label": "Origin", "lat": 35.0, "lng": -80.0}
DESTINATION = {"label": "Destination", "lat": 35.0, "lng": -79.0}
NOW_HOUR = datetime.now(UTC).replace(minute=0, second=0, microsecond=0).timestamp()
STORM = (NOW_HOUR + 5 * 3600, NOW_HOUR + 9 * 3600)  # wind 60 mph north of 35.4°N


def bent_route(bend_lat: float, duration_h: float, rid: str) -> Route:
    points = []
    for i in range(101):
        x = i / 100
        points.append((-80.0 + x, 35.0 + (bend_lat - 35.0) * math.sin(math.pi * x)))
    times = [duration_h * 3600 * i / 100 for i in range(101)]
    steps = [
        Instruction(0, "depart", "Leave", None),
        Instruction(1, "straight", "Take I-40", "I-40 E", "I-40"),
        Instruction(70, "arrive", "Arrive", None),
    ]
    return Route(points, times, 70.0, duration_h * 3600, "fake", steps, [100], id=rid, label=f"Route {rid}", roads="I-40")


ROUTES = [bent_route(35.6, 2.0, "A"), bent_route(34.4, 2.5, "B")]
CALLS = {}


def fake_routes(stops, departure, load_lb):
    CALLS["stops"] = stops
    return [Route(**{**r.__dict__, "notes": []}) for r in ROUTES]


def fake_forecasts(points, grid=0.1):
    start = int(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    out = {}
    for p in points:
        key = snap(p, grid)
        wind = [60.0 if key[1] > 35.4 and STORM[0] <= start + h * 3600 < STORM[1] else 5.0 for h in range(240)]
        out[key] = Hourly(start, tuple(wind), tuple(w * 1.3 for w in wind), (0.0,) * 240, (0.0,) * 240)
    return out


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(planner, "route_options", fake_routes)
    monkeypatch.setattr(planner, "forecasts", fake_forecasts)
    return Client()


def post(client, **overrides):
    body = {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "stops": [],
        "departure": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        "load_lb": 42000,
        **overrides,
    }
    return client.post("/api/plan", json.dumps(body), content_type="application/json")


def test_plan_matches_the_v2_contract(client):
    r = post(client)
    assert r.status_code == 200, r.content
    p = r.json()
    assert set(p) == {"generated_at", "origin", "destination", "stops", "load_lb", "timeline", "routes", "schedule", "corridor"}
    assert set(p["timeline"]) == {"now", "start", "end", "departure", "departure_min", "departure_max", "long_range_after", "series_start"}
    route = p["routes"][0]
    assert set(route) == {
        "id",
        "label",
        "via",
        "provider",
        "notes",
        "distance_mi",
        "duration_s",
        "geometry",
        "geometry_times_s",
        "instructions",
        "checkpoints",
    }
    assert route["label"] == "Route A" and route["via"] == "I-40"
    assert route["instructions"][1] == {"mile": 1, "maneuver": "straight", "text": "Take I-40", "road": "I-40 E"}
    assert len(route["geometry"]) == len(route["geometry_times_s"])
    assert set(route["checkpoints"]) == {"10", "25", "50"}
    assert [c["mile"] for c in route["checkpoints"]["25"]] == [0, 25, 50, 70]

    series_hours = 48 + math.ceil(2.5) + 2  # longest trip is B, 2.5 h
    cp = route["checkpoints"]["10"][3]
    assert set(cp) == {"mile", "lng", "lat", "eta_offset_s", "represents_mi", "series"}
    assert set(cp["series"]) == {
        "wind_mph",
        "gust_mph",
        "rain_in_hr",
        "snow_in_hr",
        "level",
        "wind_level",
        "rain_level",
        "snow_level",
        "load_level",
    }
    assert all(len(v) == series_hours for v in cp["series"].values())

    c = p["corridor"]
    assert len(c["hours"]) == 49 and c["hours"][0] == p["timeline"]["start"]
    for key in ("risk", "wind_mph", "rain_in_hr", "snow_in_hr"):
        assert len(c[key]) == 49 * len(c["cells"])


def test_checkpoint_series_carries_the_storm_and_the_load_rule(client):
    p = post(client).json()
    t0 = datetime.fromisoformat(p["timeline"]["series_start"]).timestamp()
    mid = next(c for c in p["routes"][0]["checkpoints"]["10"] if c["lat"] > 35.45)
    h = int((STORM[0] - t0) // 3600)
    s = mid["series"]
    assert s["wind_mph"][h] == 60 and s["wind_level"][h] == 4 and s["load_level"][h] == 4 and s["level"][h] == 4
    assert s["wind_mph"][h - 1] == 5 and s["level"][h - 1] == 0


def test_schedule_has_a_recommendation_for_every_departure_hour(client):
    p = post(client).json()
    t = p["timeline"]
    for interval in ("10", "25", "50"):
        options = p["schedule"][interval]
        deps = [datetime.fromisoformat(o["departure"]).timestamp() for o in options]
        assert t["departure"] in [o["departure"] for o in options]
        assert all(round(b - a) == 3600 for a, b in pairwise(deps))
        assert set(options[0]["summaries"]) == {"A", "B"}

    by_rec = {}
    for o in p["schedule"]["10"]:
        by_rec.setdefault(o["recommendation"]["route_id"], []).append(o)
    # Calm departures take the faster A; departures meeting the storm on A switch to B.
    calm, stormy = by_rec["A"][0], by_rec["B"][0]
    assert calm["recommendation"]["deciding_criterion"] == "travel_time"
    assert calm["recommendation"]["reason"] == "Low risk the whole way, as on Route B, and 30 min faster."
    assert stormy["recommendation"]["deciding_criterion"] == "no_travel_miles"
    assert stormy["summaries"]["A"]["miles_by_level"]["no_travel"] > 0
    assert stormy["summaries"]["B"]["max_level"] == 0
    assert stormy["recommendation"]["reason"].startswith("Fewest No Travel miles: 0.0 vs ")


def test_stops_are_routed_in_order_and_echoed(client):
    stop = {"label": "Greensboro", "lat": 36.07, "lng": -79.79}
    p = post(client, stops=[stop]).json()
    assert CALLS["stops"] == [(-80.0, 35.0), (-79.79, 36.07), (-79.0, 35.0)]
    assert p["stops"] == [stop]


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"origin": {"label": "Mexico City", "lat": 19.43, "lng": -99.13}}, "Routing is available in the US and Canada."),
        ({"stops": [{"label": "Havana", "lat": 23.11, "lng": -82.37}]}, "Routing is available in the US and Canada."),
        ({"stops": [{"lat": 36 + i / 10, "lng": -79.5} for i in range(4)]}, "Ensure this field has no more than 3 elements."),
        ({"load_lb": None}, "Enter the load in pounds."),
        ({"load_lb": ""}, "Enter the load in pounds."),
        ({"load_lb": 200_001}, "Load must be at most 200,000 lb."),
        ({"departure": (datetime.now(UTC) + timedelta(days=7, hours=1)).isoformat()}, "within the next 7 days"),
        ({"departure": (datetime.now(UTC) - timedelta(hours=2)).isoformat()}, "can't be in the past"),
    ],
)
def test_invalid_requests_get_a_readable_400(client, overrides, message):
    r = post(client, **overrides)
    assert r.status_code == 400
    assert message in r.json()["detail"]


def test_missing_load_is_an_error(client):
    body = {"origin": ORIGIN, "destination": DESTINATION, "departure": datetime.now(UTC).isoformat()}
    r = client.post("/api/plan", json.dumps(body), content_type="application/json")
    assert r.status_code == 400
    assert r.json()["detail"] == "Enter the load in pounds."
