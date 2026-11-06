"""Shared HTTP session and a small read-through cache for third-party calls."""

import hashlib
import json
import logging
from collections.abc import Callable
from typing import Any

import requests
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger("planner")

session = requests.Session()
session.headers["User-Agent"] = settings.HTTP_USER_AGENT
TIMEOUT_S = 20


class UpstreamError(Exception):
    """A third-party API failed in a way the user should hear about."""


def cache_key(prefix: str, payload: Any) -> str:
    digest = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return f"{prefix}:{digest}"


def cached(key: str, ttl_s: int, fetch: Callable[[], Any]) -> Any:
    hit = cache.get(key)
    if hit is not None:
        return hit
    value = fetch()
    cache.set(key, value, ttl_s)
    return value
