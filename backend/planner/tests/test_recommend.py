import pytest

from planner.domain.recommend import RiskSample, recommend, summarize
from planner.domain.risk import Risk

L, M, H, S, N = Risk.LOW, Risk.MODERATE, Risk.HIGH, Risk.SEVERE, Risk.NO_TRAVEL


def route(route_id, samples, duration_h=10.0):
    miles = sum(m for _, m in samples)
    return summarize(route_id, miles, duration_h * 3600, [RiskSample(level, m) for level, m in samples])


def test_summary_miles_and_mile_weighted_average():
    s = route("a", [(L, 50), (H, 25), (S, 25)])
    assert s.miles_by_level[H] == 25
    assert s.miles_by_level[S] == 25
    assert s.average_risk == pytest.approx((0 * 50 + 2 * 25 + 3 * 25) / 100)
    assert s.max_level == S


def test_fewest_severe_miles_wins_even_if_slower_and_higher_average():
    a = route("a", [(S, 10), (L, 90)], duration_h=8)
    b = route("b", [(H, 100)], duration_h=12)
    rec = recommend([a, b])
    assert rec.route_id == "b"
    assert rec.deciding_criterion == "severe_miles"


def test_high_miles_break_a_severe_tie():
    a = route("a", [(S, 10), (H, 40), (L, 50)])
    b = route("b", [(S, 10), (H, 20), (M, 70)])
    assert recommend([a, b]).route_id == "b"
    assert recommend([a, b]).deciding_criterion == "high_miles"


def test_average_risk_breaks_a_high_tie():
    a = route("a", [(H, 10), (M, 90)])
    b = route("b", [(H, 10), (L, 90)])
    rec = recommend([a, b])
    assert rec.route_id == "b"
    assert rec.deciding_criterion == "average_risk"


def test_travel_time_is_the_last_tie_breaker():
    a = route("a", [(L, 100)], duration_h=11)
    b = route("b", [(L, 100)], duration_h=10)
    rec = recommend([a, b])
    assert rec.route_id == "b"
    assert rec.deciding_criterion == "travel_time"


def test_no_travel_miles_rank_before_everything():
    a = route("a", [(N, 5), (L, 95)], duration_h=5)
    b = route("b", [(S, 60), (H, 40)], duration_h=20)
    assert recommend([a, b]).route_id == "b"
    assert recommend([a, b]).deciding_criterion == "no_travel_miles"


def test_float_noise_does_not_decide():
    a = route("a", [(S, 10.00001), (L, 90)], duration_h=9)
    b = route("b", [(S, 10.0), (L, 90)], duration_h=10)
    # Severe miles are equal at 0.1 mi, so the faster route wins on time.
    assert recommend([a, b]).route_id == "a"


def test_full_ranking_order():
    routes = [route("a", [(H, 30), (L, 70)]), route("b", [(L, 100)]), route("c", [(S, 1), (L, 99)])]
    assert recommend(routes).ranking == ["b", "a", "c"]


def test_single_route_has_no_deciding_criterion():
    assert recommend([route("a", [(L, 1)])]).deciding_criterion is None
