from datetime import UTC, datetime, timedelta
from itertools import pairwise

from rest_framework import serializers

from .domain.region import MESSAGE as REGION_MESSAGE
from .domain.region import in_region

MAX_DEPARTURE_AHEAD = timedelta(days=7)  # 10-day forecasts cover a week out plus the trip and track
MAX_STOPS = 3


class PlaceSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=200, default="")

    def validate(self, attrs):
        if not in_region((attrs["lng"], attrs["lat"])):
            raise serializers.ValidationError(REGION_MESSAGE)
        return attrs


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    stops = PlaceSerializer(many=True, required=False, default=list, max_length=MAX_STOPS)
    departure = serializers.DateTimeField()
    load_lb = serializers.FloatField(
        min_value=0,
        max_value=200_000,
        error_messages={
            "required": "Enter the load in pounds.",
            "null": "Enter the load in pounds.",
            "invalid": "Enter the load in pounds.",
            "min_value": "Load can't be negative.",
            "max_value": "Load must be at most 200,000 lb.",
        },
    )

    def validate_departure(self, value: datetime) -> datetime:
        now = datetime.now(UTC)
        if value < now - timedelta(hours=1):
            raise serializers.ValidationError("Departure can't be in the past.")
        if value > now + MAX_DEPARTURE_AHEAD:
            raise serializers.ValidationError("Departure must be within the next 7 days, where forecasts are available.")
        return value

    def validate(self, attrs):
        places = [attrs["origin"], *attrs["stops"], attrs["destination"]]
        for a, b in pairwise(places):
            if abs(a["lat"] - b["lat"]) < 1e-4 and abs(a["lng"] - b["lng"]) < 1e-4:
                raise serializers.ValidationError("Two consecutive places on the trip are the same.")
        return attrs
