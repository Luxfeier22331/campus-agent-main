from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.chunking import (
    CURRICULUM_V1_CHUNK_POLICY_VERSION,
    CURRICULUM_V1_MAX_CHUNK_SIZE,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    CURRICULUM_V2_MAX_CHUNK_SIZE,
    CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE,
    DEFAULT_MAX_CHUNK_SIZE,
    HANDBOOK_V1_CHUNK_POLICY_VERSION,
    HANDBOOK_V2_CHUNK_POLICY_VERSION,
    HANDBOOK_V2_MAX_CHUNK_SIZE,
    HANDBOOK_V3_CHUNK_POLICY_VERSION,
    HANDBOOK_V3_MAX_CHUNK_SIZE,
    OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION,
    OFFICIAL_WEB_V2_MAX_CHUNK_SIZE,
)
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_chunk_profile
from campus_ingestion_core.embed import EmbeddingSettings
from campus_ingestion_core.process import IndexableChunk

DEFAULT_QDRANT_UPSERT_BATCH_SIZE = 128
DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS = 60.0
_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION = "retrieval-qrels-denominator-policy-v1"


def sample_release_payloads(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    sample_limit: int,
) -> tuple[dict[str, object], ...]:
    records, _ = qdrant_client.scroll(
        collection_name=collection_name,
        limit=max(sample_limit, 1),
        with_payload=True,
        with_vectors=False,
    )
    payloads: list[dict[str, object]] = []
    for record in records or ():
        payload = getattr(record, "payload", None)
        payloads.append(dict(payload or {}) if isinstance(payload, Mapping) else {})
    return tuple(payloads)


def release_payload_mismatch_issues(
    *,
    payloads: Sequence[Mapping[str, object]],
    expected_release_metadata: Mapping[str, object],
) -> tuple[str, ...]:
    issues: list[str] = []
    required_fields = tuple(
        field
        for field, expected_value in expected_release_metadata.items()
        if expected_value is not None
    )
    for index, payload in enumerate(payloads, start=1):
        missing = [field for field in required_fields if field not in payload]
        if missing:
            issues.append(f"sample_{index}_missing_fields:" + ",".join(missing))
            continue
        mismatches = [
            field
            for field, expected_value in expected_release_metadata.items()
            if not _release_metadata_values_match(payload.get(field), expected_value)
        ]
        if mismatches:
            issues.append(f"sample_{index}_metadata_mismatch:" + ",".join(mismatches))
    return tuple(issues)


def read_collection_points_count(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
) -> int | None:
    try:
        collection_info = qdrant_client.get_collection(collection_name=collection_name)
    except TypeError:
        collection_info = qdrant_client.get_collection(collection_name)
    points_count = getattr(collection_info, "points_count", None)
    return None if points_count is None else int(points_count)


def is_mock_qdrant_client(qdrant_client: object) -> bool:
    return type(qdrant_client).__module__.startswith("unittest.mock")


@dataclass(frozen=True, slots=True)
class ReleaseChunkQualityBudget:
    max_token_count: int
    source: str
    max_token_count_by_unit_type: dict[str, int]


