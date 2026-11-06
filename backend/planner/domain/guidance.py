"""Turn-by-turn guidance in the app's small maneuver vocabulary, and route names.

Providers describe manoeuvres in their own terms (TomTom has ~35 codes, OSRM a
type plus a modifier). Navigate only needs to know which way to go, so both
fold into seven words. Routes are named after the one or two numbered roads
that carry most of their miles ("I-77, I-81").
"""

import re
from collections import defaultdict
from dataclasses import dataclass

DEPART, STRAIGHT, LEFT, RIGHT, SLIGHT_LEFT, SLIGHT_RIGHT, ARRIVE = (
    "depart",
    "straight",
    "left",
    "right",
    "slight_left",
    "slight_right",
    "arrive",
)

TOMTOM_MANEUVERS = {
    "DEPART": DEPART,
    "ARRIVE": ARRIVE,
    "ARRIVE_LEFT": ARRIVE,
    "ARRIVE_RIGHT": ARRIVE,
    "TURN_LEFT": LEFT,
    "SHARP_LEFT": LEFT,
    "MAKE_UTURN": LEFT,
    "TRY_MAKE_UTURN": LEFT,
    "ROUNDABOUT_LEFT": LEFT,
    "ROUNDABOUT_BACK": LEFT,
    "TURN_RIGHT": RIGHT,
    "SHARP_RIGHT": RIGHT,
    "ROUNDABOUT_RIGHT": RIGHT,
    "KEEP_LEFT": SLIGHT_LEFT,
    "BEAR_LEFT": SLIGHT_LEFT,
    "MOTORWAY_EXIT_LEFT": SLIGHT_LEFT,
    "KEEP_RIGHT": SLIGHT_RIGHT,
    "BEAR_RIGHT": SLIGHT_RIGHT,
    "MOTORWAY_EXIT_RIGHT": SLIGHT_RIGHT,
    "TAKE_EXIT": SLIGHT_RIGHT,
}  # everything else (FOLLOW, STRAIGHT, ENTER_FREEWAY, WAYPOINT_REACHED, ...) is straight on

OSRM_MODIFIERS = {
    "left": LEFT,
    "sharp left": LEFT,
    "uturn": LEFT,
    "right": RIGHT,
    "sharp right": RIGHT,
    "slight left": SLIGHT_LEFT,
    "slight right": SLIGHT_RIGHT,
}


@dataclass(frozen=True)
class Instruction:
    mile: float
    maneuver: str
    text: str
    road: str | None
    # Numbered road this step continues on ("I-77"), for naming the route.
    road_key: str | None = None


def tomtom_maneuver(code: str) -> str:
    return TOMTOM_MANEUVERS.get(code, STRAIGHT)


def osrm_maneuver(kind: str, modifier: str | None) -> str:
    if kind == "depart":
        return DEPART
    if kind == "arrive":
        return ARRIVE
    return OSRM_MODIFIERS.get(modifier or "", STRAIGHT)


_DIRECTION = re.compile(r"\s+[NSEW]B?$")
_INTERSTATE = re.compile(r"^I-\d")


def road_key(numbers: list[str]) -> str | None:
    """The main road number without its direction, interstates first: ["US-11 N", "I-81 N"] -> "I-81"."""
    clean = [_DIRECTION.sub("", n.strip()).replace("I ", "I-", 1) for n in numbers if n and n.strip()]
    if not clean:
        return None
    return next((n for n in clean if _INTERSTATE.match(n)), clean[0])


def main_roads(steps: list[Instruction], total_mi: float, limit: int = 2, min_share: float = 0.1) -> str | None:
    """The `limit` numbered roads carrying the most miles, in driving order.

    A step's road runs until the next step. Roads under `min_share` of the trip
    are left out, so a long single-interstate trip is named by one road.
    """
    miles: dict[str, float] = defaultdict(float)
    first: dict[str, int] = {}
    for i, step in enumerate(steps):
        if not step.road_key:
            continue
        end = steps[i + 1].mile if i + 1 < len(steps) else total_mi
        miles[step.road_key] += max(0.0, end - step.mile)
        first.setdefault(step.road_key, i)
    top = sorted(miles, key=lambda k: -miles[k])[:limit]
    top = [k for k in top if miles[k] >= min_share * total_mi] or top[:1]
    return ", ".join(sorted(top, key=first.__getitem__)) or None
