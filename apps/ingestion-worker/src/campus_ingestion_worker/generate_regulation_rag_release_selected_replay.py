from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.regulation_rag_release_lane import (
    InMemoryRegulationRagReleaseCandidateStore,
    RagReleaseCandidate,
    RagReleaseExecutionResult,
    build_operator_rag_release_status,
    build_selected_search_only_rag_release_candidate,
    enqueue_regulation_rag_release_candidates_for_records,
    process_pending_regulation_rag_release_candidates,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
PHASE_EVIDENCE_DIR = (
    REPO_ROOT / "var/ingestion-evidence/regulation-rag-release-lane/phase-06-canary-cohort-closeout"
)
DEFAULT_OUTPUT_PATH = PHASE_EVIDENCE_DIR / "selected-replay-dry-run.json"
EVAL_FIXTURES_ROOT = REPO_ROOT / "packages/evals/fixtures"
DEFAULT_CANARY_STATUS_PATH = (
    EVAL_FIXTURES_ROOT / "regulation_rag_release_phase06_canary_status.v1.json"
)
DEFAULT_SCOPED_RECORDS_PATH = (
    EVAL_FIXTURES_ROOT / "regulation_rag_release_phase06_selected_scoped_records.v1.json"
)
DEFAULT_GENERATED_AT = "2026-05-02T01:00:00+00:00"
SELECTED_NOTICE_IDS = ("355282", "351907", "186977", "351699", "187233")


def build_selected_replay_dry_run(
    *,
    generated_at: str = DEFAULT_GENERATED_AT,
    canary_status_path: Path = DEFAULT_CANARY_STATUS_PATH,
    selected_scoped_records_path: Path = DEFAULT_SCOPED_RECORDS_PATH,
) -> dict[str, Any]:
    canary_summary = _read_canary_status(canary_status_path)
    selected_scoped_records = _read_selected_scoped_records(selected_scoped_records_path)
    canary_by_notice_id = {
        str(item["source_notice_id"]): item for item in canary_summary.get("canaries") or []
    }
    excluded_by_notice_id = {
        str(item["source_notice_id"]): item
        for item in canary_summary.get("excluded_canary_notes") or []
    }
    institutional_profile = load_runtime_profile("regulations", "institutional_rules")
    scoped_profile = load_runtime_profile("regulations", "scoped_rules")

    store = InMemoryRegulationRagReleaseCandidateStore()
    replayed_at = _parse_datetime(generated_at)

    institutional_record = _build_current_institutional_record(
        profile=institutional_profile,
        generated_at=generated_at,
        selected_records=selected_scoped_records,
    )
    scoped_records = {
        notice_id: _load_scoped_record(notice_id, selected_scoped_records=selected_scoped_records)
        for notice_id in ("351907", "186977")
    }
    document_id_to_notice_id = {
        institutional_record.document_id: "355282",
        scoped_records["351907"].document_id: "351907",
        scoped_records["186977"].document_id: "186977",
    }

    enqueue_regulation_rag_release_candidates_for_records(
        store=store,
        records=(institutional_record,),
        runtime_profile=institutional_profile,
        now=replayed_at,
    )
    enqueue_regulation_rag_release_candidates_for_records(
        store=store,
        records=tuple(scoped_records.values()),
        runtime_profile=scoped_profile,
        now=replayed_at,
    )
    for scoped_record in scoped_records.values():
        store.upsert_candidate(
            build_selected_search_only_rag_release_candidate(
                record=scoped_record,
                runtime_profile=scoped_profile,
                now=replayed_at,
                message="selected non-current scoped rule is retained for search-only evidence and is not query-enabled by default",
            )
        )

    release_executor_called: list[str] = []

    def release_executor(candidate: RagReleaseCandidate) -> RagReleaseExecutionResult:
        release_executor_called.append(candidate.document_id)
        return RagReleaseExecutionResult(
            status="passed",
            release_id=f"dry-run-release-{document_id_to_notice_id[candidate.document_id]}",
            verification_status="passed",
            release_admission_status="passed",
            release_admission_manifest_key="dry-run-release-admission.json",
        )

    process_pending_regulation_rag_release_candidates(
        store=store,
        release_executor=release_executor,
        now=replayed_at,
    )

    candidates_by_notice_id = {
        document_id_to_notice_id[candidate.document_id]: candidate
        for candidate in store.list_candidates()
    }
    notices = [
        _notice_result(
            notice_id="355282",
            canary=canary_by_notice_id["355282"],
            candidate=candidates_by_notice_id.get("355282"),
            selected_record_source="retrieval_eval_manifest",
            registry_delta_behavior="would_enqueue_current_version",
            release_executor_called=institutional_record.document_id in release_executor_called,
        ),
        _notice_result(
            notice_id="351907",
            canary=canary_by_notice_id["351907"],
            candidate=candidates_by_notice_id.get("351907"),
            selected_record_source=str(selected_scoped_records_path.relative_to(REPO_ROOT)),
            registry_delta_behavior="no_candidate_current_version_absent",
            release_executor_called=scoped_records["351907"].document_id in release_executor_called,
        ),
        _notice_result(
            notice_id="186977",
            canary=canary_by_notice_id["186977"],
            candidate=candidates_by_notice_id.get("186977"),
            selected_record_source=str(selected_scoped_records_path.relative_to(REPO_ROOT)),
            registry_delta_behavior="no_candidate_current_version_absent",
            release_executor_called=scoped_records["186977"].document_id in release_executor_called,
        ),
        {
            "source_notice_id": "351699",
            "title": canary_by_notice_id["351699"]["title"],
            "canary_class": canary_by_notice_id["351699"]["canary_class"],
            "target_collection": None,
            "selected_record_source": str(selected_scoped_records_path.relative_to(REPO_ROOT)),
            "candidate_status": "no_candidate",
            "ragServingStatus": "not_applicable",
            "registry_delta_behavior": "no_regulation_target_record",
            "reason": "source-truth notice row exists, but no regulations/* target is materialized",
        },
        {
            "source_notice_id": "187233",
            "title": excluded_by_notice_id["187233"]["title"],
            "canary_class": "excluded_current_institutional_rule",
            "target_collection": "regulations/institutional_rules",
            "candidate_status": "excluded_owner_body_recovery_required",
            "ragServingStatus": "not_applicable",
            "registry_delta_behavior": "excluded_before_candidate_enqueue",
            "reason": excluded_by_notice_id["187233"]["reason"],
            "expected_handling": excluded_by_notice_id["187233"]["expected_handling"],
        },
    ]

    return {
        "schema_version": "regulation_rag_release_selected_replay_dry_run_v1",
        "workstream": "regulation-rag-release-lane",
        "phase": "phase-06-canary-cohort-closeout",
        "generated_at": generated_at,
        "write_enabled": False,
        "replay_mode": "local_selected_record_dry_run",
        "candidate_store": "in_memory",
        "selected_notice_ids": list(SELECTED_NOTICE_IDS),
        "counts": {
            "selected_notice_count": len(SELECTED_NOTICE_IDS),
            "candidate_count": len(store.list_candidates()),
            "serving_published_count": sum(
                1
                for candidate in store.list_candidates()
                if candidate.status == "serving_published"
            ),
            "held_search_only_count": sum(
                1 for candidate in store.list_candidates() if candidate.status == "held_search_only"
            ),
            "no_candidate_count": sum(
                1 for item in notices if item["candidate_status"] == "no_candidate"
            ),
            "excluded_count": sum(
                1 for item in notices if str(item["candidate_status"]).startswith("excluded_")
            ),
        },
        "runtime_profiles": {
            "institutional_rules": _runtime_profile_summary(institutional_profile),
            "scoped_rules": _runtime_profile_summary(scoped_profile),
        },
        "notices": notices,
        "candidates": [
            _candidate_summary(candidate)
            for candidate in sorted(store.list_candidates(), key=lambda item: item.document_id)
        ],
        "production_replay": {
            "attempted": False,
            "reason": "required Postgres/object-store/embedding runtime env was not available in this local session",
        },
    }


def write_selected_replay_dry_run(
    *,
    output_path: Path = DEFAULT_OUTPUT_PATH,
    generated_at: str = DEFAULT_GENERATED_AT,
    canary_status_path: Path = DEFAULT_CANARY_STATUS_PATH,
    selected_scoped_records_path: Path = DEFAULT_SCOPED_RECORDS_PATH,
) -> Path:
    payload = build_selected_replay_dry_run(
        generated_at=generated_at,
        canary_status_path=canary_status_path,
        selected_scoped_records_path=selected_scoped_records_path,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def _notice_result(
    *,
    notice_id: str,
    canary: dict[str, Any],
    candidate: RagReleaseCandidate | None,
    selected_record_source: str,
    registry_delta_behavior: str,
    release_executor_called: bool,
) -> dict[str, Any]:
    if candidate is None:
        raise RuntimeError(f"missing replay candidate for notice {notice_id}")
    return {
        "source_notice_id": notice_id,
        "title": canary["title"],
        "canary_class": canary["canary_class"],
        "target_collection": f"{candidate.corpus}/{candidate.collection}",
        "selected_record_source": selected_record_source,
        "document_id": candidate.document_id,
        "revision_track": candidate.revision_track,
        "version_id": candidate.version_id,
        "is_current": candidate.is_current,
        "document_status": candidate.document_status,
        "candidate_status": candidate.status,
        "cleanup_disposition": candidate.cleanup_disposition,
        "release_executor_called": release_executor_called,
        "registry_delta_behavior": registry_delta_behavior,
        **build_operator_rag_release_status(candidate),
    }


def _candidate_summary(candidate: RagReleaseCandidate) -> dict[str, Any]:
    payload = asdict(candidate)
    return {
        key: payload[key]
        for key in (
            "candidate_id",
            "document_id",
            "revision_track",
            "version_id",
            "corpus",
            "collection",
            "status",
            "candidate_reason",
            "cleanup_disposition",
            "is_current",
            "document_status",
            "query_enabled_by_default",
            "ragPreparationStatus",
            "ragIndexStatus",
            "ragServingStatus",
            "ragVerificationStatus",
            "last_release_id",
        )
    }


def _build_current_institutional_record(
    *,
    profile: CollectionRuntimeProfile,
    generated_at: str,
    selected_records: Mapping[str, Any],
) -> DocumentRegistryRecord:
    document = selected_records.get("institutional_record")
    if not isinstance(document, Mapping):
        raise ValueError("institutional_record is required")
    if document.get("corpus") != "regulations" or document.get("collection") != (
        "institutional_rules"
    ):
        raise ValueError("institutional_record has unexpected collection")
    if "355282" not in str(document.get("source_uri") or ""):
        raise ValueError("institutional_record source_uri must reference notice 355282")
    return DocumentRegistryRecord(
        document_id=document["document_id"],
        revision_track=document["revision_track"],
        version_id=document["version_id"],
        source_uri=document["source_uri"],
        content_hash=document["content_hash"],
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version=document.get("cleaning_policy_version")
        or profile.cleaning_policy_version,
        entitlement_groups=tuple(str(item) for item in document.get("entitlement_groups") or ()),
        visibility_scope=document.get("visibility_scope"),
        visibility_level=document.get("visibility_level") or "restricted",
        status=document["status"],
        ingestion_timestamp=generated_at,
        parser_version=document["parser_version"],
        embedding_model=document["embedding_model"],
        source_channel=document["source_channel"],
        is_current=bool(document.get("is_current")),
        published_date=document.get("published_date"),
        document_units_object_key=document.get("document_units_object_key"),
        import_source=document["import_source"],
    )


def _load_scoped_record(
    notice_id: str,
    *,
    selected_scoped_records: Mapping[str, Any],
) -> DocumentRegistryRecord:
    records_by_notice_id = selected_scoped_records["records_by_notice_id"]
    if not isinstance(records_by_notice_id, Mapping):
        raise ValueError("records_by_notice_id is required")
    record_payload = records_by_notice_id.get(notice_id)
    if not isinstance(record_payload, Mapping):
        raise ValueError(f"selected scoped record is missing for notice {notice_id}")
    if record_payload.get("corpus") != "regulations" or record_payload.get("collection") != (
        "scoped_rules"
    ):
        raise ValueError(f"selected scoped record has unexpected collection for notice {notice_id}")
    if f"notice:muc_internal_portal:{notice_id}" not in str(record_payload.get("source_uri") or ""):
        raise ValueError(f"selected scoped record source_uri does not match notice {notice_id}")
    return DocumentRegistryRecord(
        document_id=record_payload["document_id"],
        revision_track=record_payload["revision_track"],
        version_id=record_payload["version_id"],
        source_uri=record_payload["source_uri"],
        content_hash=record_payload["content_hash"],
        corpus=record_payload["corpus"],
        collection=record_payload["collection"],
        cleaning_policy_version=record_payload["cleaning_policy_version"],
        entitlement_groups=tuple(
            str(item) for item in record_payload.get("entitlement_groups") or ()
        ),
        visibility_scope=record_payload.get("visibility_scope"),
        visibility_level=record_payload.get("visibility_level") or "restricted",
        status=record_payload["status"],
        ingestion_timestamp=record_payload["ingestion_timestamp"],
        parser_version=record_payload["parser_version"],
        embedding_model=record_payload["embedding_model"],
        source_channel=record_payload["source_channel"],
        is_current=bool(record_payload.get("is_current")),
        effective_date=record_payload.get("effective_date"),
        published_date=record_payload.get("published_date"),
        document_units_object_key=record_payload.get("document_units_object_key"),
        canonical_markdown_object_key=record_payload.get("canonical_markdown_object_key"),
        processed_object_keys=tuple(
            str(item) for item in record_payload.get("processed_object_keys") or ()
        ),
        import_source=record_payload["import_source"],
    )


def _runtime_profile_summary(profile: CollectionRuntimeProfile) -> dict[str, Any]:
    return {
        "corpus": profile.corpus,
        "collection": profile.collection,
        "retrieval_enabled": profile.retrieval_enabled,
        "query_enabled_by_default": profile.query_enabled_by_default,
        "current_only": profile.current_only,
        "serving_revision_tracks": list(profile.serving_revision_tracks),
        "chunk_profile_version": profile.chunk_profile_version,
        "cleaning_policy_version": profile.cleaning_policy_version,
    }


def _read_canary_status(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    if not isinstance(payload, dict):
        raise ValueError("canary status fixture must be a JSON object")
    if payload.get("schema_version") != "regulation_rag_release_canary_status_summary_v1":
        raise ValueError("unsupported canary status fixture schema_version")
    return payload


def _read_selected_scoped_records(path: Path) -> dict[str, Any]:
    payload = _read_json(path)
    if not isinstance(payload, dict):
        raise ValueError("selected scoped records fixture must be a JSON object")
    if payload.get("schema_version") != "regulation_rag_release_selected_scoped_records_v1":
        raise ValueError("unsupported selected scoped records fixture schema_version")
    return payload


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate local selected canary replay evidence for regulation RAG release lane.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Path to write selected-replay-dry-run.json.",
    )
    parser.add_argument(
        "--generated-at",
        default=DEFAULT_GENERATED_AT,
        help="ISO timestamp used for deterministic replay timestamps.",
    )
    parser.add_argument(
        "--canary-status-path",
        type=Path,
        default=DEFAULT_CANARY_STATUS_PATH,
        help="Phase 6 canary status fixture path.",
    )
    parser.add_argument(
        "--selected-scoped-records-path",
        type=Path,
        default=DEFAULT_SCOPED_RECORDS_PATH,
        help="Phase 6 selected scoped records fixture path.",
    )
    args = parser.parse_args(argv)
    output_path = write_selected_replay_dry_run(
        output_path=args.output,
        generated_at=args.generated_at,
        canary_status_path=args.canary_status_path,
        selected_scoped_records_path=args.selected_scoped_records_path,
    )
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