def resolve_release_chunk_quality_budget(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
) -> ReleaseChunkQualityBudget:
    if corpus == "regulations" and collection == "student_rules":
        handbook_limits = {
            HANDBOOK_V1_CHUNK_POLICY_VERSION: DEFAULT_MAX_CHUNK_SIZE,
            HANDBOOK_V2_CHUNK_POLICY_VERSION: HANDBOOK_V2_MAX_CHUNK_SIZE,
            HANDBOOK_V3_CHUNK_POLICY_VERSION: HANDBOOK_V3_MAX_CHUNK_SIZE,
        }
        max_token_count = handbook_limits.get(runtime_profile.chunk_profile_version)
        if max_token_count is None:
            raise ValueError(
                "unsupported student_rules chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return ReleaseChunkQualityBudget(
            max_token_count=max_token_count,
            source="student_handbook_runtime_profile",
            max_token_count_by_unit_type={},
        )
    if corpus == "curriculum" and collection == "curriculum_plan":
        if runtime_profile.chunk_profile_version == CURRICULUM_V1_CHUNK_POLICY_VERSION:
            max_token_count = CURRICULUM_V1_MAX_CHUNK_SIZE
            table_max_token_count = CURRICULUM_V1_MAX_CHUNK_SIZE
        elif runtime_profile.chunk_profile_version == CURRICULUM_V2_CHUNK_POLICY_VERSION:
            max_token_count = CURRICULUM_V2_MAX_CHUNK_SIZE
            table_max_token_count = CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE
        else:
            raise ValueError(
                "unsupported curriculum chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return ReleaseChunkQualityBudget(
            max_token_count=max_token_count,
            source="curriculum_runtime_profile",
            max_token_count_by_unit_type={"table_unit": table_max_token_count},
        )
    if corpus == "official_web":
        if runtime_profile.chunk_profile_version != OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION:
            raise ValueError(
                "unsupported official_web chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return ReleaseChunkQualityBudget(
            max_token_count=OFFICIAL_WEB_V2_MAX_CHUNK_SIZE,
            source="official_web_runtime_profile",
            max_token_count_by_unit_type={},
        )
    chunk_profile = load_chunk_profile(corpus, collection)
    if chunk_profile.chunk_profile_version != runtime_profile.chunk_profile_version:
        raise ValueError(
            "chunk-profile version does not match runtime-profile for "
            f"{corpus}/{collection}: "
            f"{chunk_profile.chunk_profile_version} != {runtime_profile.chunk_profile_version}"
        )
    if chunk_profile.cleaning_policy_version != runtime_profile.cleaning_policy_version:
        raise ValueError(
            "chunk-profile cleaning policy does not match runtime-profile for "
            f"{corpus}/{collection}: "
            f"{chunk_profile.cleaning_policy_version} != {runtime_profile.cleaning_policy_version}"
        )
    lane_max_token_count = max(
        (defaults.max_chunk_size for defaults in chunk_profile.lane_defaults.values()),
        default=chunk_profile.runtime_defaults.max_chunk_size,
    )
    return ReleaseChunkQualityBudget(
        max_token_count=max(chunk_profile.runtime_defaults.max_chunk_size, lane_max_token_count),
        source="collection_chunk_profile",
        max_token_count_by_unit_type={},
    )


def resolve_release_qrels_coverage_issues(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    qrels_coverage_issues: Sequence[str] | None,
    require_coverage: bool | None = None,
) -> tuple[str, ...]:
    coverage_required = (
        publish_alias and requires_release_retrieval_acceptance(runtime_profile)
        if require_coverage is None
        else require_coverage
    )
    if not coverage_required:
        return tuple(str(issue) for issue in qrels_coverage_issues or () if str(issue).strip())
    if qrels_coverage_issues is not None:
        return tuple(str(issue) for issue in qrels_coverage_issues if str(issue).strip())
    return _validate_default_qrels_coverage_for_scope(corpus=corpus, collection=collection)


def validate_chunk_embedding_runtime_identity(
    *,
    chunks: Sequence[IndexableChunk],
    settings: EmbeddingSettings,
) -> None:
    chunk_models = {chunk.embedding_model for chunk in chunks if chunk.embedding_model.strip()}
    if chunk_models and chunk_models != {settings.model}:
        raise ValueError(
            "release chunk embedding model mismatch: "
            f"expected {settings.model}, got {', '.join(sorted(chunk_models))}"
        )
    if settings.dimensions is None:
        return
    chunk_dimensions = {len(chunk.embedding) for chunk in chunks if chunk.embedding is not None}
    if chunk_dimensions and chunk_dimensions != {settings.dimensions}:
        raise ValueError(
            "release chunk embedding dimensions mismatch: "
            f"expected {settings.dimensions}, got {', '.join(str(item) for item in sorted(chunk_dimensions))}"
        )


def requires_release_retrieval_acceptance(profile: CollectionRuntimeProfile) -> bool:
    return bool(profile.serving_stage == "query_serving" and profile.query_enabled_by_default)


