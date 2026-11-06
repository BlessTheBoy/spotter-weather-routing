"""Route summaries and the brief's ordered recommendation.

The brief's order is: fewest Severe miles, fewest High miles, lowest average
risk, shortest travel time. It never mentions No Travel, but a route through a
No Travel checkpoint can't be "safer" than one without, so No Travel miles are
compared first. Values are rounded before comparing (miles to 0.1, average
risk to 0.01, time to the minute) so float noise can't decide a tie.
"""

from dataclasses import dataclass

from .risk import Risk


@dataclass(frozen=True)
class RiskSample:
    level: Risk
    miles: float


@dataclass(frozen=True)
class RouteSummary:
    route_id: str
    distance_mi: float
    duration_s: float
    miles_by_level: dict[Risk, float]
    average_risk: float
    max_level: Risk

    @property
    def sort_key(self) -> tuple:
        return (
            round(self.miles_by_level[Risk.NO_TRAVEL], 1),
            round(self.miles_by_level[Risk.SEVERE], 1),
            round(self.miles_by_level[Risk.HIGH], 1),
            round(self.average_risk, 2),
            round(self.duration_s / 60),
        )


CRITERIA = ("no_travel_miles", "severe_miles", "high_miles", "average_risk", "travel_time")


def summarize(route_id: str, distance_mi: float, duration_s: float, samples: list[RiskSample]) -> RouteSummary:
    miles = {level: 0.0 for level in Risk}
    for s in samples:
        miles[s.level] += s.miles
    total = sum(miles.values())
    average = sum(level * m for level, m in miles.items()) / total if total else 0.0
    max_level = max((s.level for s in samples), default=Risk.LOW)
    return RouteSummary(route_id, distance_mi, duration_s, miles, average, max_level)


@dataclass(frozen=True)
class Recommendation:
    route_id: str
    ranking: list[str]
    # The first criterion that separated the winner from the runner-up, or
    # None when there is a single route or the top two tie on everything.
    deciding_criterion: str | None


def recommend(summaries: list[RouteSummary]) -> Recommendation:
    if not summaries:
        raise ValueError("no routes to rank")
    ranked = sorted(summaries, key=lambda s: s.sort_key)
    deciding = None
    if len(ranked) > 1:
        for name, a, b in zip(CRITERIA, ranked[0].sort_key, ranked[1].sort_key):
            if a != b:
                deciding = name
                break
    return Recommendation(ranked[0].route_id, [s.route_id for s in ranked], deciding)
