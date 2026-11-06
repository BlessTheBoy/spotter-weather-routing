from datetime import UTC, datetime
from itertools import pairwise

from planner.domain.timeline import HOUR, timeline_for

NOW = datetime(2026, 11, 6, 14, 20, tzinfo=UTC).timestamp()
NOW_HOUR = datetime(2026, 11, 6, 14, 0, tzinfo=UTC).timestamp()


def hours(ts: float) -> float:
    return (ts - NOW_HOUR) / HOUR


def test_departure_soon_starts_the_track_at_the_current_hour():
    t = timeline_for(NOW, NOW + 2 * HOUR, longest_s=10 * HOUR)
    assert t.start == NOW_HOUR == t.series_start
    assert t.end == t.start + 48 * HOUR
    assert t.departure == NOW + 2 * HOUR
    assert t.departure_min == NOW  # not the hour: the pin can't go into the past
    assert t.departure_max == t.end - 10 * HOUR
    assert t.long_range_after == NOW + 72 * HOUR


def test_later_departure_keeps_24_hours_of_history_before_it():
    dep = NOW + 3 * 24 * HOUR + 30 * 60  # 3 days out, at :50
    t = timeline_for(NOW, dep, longest_s=8 * HOUR)
    assert hours(t.start) == 3 * 24 - 24  # floor(dep) - 24 h
    assert t.departure == dep


def test_long_trip_shrinks_the_history_so_it_still_fits():
    dep = NOW + 4 * 24 * HOUR
    t = timeline_for(NOW, dep, longest_s=30 * HOUR + 1)  # rounds up to 31 h
    # back = min(24, 48 - 31 - 2) = 15 h
    assert hours(t.start) == 4 * 24 - 15
    assert t.departure_max == t.end - 31 * HOUR
    assert t.series_hours == 48 + 31 + 2


def test_trip_longer_than_the_track_pins_the_departure():
    dep = NOW + 24 * HOUR
    t = timeline_for(NOW, dep, longest_s=50 * HOUR)
    assert hours(t.start) == 24  # no history: back is 0
    assert t.departure_max == t.departure_min == t.departure


def test_departure_in_the_last_hour_clamps_to_now():
    t = timeline_for(NOW, NOW - 30 * 60, longest_s=5 * HOUR)
    assert t.departure == NOW


def test_departures_step_hourly_from_the_entered_time_both_ways():
    dep = NOW + 3 * HOUR  # 17:20
    t = timeline_for(NOW, dep, longest_s=40 * HOUR)
    steps = t.departures()
    assert dep in steps
    assert all(b - a == HOUR for a, b in pairwise(steps))
    assert steps[0] >= t.departure_min and steps[0] - HOUR < t.departure_min
    assert steps[-1] <= t.departure_max and steps[-1] + HOUR > t.departure_max


def test_series_index_rounds_halves_up_like_javascript():
    t = timeline_for(NOW, NOW, longest_s=HOUR)
    assert t.series_index(NOW_HOUR, 30 * 60) == 1
    assert t.series_index(NOW_HOUR, 90 * 60) == 2
    assert t.series_index(NOW_HOUR, 29 * 60) == 0
