import pytest

from planner.domain.geometry import checkpoints_along, decode_polyline, haversine_mi


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
