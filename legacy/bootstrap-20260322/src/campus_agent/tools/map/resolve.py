from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path


JsonDict = dict[str, object]

TOOL_NAME = "campus_map_resolve"
CONTRACT_VERSION = "v1"
TRACE_ID = "trace-fixture-campus-map-resolve"
ALLOWED_MAP_RESOLVE_STATUSES = (
    "resolved",
    "campus_ambiguous",
    "poi_ambiguous",
    "no_match",
)
ALLOWED_COORDINATE_FIELDS = frozenset({"lat", "lng"})
ALLOWED_CAMPUS_CANDIDATE_FIELDS = frozenset(
    {"campus_id", "campus_name", "label", "match_reason", "coordinate"}
)
ALLOWED_POI_CANDIDATE_FIELDS = frozenset(
    {
        "poi_id",
        "poi_name",
        "label",
        "campus_id",
        "building",
        "floor",
        "room",
        "coordinate",
        "match_reason",
    }
)
_REQUIRED_CAMPUS_FIELDS = frozenset({"campus_id", "campus_name", "label"})
_REQUIRED_POI_FIELDS = frozenset({"poi_id", "poi_name", "label", "campus_id"})
_ALLOWED_FIXTURE_CAMPUS_FIELDS = frozenset(
    {"campus_id", "campus_name", "label", "coordinate", "match_terms"}
)
_ALLOWED_FIXTURE_POI_FIELDS = frozenset(
    {
        "poi_id",
        "poi_name",
        "label",
        "campus_id",
        "building",
        "floor",
        "room",
        "coordinate",
        "match_terms",
    }
)


@dataclass(slots=True, frozen=True)
class CampusFixtureRecord:
    campus_id: str
    campus_name: str
    label: str
    coordinate: JsonDict
    match_terms: tuple[str, ...]


@dataclass(slots=True, frozen=True)
class PoiFixtureRecord:
    poi_id: str
    poi_name: str
    label: str
    campus_id: str
    building: str | None
    floor: str | None
    room: str | None
    coordinate: JsonDict
    match_terms: tuple[str, ...]


