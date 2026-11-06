"""The routing region: mainland US, Alaska and Canada.

A coarse outline, accurate to a few miles along the Mexican border (it follows
the land border and the Rio Grande) and generous at sea. It keeps out places a
truck can't reach by road from the region (Mexico, the Caribbean, Hawaii,
Greenland) so the user hears why before a provider fails.
"""

from .geometry import LngLat

# (lng, lat), counter-clockwise from the Pacific end of the Mexican border.
OUTLINE: list[LngLat] = [
    (-117.12, 32.53),
    (-114.72, 32.72),
    (-114.81, 32.49),
    (-111.07, 31.33),
    (-108.21, 31.33),
    (-108.21, 31.78),
    (-106.53, 31.78),
    (-104.37, 29.56),
    (-103.20, 28.97),
    (-102.40, 29.78),
    (-100.90, 29.36),
    (-99.50, 27.50),
    (-97.50, 25.88),
    (-96.50, 25.90),
    (-83.50, 24.20),
    (-79.60, 24.60),
    (-79.60, 27.60),
    (-74.50, 35.00),
    (-69.00, 40.00),
    (-65.50, 43.00),
    (-52.00, 46.50),
    (-52.00, 53.00),
    (-55.00, 60.00),
    (-75.00, 72.00),
    (-169.00, 72.00),
    (-169.00, 51.00),
    (-134.00, 51.00),
    (-126.00, 48.00),
    (-124.90, 40.00),
    (-121.00, 34.00),
]

MESSAGE = "Routing is available in the US and Canada."


def in_region(point: LngLat) -> bool:
    """Ray casting against OUTLINE."""
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside
