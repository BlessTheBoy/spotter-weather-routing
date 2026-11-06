from planner.services.geocoding import routable_places


def feature(name, state, cc, lng=-80.0, lat=35.0):
    return {"properties": {"name": name, "state": state, "countrycode": cc}, "geometry": {"coordinates": [lng, lat]}}


def test_keeps_only_us_and_canada_and_drops_duplicate_labels():
    features = [
        feature("Dallas", "Texas", "US"),
        feature("Dallas", "Texas", "US", lng=-96.8),
        feature("Dallas", "Scotland", "GB"),
        feature("Toronto", "Ontario", "CA"),
    ]
    labels = [p["label"] for p in routable_places(features, limit=6)]
    assert labels == ["Dallas, Texas, US", "Toronto, Ontario, CA"]


def test_respects_the_limit():
    features = [feature(f"Town {i}", "Ohio", "US") for i in range(10)]
    assert len(routable_places(features, limit=3)) == 3