def embedding_cache_enabled(source: dict[str, str]) -> bool:
    return (source.get("INGESTION_EMBEDDING_CACHE_ENABLED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def document_units_sha256_by_key(manifest) -> dict[str, str] | None:
    if manifest is None:
        return None
    values: dict[str, str] = {}
    for document in manifest.documents:
        if document.document_units_object_key and document.document_units_sha256:
            values[document.document_units_object_key] = document.document_units_sha256
    return values or None


def build_qdrant_client(
    settings: RetrievalSettings,
    *,
    source: dict[str, str] | None = None,
) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=resolve_ingestion_qdrant_timeout_seconds(
            source=source,
            default_timeout_seconds=settings.qdrant_timeout_seconds,
        ),
        cloud_inference=True,
    )


def resolve_ingestion_qdrant_timeout_seconds(
    *,
    source: dict[str, str] | None,
    default_timeout_seconds: float,
) -> float:
    env = source if source is not None else {}
    raw_value = (env.get("INGESTION_QDRANT_TIMEOUT_SECONDS") or "").strip()
    if raw_value:
        timeout_seconds = float(raw_value)
        if timeout_seconds <= 0:
            raise ValueError("INGESTION_QDRANT_TIMEOUT_SECONDS must be greater than zero")
        return timeout_seconds
    return max(default_timeout_seconds, DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS)


def read_qdrant_upsert_batch_size(source: dict[str, str]) -> int:
    raw_value = (
        source.get("QDRANT_UPSERT_BATCH_SIZE") or str(DEFAULT_QDRANT_UPSERT_BATCH_SIZE)
    ).strip()
    batch_size = int(raw_value)
    if batch_size <= 0:
        raise ValueError("QDRANT_UPSERT_BATCH_SIZE must be greater than zero")
    return batch_size


def _release_metadata_values_match(actual: object, expected: object) -> bool:
    if isinstance(expected, float):
        return _coerce_float(actual) == expected
    if isinstance(expected, int) and not isinstance(expected, bool):
        return _coerce_int(actual) == expected
    if expected is None:
        return actual is None
    return str(actual) == str(expected)


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _validate_default_qrels_coverage_for_scope(*, corpus: str, collection: str) -> tuple[str, ...]:
    scope_key = f"{corpus}/{collection}"
    policy_path = _default_qrels_denominator_policy_path()
    policy_payload = _load_json_object(policy_path)
    policy_issues = _validate_qrels_denominator_policy_payload(policy_payload, scope_key=scope_key)
    scopes = policy_payload.get("scopes") if isinstance(policy_payload.get("scopes"), dict) else {}
    policy = scopes.get(scope_key) if isinstance(scopes, dict) else None
    if not isinstance(policy, dict):
        return (f"{scope_key}: missing qrels coverage policy",)
    qrels_path = _resolve_qrels_fixture_path(
        fixture=str(policy.get("fixture") or ""),
        policy_path=policy_path,
    )
    if not qrels_path.exists():
        return (f"{scope_key}: missing qrels fixture {qrels_path}",)
    payload = _load_json_object(qrels_path)
    cases = tuple(item for item in payload.get("cases") or () if isinstance(item, dict))
    issues: list[str] = list(policy_issues)
    case_count = len(cases)
    min_case_count = int(policy["min_case_count"])
    if case_count < min_case_count:
        issues.append(f"{scope_key}: qrels case count {case_count} below minimum {min_case_count}")
    coverage_classes = _raw_qrels_coverage_classes(cases)
    for required_class in policy["required_classes"]:
        if required_class not in coverage_classes:
            issues.append(f"{scope_key}: missing qrels coverage class {required_class}")
    declared_scenarios, scenario_issues = _declared_qrels_scenarios(payload=payload, cases=cases)
    issues.extend(f"{scope_key}: {issue}" for issue in scenario_issues)
    for required_scenario in policy["required_scenarios"]:
        if required_scenario not in declared_scenarios:
            issues.append(f"{scope_key}: missing qrels scenario {required_scenario}")
    scenario_denominator_classes = policy.get("scenario_denominator_classes")
    if not isinstance(scenario_denominator_classes, dict):
        scenario_denominator_classes = {}
    for scenario_id in declared_scenarios:
        denominator_classes = tuple(
            str(item).strip()
            for item in scenario_denominator_classes.get(scenario_id, ())
            if str(item).strip()
        )
        if not denominator_classes:
            issues.append(
                f"{scope_key}: qrels scenario {scenario_id} has no denominator class mapping"
            )
    return tuple(issues)


def _load_json_object(path) -> dict[str, object]:
    import json

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"qrels fixture must be a JSON object: {path}")
    return payload


def _default_qrels_denominator_policy_path():
    return (
        _repo_root()
        / "packages"
        / "evals"
        / "fixtures"
        / "retrieval_qrels_denominator_policy.v1.json"
    )


def _resolve_qrels_fixture_path(*, fixture: str, policy_path):
    from pathlib import Path

    path = Path(fixture)
    if path.is_absolute():
        return path
    fixture_root = _repo_root() / "packages" / "evals" / "fixtures"
    direct_path = fixture_root / path
    if direct_path.exists():
        return direct_path
    return Path(policy_path).parent / path


