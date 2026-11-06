import logging

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .planner import Place, PlanRequest, build_plan
from .serializers import PlanRequestSerializer
from .services import geocoding
from .services.http import UpstreamError

log = logging.getLogger("planner")


@api_view(["GET"])
def health(_request: Request) -> Response:
    return Response({"ok": True})


@api_view(["GET"])
def geocode(request: Request) -> Response:
    try:
        results = geocoding.search(request.query_params.get("q", ""))
    except UpstreamError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    response = Response({"results": results})
    response["Cache-Control"] = "public, s-maxage=86400, stale-while-revalidate=604800"
    return response


def _messages(errors) -> list[str]:
    if isinstance(errors, dict):
        return [m for v in errors.values() for m in _messages(v)]
    if isinstance(errors, list):
        return [m for v in errors for m in _messages(v)]
    return [str(errors)]


@api_view(["POST"])
def plan(request: Request) -> Response:
    s = PlanRequestSerializer(data=request.data)
    if not s.is_valid():
        # One readable line on top of DRF's per-field errors (stops nest a level deeper).
        return Response({"detail": " ".join(dict.fromkeys(_messages(s.errors))), "errors": s.errors}, status=status.HTTP_400_BAD_REQUEST)
    d = s.validated_data
    req = PlanRequest(
        origin=Place(**d["origin"]),
        destination=Place(**d["destination"]),
        stops=[Place(**p) for p in d["stops"]],
        departure=d["departure"],
        load_lb=d["load_lb"],
    )
    try:
        return Response(build_plan(req))
    except UpstreamError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
