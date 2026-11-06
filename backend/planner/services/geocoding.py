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


def search(query: str, limit: int = 6) -> list[dict]:
    query = query.strip()
    if len(query) < 2:
        return []

    def fetch():
        try:
            r = session.get(
                PHOTON_URL,
                params={"q": query, "limit": limit, "lang": "en", **US_CENTER, "location_bias_scale": 0.5},
                timeout=TIMEOUT_S,
            )
            r.raise_for_status()
        except requests.RequestException as exc:
            raise UpstreamError("Place search is unavailable right now.") from exc
        results = []
        for f in r.json().get("features", []):
            lng, lat = f["geometry"]["coordinates"]
            results.append({"label": _label(f["properties"]), "lat": lat, "lng": lng})
        return results

    return cached(cache_key("geo", [query.lower(), limit]), 7 * 24 * 3600, fetch)
