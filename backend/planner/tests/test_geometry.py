import math

import numpy as np
import pytest

from planner.domain.geometry import checkpoints_along, decode_polyline, douglas_peucker, haversine_mi


def straight_line(miles: float, n: int = 101):
    # Along the equator one degree of longitude is ~69.093 miles.
    deg = miles / 69.093
    points = [(deg * i / (n - 1), 0.0) for i in range(n)]
    return points


def test_haversine_one_degree_at_equator():
    assert haversine_mi((0, 0), (1, 0)) == pytest.approx(69.093, abs=0.05)


def test_checkpoints_every_interval_plus_destination():
    pts = straight_line(110)
    times = [i * 60.0 for i in range(len(pts))]  # one minute per vertex
    cps = checkpoints_along(pts, times, interval_mi=25, total_mi=110)
    assert [round(c.mile) for c in cps] == [0, 25, 50, 75, 100, 110]
    assert cps[0].eta_offset_s == 0
    assert cps[-1].eta_offset_s == pytest.approx(times[-1])
    # ETA is interpolated along distance: halfway in miles is halfway in time here.
    assert cps[2].eta_offset_s == pytest.approx(times[-1] * 50 / 110, rel=1e-3)


def test_represented_miles_sum_to_route_length():
    pts = straight_line(237)
    times = [float(i) for i in range(len(pts))]
    for interval in (10, 25, 50):
        cps = checkpoints_along(pts, times, interval_mi=interval, total_mi=237)
        assert sum(c.represents_mi for c in cps) == pytest.approx(237)


def test_exact_multiple_does_not_duplicate_destination():
    pts = straight_line(100)
    cps = checkpoints_along(pts, [float(i) for i in range(len(pts))], interval_mi=50, total_mi=100)
    assert [round(c.mile) for c in cps] == [0, 50, 100]


def test_provider_distance_rescales_miles():
    pts = straight_line(100)
    cps = checkpoints_along(pts, [float(i) for i in range(len(pts))], interval_mi=50, total_mi=120)
    assert cps[-1].mile == pytest.approx(120)


def test_decode_polyline_reference_example():
    # Example from Google's polyline algorithm docs.
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [(-120.2, 38.5), (-120.95, 40.7), (-126.453, 43.252)]


def _meters_to_deg(m: float) -> float:
    return m / 111_195.0  # one degree at the equator, in metres


def test_douglas_peucker_collapses_a_straight_line_to_its_ends():
    pts = straight_line(10, n=500)
    assert douglas_peucker(pts, 5.0) == [0, 499]


def test_douglas_peucker_keeps_short_lines_whole():
    assert douglas_peucker([(0, 0), (1, 1)], 5.0) == [0, 1]


def test_douglas_peucker_keeps_the_curve_and_stays_within_tolerance():
    # 2 km straight, a 90° bend of 300 m radius, 2 km straight; one vertex per ~5 m.
    r = _meters_to_deg(300)
    straight_in = [(_meters_to_deg(-2000 + 5 * i), 0.0) for i in range(400)]
    bend = [(r * math.sin(a), r - r * math.cos(a)) for a in np.linspace(0, math.pi / 2, 95)]
    straight_out = [(r, r + _meters_to_deg(5 * i)) for i in range(1, 401)]
    pts = straight_in + bend + straight_out
    keep = douglas_peucker(pts, 5.0)

    first_bend, last_bend = len(straight_in), len(straight_in) + len(bend) - 1
    kept_in_bend = [i for i in keep if first_bend <= i <= last_bend]
    # Straights collapse, but the bend keeps several vertices (a 300 m arc needs ~5 at 5 m).
    assert len(keep) < 20
    assert len(kept_in_bend) >= 4
    # Every original vertex is within 5 m (plus rounding) of the simplified line.
    for i, p in enumerate(pts):
        a = max(k for k in keep if k <= i)
        b = min(k for k in keep if k >= i)
        assert _segment_distance_m(p, pts[a], pts[b]) <= 5.01


def _segment_distance_m(p, a, b) -> float:
    px, py, ax, ay, bx, by = (v * 111_195.0 for v in (*p, *a, *b))
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def test_douglas_peucker_keeps_vertices_even_thinning_would_drop():
    # A zig-zag of 20 m teeth: every vertex matters at 5 m.
    pts = [(_meters_to_deg(10 * i), _meters_to_deg(20 * (i % 2))) for i in range(50)]
    assert douglas_peucker(pts, 5.0) == list(range(50))