def _validate_qrels_denominator_policy_payload(
    payload: dict[str, object],
    *,
    scope_key: str,
) -> tuple[str, ...]:
    issues: list[str] = []
    if payload.get("schema_version") != _QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION:
        issues.append(
            "retrieval qrels denominator policy schema_version must be "
            f"{_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION}"
        )
    normalized_classes = {
        str(item).strip()
        for item in payload.get("normalized_denominator_classes") or ()
        if str(item).strip()
    }
    scopes = payload.get("scopes") if isinstance(payload.get("scopes"), dict) else {}
    scope_policy = scopes.get(scope_key) if isinstance(scopes, dict) else None
    if not isinstance(scope_policy, dict):
        return tuple(issues)
    scenario_classes = scope_policy.get("scenario_denominator_classes")
    if not isinstance(scenario_classes, dict):
        scenario_classes = {}
    for scenario_id in tuple(
        str(item).strip()
        for item in scope_policy.get("required_scenarios") or ()
        if str(item).strip()
    ):
        denominator_classes = tuple(
            str(item).strip() for item in scenario_classes.get(scenario_id, ()) if str(item).strip()
        )
        if not denominator_classes:
            issues.append(
                f"{scope_key}: required scenario {scenario_id} has no denominator class mapping"
            )
        for denominator_class in denominator_classes:
            if denominator_class not in normalized_classes:
                issues.append(
                    f"{scope_key}: scenario {scenario_id} references unknown denominator class "
                    f"{denominator_class}"
                )
    return tuple(issues)


def _raw_qrels_coverage_classes(cases: Sequence[dict[str, object]]) -> set[str]:
    coverage: set[str] = set()
    for case in cases:
        expected_sources = tuple(
            item for item in case.get("expected_sources") or () if isinstance(item, dict)
        )
        forbidden_sources = tuple(
            item for item in case.get("forbidden_sources") or () if isinstance(item, dict)
        )
        request_overrides = case.get("request_overrides")
        if expected_sources:
            coverage.add("positive")
        else:
            coverage.add("no_hit")
        if forbidden_sources:
            coverage.add("forbidden")
        if any(str(source.get("version_id") or "").strip() for source in expected_sources):
            coverage.add("version_locked")
        if isinstance(request_overrides, dict) and request_overrides:
            coverage.add("authz")
    return coverage


def _declared_qrels_scenarios(
    *,
    payload: dict[str, object],
    cases: Sequence[dict[str, object]],
) -> tuple[set[str], tuple[str, ...]]:
    raw_scenarios = payload.get("coverage_scenarios")
    if not isinstance(raw_scenarios, dict):
        return set(), ("missing qrels coverage_scenarios",)
    case_ids = {str(case.get("case_id") or "").strip() for case in cases}
    scenarios: set[str] = set()
    issues: list[str] = []
    for scenario_id, raw_case_ids in raw_scenarios.items():
        normalized_scenario_id = str(scenario_id).strip()
        if not normalized_scenario_id:
            issues.append("empty qrels scenario id")
            continue
        if not isinstance(raw_case_ids, list | tuple):
            issues.append(f"qrels scenario {normalized_scenario_id} must list case ids")
            continue
        scenario_case_ids = tuple(
            str(case_id).strip() for case_id in raw_case_ids if str(case_id).strip()
        )
        if not scenario_case_ids:
            issues.append(f"qrels scenario {normalized_scenario_id} has no cases")
            continue
        missing_case_ids = sorted(set(scenario_case_ids) - case_ids)
        if missing_case_ids:
            issues.append(
                f"qrels scenario {normalized_scenario_id} references missing cases: "
                + ", ".join(missing_case_ids)
            )
            continue
        scenarios.add(normalized_scenario_id)
    return scenarios, tuple(issues)


def _repo_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[4]


__all__ = [
    "build_qdrant_client",
    "document_units_sha256_by_key",
    "embedding_cache_enabled",
    "is_mock_qdrant_client",
    "read_collection_points_count",
    "read_qdrant_upsert_batch_size",
    "release_payload_mismatch_issues",
    "requires_release_retrieval_acceptance",
    "resolve_release_chunk_quality_budget",
    "resolve_release_qrels_coverage_issues",
    "sample_release_payloads",
    "validate_chunk_embedding_runtime_identity",
]
