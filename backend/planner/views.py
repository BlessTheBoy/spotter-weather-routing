import logging

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .planner import PlanRequest, build_plan
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


@api_view(["POST"])
def plan(request: Request) -> Response:
    s = PlanRequestSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    req = PlanRequest(
        origin=(d["origin"]["lng"], d["origin"]["lat"]),
        destination=(d["destination"]["lng"], d["destination"]["lat"]),
        departure=d["departure"],
        load_lb=d["load_lb"],
        interval_mi=int(d["interval_mi"]),
    )
    try:
        return Response(build_plan(req))
    except UpstreamError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
