import pytest

from planner.domain.risk import Risk, assess, classify_load, classify_rain, classify_snow, classify_wind


@pytest.mark.parametrize(
    "mph, expected",
    [
        (0, Risk.LOW),
        (24.9, Risk.LOW),
        (25, Risk.MODERATE),
        (34.9, Risk.MODERATE),  # the brief's 25–34 band, read as [25, 35)
        (35, Risk.HIGH),
        (44.9, Risk.HIGH),
        (45, Risk.SEVERE),
        (54.9, Risk.SEVERE),
        (55, Risk.NO_TRAVEL),
        (80, Risk.NO_TRAVEL),
    ],
)
def test_wind_bands(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    "rate, expected",
    [
        (0.0, Risk.LOW),
        (0.099, Risk.LOW),
        (0.10, Risk.MODERATE),
        (0.25, Risk.HIGH),  # overlapping edge goes to the upper band
        (0.50, Risk.SEVERE),
        (1.00, Risk.SEVERE),  # No Travel is strictly "> 1.00"
        (1.01, Risk.NO_TRAVEL),
    ],
)
def test_rain_bands(rate, expected):
    assert classify_rain(rate) == expected


@pytest.mark.parametrize(
    "rate, expected",
    [
        (0.49, Risk.LOW),
        (0.5, Risk.MODERATE),
        (1.0, Risk.HIGH),
        (2.0, Risk.SEVERE),
        (3.0, Risk.SEVERE),  # No Travel is strictly "> 3.0"
        (3.01, Risk.NO_TRAVEL),
    ],
)
def test_snow_bands(rate, expected):
    assert classify_snow(rate) == expected


@pytest.mark.parametrize(
    "mph, load, expected",
    [
        (55, 0, Risk.NO_TRAVEL),  # any load
        (45, 30_000, Risk.LOW),  # rule needs strictly more than 30,000 lb
        (45, 30_001, Risk.NO_TRAVEL),
        (54.9, 45_000, Risk.NO_TRAVEL),
        (35, 40_000, Risk.LOW),
        (35, 40_001, Risk.SEVERE),
        (44.9, 80_000, Risk.SEVERE),
        (34.9, 80_000, Risk.LOW),
    ],
)
def test_load_rules(mph, load, expected):
    assert classify_load(mph, load) == expected


def test_assessment_takes_the_worst_component():
    a = assess(wind_mph=10, rain_in_hr=0.3, snow_in_hr=0.6, load_lb=20_000)
    assert a.level == Risk.HIGH
    assert a.drivers == ["rain"]


def test_load_rule_raises_high_wind_to_severe():
    light = assess(wind_mph=40, rain_in_hr=0, snow_in_hr=0, load_lb=20_000)
    heavy = assess(wind_mph=40, rain_in_hr=0, snow_in_hr=0, load_lb=45_000)
    assert light.level == Risk.HIGH
    assert heavy.level == Risk.SEVERE
    assert heavy.drivers == ["load"]


def test_load_rule_turns_severe_wind_into_no_travel():
    a = assess(wind_mph=50, rain_in_hr=0, snow_in_hr=0, load_lb=35_000)
    assert a.level == Risk.NO_TRAVEL


def test_calm_checkpoint_has_no_drivers():
    assert assess(5, 0, 0, 80_000).drivers == []
