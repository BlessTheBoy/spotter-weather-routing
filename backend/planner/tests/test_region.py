import pytest

from planner.domain.region import in_region


@pytest.mark.parametrize(
    "name, lng, lat",
    [
        ("Charlotte", -80.8431, 35.2271),
        ("New York", -74.006, 40.7128),
        ("Denver", -104.9903, 39.7392),
        ("Salt Lake City", -111.891, 40.7608),
        ("San Diego", -117.1611, 32.7157),
        ("El Paso", -106.4850, 31.7619),
        ("Miami", -80.1918, 25.7617),
        ("Key West", -81.78, 24.5551),
        ("Seattle", -122.3321, 47.6062),
        ("Toronto", -79.3832, 43.6532),
        ("Vancouver", -123.1207, 49.2827),
        ("Halifax", -63.5752, 44.6488),
        ("St. John's", -52.7126, 47.5615),
        ("Anchorage", -149.9003, 61.2181),
        ("Whitehorse", -135.0568, 60.7212),
    ],
)
def test_us_and_canada_are_inside(name, lng, lat):
    assert in_region((lng, lat)), name


@pytest.mark.parametrize(
    "name, lng, lat",
    [
        ("Tijuana", -117.0382, 32.5149),
        ("Monterrey", -100.3161, 25.6866),
        ("Mexico City", -99.1332, 19.4326),
        ("Havana", -82.3666, 23.1136),
        ("Nassau", -77.3554, 25.0443),
        ("Honolulu", -157.8583, 21.3069),
        ("Nuuk", -51.7216, 64.1814),
        ("London", -0.1276, 51.5072),
    ],
)
def test_places_outside_are_rejected(name, lng, lat):
    assert not in_region((lng, lat)), name
