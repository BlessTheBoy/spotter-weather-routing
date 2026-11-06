"""Checkpoint risk classification, exactly as the brief's tables define it.

Band edges in the brief overlap (rain 0.25 sits in two bands) or leave gaps
(wind 34.5 mph). We read every band as half-open, [lower, upper), and keep the
top edges exactly as written: wind No Travel is ">= 55", rain and snow No Travel
are "> 1.00" and "> 3.0", so 1.00 in/hr rain and 3.0 in/hr snow are still Severe.
"""

from dataclasses import dataclass
from enum import IntEnum

import numpy as np


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()


def classify_wind(mph: float) -> Risk:
    if mph >= 55:
        return Risk.NO_TRAVEL
    if mph >= 45:
        return Risk.SEVERE
    if mph >= 35:
        return Risk.HIGH
    if mph >= 25:
        return Risk.MODERATE
    return Risk.LOW


def classify_rain(in_per_hr: float) -> Risk:
    if in_per_hr > 1.00:
        return Risk.NO_TRAVEL
    if in_per_hr >= 0.50:
        return Risk.SEVERE
    if in_per_hr >= 0.25:
        return Risk.HIGH
    if in_per_hr >= 0.10:
        return Risk.MODERATE
    return Risk.LOW


def classify_snow(in_per_hr: float) -> Risk:
    if in_per_hr > 3.0:
        return Risk.NO_TRAVEL
    if in_per_hr >= 2.0:
        return Risk.SEVERE
    if in_per_hr >= 1.0:
        return Risk.HIGH
    if in_per_hr >= 0.5:
        return Risk.MODERATE
    return Risk.LOW


def classify_load(wind_mph: float, load_lb: float) -> Risk:
    """Load rules. They only ever raise the level, never lower it."""
    if wind_mph >= 55:
        return Risk.NO_TRAVEL
    if wind_mph >= 45 and load_lb > 30_000:
        return Risk.NO_TRAVEL
    if wind_mph >= 35 and load_lb > 40_000:
        return Risk.SEVERE
    return Risk.LOW


@dataclass(frozen=True)
class Assessment:
    level: Risk
    wind: Risk
    rain: Risk
    snow: Risk
    load: Risk

    @property
    def drivers(self) -> list[str]:
        """Which inputs produced the final level, for the UI's 'why'."""
        if self.level == Risk.LOW:
            return []
        parts = {"wind": self.wind, "rain": self.rain, "snow": self.snow, "load": self.load}
        return [name for name, level in parts.items() if level == self.level]


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> Assessment:
    """A checkpoint's level is the worst of its wind, rain, snow and load levels."""
    wind = classify_wind(wind_mph)
    rain = classify_rain(rain_in_hr)
    snow = classify_snow(snow_in_hr)
    load = classify_load(wind_mph, load_lb)
    return Assessment(level=max(wind, rain, snow, load), wind=wind, rain=rain, snow=snow, load=load)


# --- Hourly series ---------------------------------------------------------
# The same bands applied to whole numpy arrays at once, for a checkpoint's
# hourly series. Each level is the count of thresholds the value has reached,
# with the same >= / > edges as the scalar functions above.


def wind_levels(mph: np.ndarray) -> np.ndarray:
    return (mph >= 25).astype(np.int8) + (mph >= 35) + (mph >= 45) + (mph >= 55)


def rain_levels(in_per_hr: np.ndarray) -> np.ndarray:
    r = in_per_hr
    return (r >= 0.10).astype(np.int8) + (r >= 0.25) + (r >= 0.50) + (r > 1.00)


def snow_levels(in_per_hr: np.ndarray) -> np.ndarray:
    s = in_per_hr
    return (s >= 0.5).astype(np.int8) + (s >= 1.0) + (s >= 2.0) + (s > 3.0)


def load_levels(wind_mph: np.ndarray, load_lb: float) -> np.ndarray:
    w = wind_mph
    out = np.zeros(w.shape, dtype=np.int8)
    if load_lb > 40_000:
        out[w >= 35] = Risk.SEVERE
    if load_lb > 30_000:
        out[w >= 45] = Risk.NO_TRAVEL
    out[w >= 55] = Risk.NO_TRAVEL
    return out
