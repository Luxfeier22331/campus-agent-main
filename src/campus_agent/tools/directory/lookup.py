from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path


JsonDict = dict[str, object]

TOOL_NAME = "campus_directory_lookup"
CONTRACT_VERSION = "v1"
TRACE_ID = "trace-fixture-campus-directory-lookup"
ALLOWED_DIRECTORY_ENTRY_TYPES = (
    "phone",
    "url",
    "email",
    "address",
    "service_entry",
)
ALLOWED_DIRECTORY_ENTRY_FIELDS = frozenset(
    {
        "entry_type",
        "label",
        "value",
        "department",
        "building",
        "room",
        "address_lines",
    }
)


@dataclass(slots=True, frozen=True)
class DirectoryFixtureRecord:
    record_id: str
    campus_scope: str | None
    match_terms: tuple[str, ...]
    entries: tuple[JsonDict, ...]


class FixtureBackedCampusDirectoryLookupTool:
    """Fixture-backed implementation frozen to the Agent 3 directory surface."""

    def __init__(self, *, fixture_path: str | Path) -> None:
        self.fixture_path = Path(fixture_path)
        self._records = self._load_records(self.fixture_path)

    def lookup(self, request: JsonDict) -> JsonDict:
        query = self._require_string(request, "query")
        campus_scope = self._optional_string(request.get("campus_scope"))

        record = self._find_record(query=query, campus_scope=campus_scope)
        request_id = self._build_request_id(query=query, matched_record=record)
        entries = [] if record is None else [dict(entry) for entry in record.entries]
        match_type = "none" if record is None else "exact"

        return {
            "ok": True,
            "tool_name": TOOL_NAME,
            "contract_version": CONTRACT_VERSION,
            "request_id": request_id,
            "trace_id": TRACE_ID,
            "data": {
                "match_type": match_type,
                "entries": entries,
            },
        }

    def _find_record(
        self, *, query: str, campus_scope: str | None
    ) -> DirectoryFixtureRecord | None:
        normalized_query = self._normalize(query)

        for record in self._records:
            if campus_scope and record.campus_scope != campus_scope:
                continue
            if normalized_query in record.match_terms:
                return record
        return None

    def _load_records(self, fixture_path: Path) -> tuple[DirectoryFixtureRecord, ...]:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        records: list[DirectoryFixtureRecord] = []
        for raw_record in payload.get("records", []):
            entries = tuple(
                self._normalize_entry(dict(raw_entry))
                for raw_entry in list(raw_record.get("entries") or [])
            )
            records.append(
                DirectoryFixtureRecord(
                    record_id=str(raw_record["record_id"]),
                    campus_scope=self._optional_string(raw_record.get("campus_scope")),
                    match_terms=tuple(
                        self._normalize(term)
                        for term in list(raw_record.get("match_terms") or [])
                    ),
                    entries=entries,
                )
            )
        return tuple(records)

    def _normalize_entry(self, entry: JsonDict) -> JsonDict:
        unknown_fields = set(entry) - ALLOWED_DIRECTORY_ENTRY_FIELDS
        if unknown_fields:
            raise ValueError(
                f"Unsupported directory entry fields in fixture: {sorted(unknown_fields)}"
            )

        missing_fields = {"entry_type", "label", "value"} - set(entry)
        if missing_fields:
            raise ValueError(
                f"Missing required directory entry fields in fixture: {sorted(missing_fields)}"
            )

        entry_type = str(entry["entry_type"])
        if entry_type not in ALLOWED_DIRECTORY_ENTRY_TYPES:
            raise ValueError(f"Unsupported directory entry type: {entry_type}")

        normalized_entry = {
            "entry_type": entry_type,
            "label": self._require_non_empty_text(entry["label"], "label"),
            "value": self._require_non_empty_text(entry["value"], "value"),
        }

        for field_name in ("department", "building", "room"):
            if field_name in entry and entry[field_name] is not None:
                normalized_entry[field_name] = self._require_non_empty_text(
                    entry[field_name], field_name
                )

        if "address_lines" in entry and entry["address_lines"] is not None:
            address_lines = list(entry["address_lines"])
            normalized_entry["address_lines"] = [
                self._require_non_empty_text(line, "address_lines") for line in address_lines
            ]

        return normalized_entry

    def _build_request_id(
        self, *, query: str, matched_record: DirectoryFixtureRecord | None
    ) -> str:
        if matched_record is not None:
            return f"fixture-directory-{matched_record.record_id}"
        return f"fixture-directory-{self._slugify(query)}"

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
