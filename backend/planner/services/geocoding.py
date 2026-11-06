"""Place search through Photon (komoot), a keyless OSM geocoder with type-ahead."""

import requests

from .http import TIMEOUT_S, UpstreamError, cache_key, cached, session

PHOTON_URL = "https://photon.komoot.io/api/"
# Bias results towards the continental US; the risk rules are imperial.
US_CENTER = {"lat": 39.8, "lon": -98.6}


def _label(props: dict) -> str:
    parts = [props.get("name"), props.get("city"), props.get("state"), props.get("countrycode")]
    seen: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return ", ".join(seen)


ROUTABLE = {"US", "CA"}


def routable_places(features: list[dict], limit: int) -> list[dict]:
    """US and Canada only (where truck routing works), one entry per label."""
    out: list[dict] = []
    seen: set[str] = set()
    for f in features:
        props = f.get("properties", {})
        if (props.get("countrycode") or "").upper() not in ROUTABLE:
            continue
        label = _label(props)
        if label in seen:
            continue
        seen.add(label)
        lng, lat = f["geometry"]["coordinates"]
        out.append({"label": label, "lat": lat, "lng": lng})
        if len(out) == limit:
            break
    return out


def search(query: str, limit: int = 6) -> list[dict]:
    query = query.strip()
    if len(query) < 2:
        return []

    def fetch():
        try:
            r = session.get(
                PHOTON_URL,
                # Ask for extra so filtering to the US/Canada and de-duplicating still fills the list.
                params={"q": query, "limit": limit * 3, "lang": "en", **US_CENTER, "location_bias_scale": 0.5},
                timeout=TIMEOUT_S,
            )
            r.raise_for_status()
        except requests.RequestException as exc:
            raise UpstreamError("Place search is unavailable right now.") from exc
        return routable_places(r.json().get("features", []), limit)

    return cached(cache_key("geo2", [query.lower(), limit]), 7 * 24 * 3600, fetch)
