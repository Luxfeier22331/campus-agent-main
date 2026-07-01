from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutRunState,
    utc_now,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.campus_agent_ingestion_stage_payload import (
    build_registry_record_from_stage_payload,
)
from campus_ingestion_core.models import DocumentRegistryRecord

_CLOSEOUT_READY_STATES = frozenset({CloseoutRunState.VERIFIED, CloseoutRunState.DONE})


@dataclass(frozen=True, slots=True)
class CloseoutRunDocumentRecordPair:
    staged_record: DocumentRegistryRecord
    final_record: DocumentRegistryRecord


def load_verified_closeout_run_document_record_pairs(
    *,
    run_id: str,
    closeout_store: CloseoutStore,
    expected_corpus: str,
    expected_collection: str,
) -> tuple[CloseoutRunDocumentRecordPair, ...]:
    run = closeout_store.get_run(run_id)
    if run is None:
        raise ValueError(f"closeout run not found: {run_id}")
    if (run.corpus, run.collection) != (expected_corpus, expected_collection):
        raise ValueError(
            "closeout run scope does not match requested preparation scope: "
            f"{run.corpus}/{run.collection} vs {expected_corpus}/{expected_collection}"
        )
    if run.state not in _CLOSEOUT_READY_STATES:
        raise ValueError(
            f"closeout run must be verified before chunk validation/preparation: {run_id} ({run.state.value})"
        )
    staged_documents = closeout_store.get_staged_documents(run_id)
    if not staged_documents:
        raise ValueError(f"no staged documents found for closeout run: {run_id}")
    pairs: list[CloseoutRunDocumentRecordPair] = []
    for staged_document in staged_documents:
        staged_record = build_registry_record_from_staged_document(
            staged_document,
            artifact_source="staged",
        )
        final_record = build_registry_record_from_staged_document(
            staged_document,
            artifact_source="final",
        )
        if (staged_record.corpus, staged_record.collection) != (
            expected_corpus,
            expected_collection,
        ):
            raise ValueError(
                "staged document scope does not match requested preparation scope: "
                f"{staged_record.document_id} -> {staged_record.corpus}/{staged_record.collection}"
            )
        pairs.append(
            CloseoutRunDocumentRecordPair(
                staged_record=staged_record,
                final_record=final_record,
            )
        )
    return tuple(sorted(pairs, key=lambda item: _record_key(item.final_record)))


def build_registry_record_from_staged_document(
    staged_document: dict[str, Any],
    *,
    artifact_source: Literal["staged", "final"] = "final",
) -> DocumentRegistryRecord:
    return build_registry_record_from_stage_payload(
        staged_document,
        artifact_source=artifact_source,
        timestamp=utc_now(),
    )


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str, str]:
    return (record.document_id, record.revision_track, record.version_id)


__all__ = [
    "CloseoutRunDocumentRecordPair",
    "build_registry_record_from_staged_document",
    "load_verified_closeout_run_document_record_pairs",
]