class FixtureBackedCampusMapResolveTool:
    """Fixture-backed implementation frozen to the Agent 4 map tool surface."""

    def __init__(self, *, fixture_path: str | Path) -> None:
        self.fixture_path = Path(fixture_path)
        self._campuses, self._pois = self._load_records(self.fixture_path)
        self._campus_by_id = {campus.campus_id: campus for campus in self._campuses}

    def resolve(self, request: JsonDict) -> JsonDict:
        query = self._require_string(request, "query")
        campus_scope = self._optional_string(request.get("campus_scope"))
        normalized_query = self._normalize(query)

        matched_campuses = self._find_campus_matches(
            normalized_query=normalized_query,
            campus_scope=campus_scope,
        )
        matched_pois = self._find_poi_matches(
            normalized_query=normalized_query,
            campus_scope=campus_scope,
        )

        data = self._resolve_data(
            matched_campuses=matched_campuses,
            matched_pois=matched_pois,
        )

        return {
            "ok": True,
            "tool_name": TOOL_NAME,
            "contract_version": CONTRACT_VERSION,
            "request_id": self._build_request_id(query=query, campus_scope=campus_scope),
            "trace_id": TRACE_ID,
            "data": data,
        }

    def _resolve_data(
        self,
        *,
        matched_campuses: tuple[CampusFixtureRecord, ...],
        matched_pois: tuple[PoiFixtureRecord, ...],
    ) -> JsonDict:
        poi_campus_ids = self._ordered_unique([poi.campus_id for poi in matched_pois])
        direct_campus_ids = self._ordered_unique(
            [campus.campus_id for campus in matched_campuses]
        )

        if matched_pois:
            if len(poi_campus_ids) > 1:
                return {
                    "status": "campus_ambiguous",
                    "campus_candidates": [
                        self._campus_candidate(
                            self._campus_by_id[campus_id],
                            match_reason="Query matched a POI on this campus",
                        )
                        for campus_id in poi_campus_ids
                    ],
                    "poi_candidates": [],
                }

            selected_campus = self._selected_campus_for_poi_matches(
                campus_id=poi_campus_ids[0],
                matched_campuses=matched_campuses,
            )
            if len(matched_pois) > 1:
                return {
                    "status": "poi_ambiguous",
                    "campus_candidates": [],
                    "poi_candidates": [
                        self._poi_candidate(
                            poi,
                            match_reason="Matched POI name or alias",
                        )
                        for poi in matched_pois
                    ],
                    "selected_campus": selected_campus,
                }

            selected_poi = self._poi_candidate(
                matched_pois[0],
                match_reason="Matched POI name or alias",
            )
            return {
                "status": "resolved",
                "campus_candidates": [],
                "poi_candidates": [],
                "selected_campus": selected_campus,
                "selected_poi": selected_poi,
                "target_coordinate": dict(matched_pois[0].coordinate),
            }

        if len(direct_campus_ids) > 1:
            return {
                "status": "campus_ambiguous",
                "campus_candidates": [
                    self._campus_candidate(
                        self._campus_by_id[campus_id],
                        match_reason="Matched campus name or alias",
                    )
                    for campus_id in direct_campus_ids
                ],
                "poi_candidates": [],
            }

        return {
            "status": "no_match",
            "campus_candidates": [],
            "poi_candidates": [],
        }

    def _selected_campus_for_poi_matches(
        self,
        *,
        campus_id: str,
        matched_campuses: tuple[CampusFixtureRecord, ...],
    ) -> JsonDict:
        selected_campus = self._campus_by_id[campus_id]
        match_reason = "Query matched a POI on this campus"
        for campus in matched_campuses:
            if campus.campus_id == campus_id:
                match_reason = "Matched campus name or alias"
                break
        return self._campus_candidate(selected_campus, match_reason=match_reason)

    def _find_campus_matches(
        self,
        *,
        normalized_query: str,
        campus_scope: str | None,
    ) -> tuple[CampusFixtureRecord, ...]:
        matches: list[CampusFixtureRecord] = []
        for campus in self._campuses:
            if campus_scope and campus.campus_id != campus_scope:
                continue
            if normalized_query in campus.match_terms:
                matches.append(campus)
        return tuple(matches)

    def _find_poi_matches(
        self,
        *,
        normalized_query: str,
        campus_scope: str | None,
    ) -> tuple[PoiFixtureRecord, ...]:
        matches: list[PoiFixtureRecord] = []
        for poi in self._pois:
            if campus_scope and poi.campus_id != campus_scope:
                continue
            if normalized_query in poi.match_terms:
                matches.append(poi)
        return tuple(matches)

    def _load_records(
        self,
        fixture_path: Path,
    ) -> tuple[tuple[CampusFixtureRecord, ...], tuple[PoiFixtureRecord, ...]]:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        raw_campuses = list(payload.get("campuses") or [])
        raw_pois = list(payload.get("pois") or [])

        campuses = tuple(self._normalize_campus_record(dict(raw)) for raw in raw_campuses)
        campus_ids = {campus.campus_id for campus in campuses}
        pois = tuple(
            self._normalize_poi_record(dict(raw), campus_ids=campus_ids) for raw in raw_pois
        )
        return campuses, pois

    def _normalize_campus_record(self, campus: JsonDict) -> CampusFixtureRecord:
        unknown_fields = set(campus) - _ALLOWED_FIXTURE_CAMPUS_FIELDS
        if unknown_fields:
            raise ValueError(
                f"Unsupported campus fixture fields: {sorted(unknown_fields)}"
            )

        missing_fields = {
            "campus_id",
            "campus_name",
            "label",
            "coordinate",
            "match_terms",
        } - set(campus)
        if missing_fields:
            raise ValueError(
                f"Missing required campus fixture fields: {sorted(missing_fields)}"
            )

        return CampusFixtureRecord(
            campus_id=self._require_non_empty_text(campus["campus_id"], "campus_id"),
            campus_name=self._require_non_empty_text(
                campus["campus_name"], "campus_name"
            ),
            label=self._require_non_empty_text(campus["label"], "label"),
            coordinate=self._normalize_coordinate(campus["coordinate"]),
            match_terms=tuple(
                self._normalize(self._require_non_empty_text(term, "match_terms"))
                for term in list(campus["match_terms"])
            ),
        )

    def _normalize_poi_record(
        self,
        poi: JsonDict,
        *,
        campus_ids: set[str],
    ) -> PoiFixtureRecord:
        unknown_fields = set(poi) - _ALLOWED_FIXTURE_POI_FIELDS
        if unknown_fields:
            raise ValueError(f"Unsupported POI fixture fields: {sorted(unknown_fields)}")

        missing_fields = {
            "poi_id",
            "poi_name",
            "label",
            "campus_id",
            "coordinate",
            "match_terms",
        } - set(poi)
        if missing_fields:
            raise ValueError(
                f"Missing required POI fixture fields: {sorted(missing_fields)}"
            )

        campus_id = self._require_non_empty_text(poi["campus_id"], "campus_id")
        if campus_id not in campus_ids:
            raise ValueError(f"POI references unknown campus_id: {campus_id}")

        return PoiFixtureRecord(
            poi_id=self._require_non_empty_text(poi["poi_id"], "poi_id"),
            poi_name=self._require_non_empty_text(poi["poi_name"], "poi_name"),
            label=self._require_non_empty_text(poi["label"], "label"),
            campus_id=campus_id,
            building=self._optional_text(poi.get("building"), "building"),
            floor=self._optional_text(poi.get("floor"), "floor"),
            room=self._optional_text(poi.get("room"), "room"),
            coordinate=self._normalize_coordinate(poi["coordinate"]),
            match_terms=tuple(
                self._normalize(self._require_non_empty_text(term, "match_terms"))
                for term in list(poi["match_terms"])
            ),
        )

    def _campus_candidate(
        self,
        campus: CampusFixtureRecord,
        *,
        match_reason: str,
    ) -> JsonDict:
        candidate = {
            "campus_id": campus.campus_id,
            "campus_name": campus.campus_name,
            "label": campus.label,
            "match_reason": match_reason,
            "coordinate": dict(campus.coordinate),
        }
        self._assert_candidate_fields(candidate, ALLOWED_CAMPUS_CANDIDATE_FIELDS)
        return candidate

    def _poi_candidate(
        self,
        poi: PoiFixtureRecord,
        *,
        match_reason: str,
    ) -> JsonDict:
        candidate: JsonDict = {
            "poi_id": poi.poi_id,
            "poi_name": poi.poi_name,
            "label": poi.label,
            "campus_id": poi.campus_id,
            "coordinate": dict(poi.coordinate),
            "match_reason": match_reason,
        }
        if poi.building is not None:
            candidate["building"] = poi.building
        if poi.floor is not None:
            candidate["floor"] = poi.floor
        if poi.room is not None:
            candidate["room"] = poi.room
        self._assert_candidate_fields(candidate, ALLOWED_POI_CANDIDATE_FIELDS)
        return candidate

    def _assert_candidate_fields(
        self,
        candidate: JsonDict,
        allowed_fields: frozenset[str],
    ) -> None:
        unknown_fields = set(candidate) - allowed_fields
        if unknown_fields:
            raise ValueError(f"Unsupported output fields: {sorted(unknown_fields)}")

    def _normalize_coordinate(self, value: object) -> JsonDict:
        if not isinstance(value, dict):
            raise ValueError("coordinate must be an object")
        if set(value.keys()) != ALLOWED_COORDINATE_FIELDS:
            raise ValueError(
                f"coordinate must contain exactly {sorted(ALLOWED_COORDINATE_FIELDS)}"
            )
        lat = value["lat"]
        lng = value["lng"]
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            raise ValueError("coordinate.lat and coordinate.lng must be numeric")
        return {"lat": float(lat), "lng": float(lng)}

    def _build_request_id(self, *, query: str, campus_scope: str | None) -> str:
        request_slug = self._slugify(query)
        if campus_scope:
            request_slug = f"{request_slug}-{self._slugify(campus_scope)}"
        return f"fixture-map-{request_slug}"

    def _ordered_unique(self, values: list[str]) -> tuple[str, ...]:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return tuple(ordered)

    def _normalize(self, value: str) -> str:
        return " ".join(value.strip().lower().split())

    def _slugify(self, value: str) -> str:
        slug = self._normalize(value).replace(" ", "-")
        return slug or "empty-query"

    def _require_string(self, payload: JsonDict, key: str) -> str:
        return self._require_non_empty_text(payload[key], key)

    def _require_non_empty_text(self, value: object, field_name: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a string")
        text = value.strip()
        if not text:
            raise ValueError(f"{field_name} must not be empty")
        return text

    def _optional_string(self, value: object) -> str | None:
        if value is None:
            return None
        return self._require_non_empty_text(value, "campus_scope")

    def _optional_text(self, value: object, field_name: str) -> str | None:
        if value is None:
            return None
        return self._require_non_empty_text(value, field_name)

