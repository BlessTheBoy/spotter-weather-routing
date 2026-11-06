"""The plan's 48-hour forecast track and the departure hours the pin can reach.

All times are unix seconds. The rule keeps as much history before the entered
departure as fits (up to 24 h) while the whole longest trip still finishes on
the track, never starting before the current hour.
"""

import math
from dataclasses import dataclass

HOUR = 3600
TRACK_HOURS = 48
MAX_BACK_HOURS = 24
LONG_RANGE_HOURS = 72
SLACK_HOURS = 2


def floor_hour(ts: float) -> float:
    return math.floor(ts / HOUR) * HOUR


@dataclass(frozen=True)
class Timeline:
    now: float
    start: float
    end: float
    departure: float
    departure_min: float
    departure_max: float
    long_range_after: float
    series_start: float
    # Hours in every checkpoint series: the track plus the longest trip and slack.
    series_hours: int

    def series_index(self, departure: float, eta_offset_s: float) -> int:
        """Series hour the truck reaches a checkpoint in; halves round up, as in JavaScript."""
        return math.floor((departure + eta_offset_s - self.series_start) / HOUR + 0.5)

    def departures(self) -> list[float]:
        """Hourly steps anchored on the entered departure, both ways, inside the pin limits."""
        out = []
        t = self.departure
        while t >= self.departure_min:
            out.insert(0, t)
            t -= HOUR
        t = self.departure + HOUR
        while t <= self.departure_max:
            out.append(t)
            t += HOUR
        return out


def timeline_for(now: float, departure: float, longest_s: float) -> Timeline:
    longest = math.ceil(longest_s / HOUR) * HOUR
    back = max(0, min(MAX_BACK_HOURS * HOUR, TRACK_HOURS * HOUR - longest - SLACK_HOURS * HOUR))
    start = max(floor_hour(now), floor_hour(departure) - back)
    end = start + TRACK_HOURS * HOUR
    dep_min = max(now, start)
    dep_max = max(dep_min, end - longest)
    return Timeline(
        now=now,
        start=start,
        end=end,
        departure=min(max(departure, dep_min), dep_max),
        departure_min=dep_min,
        departure_max=dep_max,
        long_range_after=now + LONG_RANGE_HOURS * HOUR,
        series_start=start,
        series_hours=TRACK_HOURS + math.ceil(longest_s / HOUR) + SLACK_HOURS,
    )
