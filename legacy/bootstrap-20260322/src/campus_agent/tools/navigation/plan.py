from __future__ import annotations


JsonDict = dict[str, object]

TOOL_NAME = "campus_navigation_plan"
CONTRACT_VERSION = "v1"
TRACE_ID = "trace-fixture-campus-navigation-plan"
ALLOWED_NAVIGATION_PLAN_STATUSES = ("prepared",)
ALLOWED_NAVIGATION_PLAN_FIELDS = frozenset({"navigation_mode", "target", "summary"})
_ALLOWED_TARGET_FIELDS = frozenset({"campus_id", "poi_id", "label", "coordinate"})
_ALLOWED_COORDINATE_FIELDS = frozenset({"lat", "lng"})


class FixtureBackedCampusNavigationPlanTool:
    """Minimal confirmation-safe navigation preparation for workflow integration."""

    def plan(self, request: JsonDict) -> JsonDict:
        selected_campus = self._require_mapping(request, "selected_campus")
        selected_poi = self._require_mapping(request, "selected_poi")
        target_coordinate = self._normalize_coordinate(request["target_coordinate"])
        navigation_mode = self._require_non_empty_text(
            request["navigation_mode"],
            "navigation_mode",
        )

        campus_id = self._require_non_empty_text(selected_campus["campus_id"], "campus_id")
        poi_id = self._require_non_empty_text(selected_poi["poi_id"], "poi_id")
        label = self._require_non_empty_text(selected_poi["label"], "label")

        target = {
            "campus_id": campus_id,
            "poi_id": poi_id,
            "label": label,
            "coordinate": target_coordinate,
        }
        self._assert_navigation_plan_fields(target, _ALLOWED_TARGET_FIELDS)

        navigation_plan = {
            "navigation_mode": navigation_mode,
            "target": target,
            "summary": (
                f"Ready to request {navigation_mode} navigation to {label} "
                "after workflow confirmation."
            ),
        }
        self._assert_navigation_plan_fields(
            navigation_plan,
            ALLOWED_NAVIGATION_PLAN_FIELDS,
        )

        return {
            "ok": True,
            "tool_name": TOOL_NAME,
            "contract_version": CONTRACT_VERSION,
            "request_id": self._build_request_id(
                campus_id=campus_id,
                poi_name=self._require_non_empty_text(selected_poi["poi_name"], "poi_name"),
                navigation_mode=navigation_mode,
            ),
            "trace_id": TRACE_ID,
            "data": {
                "status": "prepared",
                "navigation_plan": navigation_plan,
                "requires_confirmation": True,
            },
        }

    def _build_request_id(
        self,
        *,
        campus_id: str,
        poi_name: str,
        navigation_mode: str,
    ) -> str:
        return (
            f"fixture-navigation-{self._slugify(campus_id)}-"
            f"{self._slugify(poi_name)}-{self._slugify(navigation_mode)}"
        )

    def _normalize_coordinate(self, value: object) -> JsonDict:
        if not isinstance(value, dict):
            raise ValueError("target_coordinate must be an object")
        if set(value.keys()) != _ALLOWED_COORDINATE_FIELDS:
            raise ValueError(
                "target_coordinate must contain exactly ['lat', 'lng']"
            )
        lat = value["lat"]
        lng = value["lng"]
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            raise ValueError("target_coordinate.lat and target_coordinate.lng must be numeric")
        return {"lat": float(lat), "lng": float(lng)}

    def _assert_navigation_plan_fields(
        self,
        payload: JsonDict,
        allowed_fields: frozenset[str],
    ) -> None:
        unknown_fields = set(payload) - allowed_fields
        if unknown_fields:
            raise ValueError(f"Unsupported navigation plan fields: {sorted(unknown_fields)}")

    def _require_mapping(self, payload: JsonDict, key: str) -> JsonDict:
        value = payload[key]
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be an object")
        return value

    def _require_non_empty_text(self, value: object, field_name: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a string")
        text = value.strip()
        if not text:
            raise ValueError(f"{field_name} must not be empty")
        return text

    def _slugify(self, value: str) -> str:
        return "-".join(value.strip().lower().split())

