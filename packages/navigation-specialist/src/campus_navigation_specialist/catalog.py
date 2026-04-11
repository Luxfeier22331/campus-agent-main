from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re

from campus_contracts import GeoPoint, PlaceCard, PlaceCandidate, PlaceEntityType, PlaceRef


_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_SEED_PATH = (
    _REPO_ROOT / "configs" / "ingestion" / "campus_navigation" / "place_catalog" / "seed.v1.json"
)
_TRAILING_QUERY_PATTERNS = (
    r"(在哪里|在哪儿|在哪|位于哪里|在什么地方|位置在哪)$",
    r"(怎么去|怎么走|怎么到)$",
    r"(从哪个门进|从哪进|在哪个门)$",
)
_LEADING_QUERY_PATTERNS = (
    r"^(请问|想问下|问下|我想去|我想找|我想知道|带我去|去一下)",
)


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    place_id: str
    entity_type: PlaceEntityType
    display_name: str
    campus_scope: str
    campus_area: str
    aliases: tuple[str, ...]
    location_description: str
    landmark_hint: str
    access_note: str
    opening_note: str
    service_tags: tuple[str, ...]
    point_geometry: GeoPoint
    coordinate_reference_system: str
    source_refs: tuple[str, ...]
    verification_state: str

    @property
    def place_ref(self) -> PlaceRef:
        return PlaceRef(
            place_id=self.place_id,
            entity_type=self.entity_type,
            display_name=self.display_name,
            campus_scope=self.campus_scope,
            campus_area=self.campus_area,
        )

    @property
    def place_card(self) -> PlaceCard:
        return PlaceCard(
            place=self.place_ref,
            location_description=self.location_description,
            landmark_hint=self.landmark_hint,
            access_note=self.access_note,
            opening_note=self.opening_note,
            service_tags=self.service_tags,
            point_geometry=self.point_geometry,
            coordinate_reference_system=self.coordinate_reference_system,
            source_refs=self.source_refs,
        )


def load_place_catalog(seed_path: Path | None = None) -> tuple[CatalogEntry, ...]:
    payload = json.loads((seed_path or _DEFAULT_SEED_PATH).read_text(encoding="utf-8"))
    return tuple(_entry_from_payload(item) for item in payload["places"])


def resolve_place_candidates(
    query_text: str,
    *,
    catalog: tuple[CatalogEntry, ...] | None = None,
) -> tuple[str, tuple[CatalogEntry, ...]]:
    active_catalog = catalog or load_place_catalog()
    normalized_subject = normalize_place_query(query_text)
    if not normalized_subject:
        return "", ()

    exact_candidates = tuple(
        entry for entry in active_catalog if normalized_subject in _normalized_aliases_for_entry(entry)
    )
    if exact_candidates:
        return normalized_subject, exact_candidates

    partial_candidates = tuple(
        entry
        for entry in active_catalog
        if any(normalized_subject in alias or alias in normalized_subject for alias in _normalized_aliases_for_entry(entry))
    )
    return normalized_subject, partial_candidates


def normalize_place_query(query_text: str) -> str:
    normalized = re.sub(r"[？?！!，,。；;：:\s]", "", query_text)
    for pattern in _LEADING_QUERY_PATTERNS:
        normalized = re.sub(pattern, "", normalized)
    for pattern in _TRAILING_QUERY_PATTERNS:
        normalized = re.sub(pattern, "", normalized)
    return normalized.strip()


def build_candidate_list(entries: tuple[CatalogEntry, ...]) -> tuple[PlaceCandidate, ...]:
    return tuple(
        PlaceCandidate(
            place=entry.place_ref,
            clarification_hint=f"{entry.campus_scope} 校区 {entry.campus_area}".strip(),
        )
        for entry in entries
    )


def _normalized_aliases_for_entry(entry: CatalogEntry) -> tuple[str, ...]:
    return tuple(dict.fromkeys(normalize_place_query(alias) for alias in (entry.display_name, *entry.aliases)))


def _entry_from_payload(item: dict[str, object]) -> CatalogEntry:
    geometry = item["point_geometry"]
    if not isinstance(geometry, dict):
        raise ValueError("point_geometry must be an object")

    return CatalogEntry(
        place_id=str(item["place_id"]),
        entity_type=str(item["entity_type"]),  # type: ignore[arg-type]
        display_name=str(item["display_name"]),
        campus_scope=str(item["campus_scope"]),
        campus_area=str(item.get("campus_area", "")),
        aliases=tuple(str(alias) for alias in item.get("aliases", [])),
        location_description=str(item["location_description"]),
        landmark_hint=str(item.get("landmark_hint", "")),
        access_note=str(item.get("access_note", "")),
        opening_note=str(item.get("opening_note", "")),
        service_tags=tuple(str(tag) for tag in item.get("service_tags", [])),
        point_geometry=GeoPoint(
            longitude=float(geometry["longitude"]),
            latitude=float(geometry["latitude"]),
        ),
        coordinate_reference_system=str(item.get("coordinate_reference_system", "EPSG:4326")),
        source_refs=tuple(str(source_ref) for source_ref in item.get("source_refs", [])),
        verification_state=str(item.get("verification_state", "")),
    )
