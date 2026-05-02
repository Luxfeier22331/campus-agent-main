from __future__ import annotations

import copy
import json
import unittest

from campus_ingestion_core.collected_notice_regulation_first_batch_documents import (
    build_document_import_input,
)
from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    FIRST_BATCH_SELECTION_SCHEMA_VERSION,
    PHASE_09_ID,
    build_first_batch_regulation_selection,
    harden_first_batch_regulation_registry_provenance,
    materialize_first_batch_regulation_selection,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


class CollectedNoticeRegulationFirstBatchPromotionTests(unittest.TestCase):
    def test_scoped_rule_document_units_split_non_article_chinese_heading_structure(
        self,
    ) -> None:
        document = _target_document(
            source_notice_id="620",
            collection="scoped_rules",
            canonical_markdown=(
                "# 测试规章 620\n\n"
                "一、招募对象\n\n"
                "申请者须符合学校研究生支教团选拔条件，并按要求提交材料。\n\n"
                "（一）报名条件\n\n"
                "申请者应具有良好政治素质、学业成绩和志愿服务经历。\n\n"
                "（二）选拔程序\n\n"
                "学院完成资格审查后，学校统一组织面试并公示结果。\n\n"
                "二、组织管理\n\n"
                "入选成员应按学校统一安排完成培训、派遣和服务期管理。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        body_rows = [row for row in rows if row["unit_type"] == "scoped_rule_body"]
        self.assertGreaterEqual(len(body_rows), 5)
        top_heading = next(row for row in body_rows if row["clean_text"] == "一、招募对象")
        self.assertEqual(top_heading["row_type"], "heading")
        self.assertFalse(top_heading["metadata"]["is_answer_bearing"])
        self.assertEqual(top_heading["metadata"]["section_path"], ["一、招募对象"])
        subsection_heading = next(row for row in body_rows if row["clean_text"] == "（一）报名条件")
        self.assertEqual(
            subsection_heading["metadata"]["section_path"],
            ["一、招募对象", "（一）报名条件"],
        )
        self.assertTrue(
            any(
                row["clean_text"] == "申请者应具有良好政治素质、学业成绩和志愿服务经历。"
                and row["metadata"]["section_path"] == ["一、招募对象", "（一）报名条件"]
                for row in body_rows
            )
        )
        self.assertFalse(
            any(
                row["metadata"]["is_answer_bearing"]
                and row["metadata"]["section_path"] == [row["clean_text"]]
                for row in body_rows
            )
        )

    def test_selection_requires_downstream_ready_candidates_and_passed_consistency(self) -> None:
        selection = build_first_batch_regulation_selection(
            candidate_audit=_candidate_audit(),
            consistency_report=_consistency_report(),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            selected_notice_ids=("594", "620"),
            generated_at="2026-04-30T00:00:00+00:00",
        )

        self.assertEqual(selection["schema_version"], FIRST_BATCH_SELECTION_SCHEMA_VERSION)
        self.assertEqual(selection["phase"], PHASE_09_ID)
        self.assertEqual(selection["selected_notice_ids"], ["594", "620"])
        self.assertEqual(selection["selected_count"], 2)
        self.assertEqual(
            selection["selected_counts_by_collection"],
            {"institutional_rules": 1, "scoped_rules": 1},
        )
        self.assertEqual(
            selection["blocked_counts"],
            {"manual_review": 1, "needs_multimodal": 1},
        )
        self.assertFalse(selection["query_serving_opened"])
        self.assertFalse(selection["rag_release_opened"])

    def test_selection_rejects_unadmitted_or_not_ready_selected_candidate(self) -> None:
        candidate_audit = _candidate_audit()
        candidate_audit["candidates"][0]["owner_text_status"] = "not_ready"

        with self.assertRaisesRegex(ValueError, "owner_text_status=ready"):
            build_first_batch_regulation_selection(
                candidate_audit=candidate_audit,
                consistency_report=_consistency_report(),
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

    def test_selection_rejects_failed_consistency_or_open_serving_report(self) -> None:
        consistency = _consistency_report()
        consistency["verdict"] = "failed"

        with self.assertRaisesRegex(ValueError, "consistency report verdict must be passed"):
            build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=consistency,
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        institutional["query_serving_enabled"] = True

        with self.assertRaisesRegex(ValueError, "query serving must stay closed"):
            build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=institutional,
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

    def test_dry_run_materialization_does_not_write_registry_or_object_store(self) -> None:
        registry = InMemoryDocumentRegistry((_existing_scoped_rule_record(),))
        object_store = _FakeObjectStore(_source_ref_objects())

        report = materialize_first_batch_regulation_selection(
            selection=build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            ),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(),
            object_store=object_store,
            execute=False,
            env=_object_store_env(),
        )

        self.assertEqual(report["mode"], "dry_run")
        self.assertFalse(report["write_enabled"])
        self.assertEqual(len(registry.list_by_scope("regulations", "institutional_rules")), 0)
        self.assertEqual(len(registry.list_by_scope("regulations", "scoped_rules")), 1)
        self.assertEqual(object_store.puts, [])

    def test_execute_writes_selected_documents_and_preserves_unselected_existing_rows(self) -> None:
        registry = InMemoryDocumentRegistry((_existing_scoped_rule_record(),))
        object_store = _FakeObjectStore(_source_ref_objects())
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        report = materialize_first_batch_regulation_selection(
            selection=build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                selected_notice_ids=("594", "620"),
            ),
            institutional_materialization=institutional,
            scoped_materialization=scoped,
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(),
            object_store=object_store,
            execute=True,
            env=_object_store_env(),
        )

        self.assertEqual(report["mode"], "execute")
        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["materialized_document_count"], 2)
        self.assertEqual(
            report["target_scope_postflight_document_counts"],
            {
                "regulations/institutional_rules": 1,
                "regulations/scoped_rules": 2,
            },
        )
        self.assertEqual(
            {
                record.document_id
                for record in registry.list_by_scope("regulations", "scoped_rules")
            },
            {
                "existing:scoped-rule",
                "institutional_regulation:muc:620",
            },
        )
        selected_record = registry.list_by_scope("regulations", "institutional_rules")[0]
        self.assertEqual(selected_record.source_channel, "authenticated_notice_portal")
        self.assertEqual(
            selected_record.import_source,
            "collected_notice_regulation_first_batch_promotion",
        )
        self.assertEqual(selected_record.source_uri, "https://my.muc.edu.cn/file/594.pdf")
        self.assertEqual(len(selected_record.source_observations), 1)
        self.assertEqual(
            selected_record.source_observations[0].source_channel,
            "authenticated_notice_portal",
        )
        rows = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=selected_record.document_units_object_key or "",
        )
        first_row = json.loads(rows.decode("utf-8").splitlines()[0])
        self.assertEqual(first_row["metadata"]["source_notice_ids"], ["594"])
        self.assertEqual(
            first_row["metadata"]["normalizer_version"],
            "collected_notice_regulation_canonical_cleaning_v2",
        )
        self.assertEqual(
            first_row["metadata"]["cleaning_policy_version"],
            "institutional_rules_cleaning_v1",
        )
        self.assertEqual(
            first_row["metadata"]["normalization_quality"]["quality_verdict"],
            "passed",
        )
        by_document_id = {
            item["target_document_id"]: item for item in report["materialized_documents"]
        }
        materialized = by_document_id["institutional_regulation:muc:594"]
        self.assertEqual(materialized["normalization_quality"]["quality_verdict"], "passed")
        self.assertEqual(
            materialized["canonical_markdown_object_key"],
            selected_record.canonical_markdown_object_key,
        )
        self.assertEqual(
            materialized["document_units_object_key"],
            selected_record.document_units_object_key,
        )
        self.assertEqual(len(materialized["canonical_markdown_sha256"]), 64)
        self.assertEqual(len(materialized["document_units_sha256"]), 64)
        self.assertFalse(report["query_serving_opened"])
        self.assertFalse(report["rag_release_opened"])

        scoped_record = registry.current_version(
            "institutional_regulation:muc:620",
            preferred_revision_tracks=("current-effective",),
        )
        self.assertIsNotNone(scoped_record)
        scoped_rows = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=scoped_record.document_units_object_key or "",
        )
        scoped_first_row = json.loads(scoped_rows.decode("utf-8").splitlines()[0])
        self.assertEqual(
            scoped_first_row["metadata"]["source_notice_release_time"],
            "2024-11-16 18:58:28",
        )

    def test_execute_rejects_selected_document_without_passed_normalization_quality(self) -> None:
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[
                _target_document(
                    source_notice_id="594",
                    collection="institutional_rules",
                    quality_verdict="flagged_manual_review",
                )
            ],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        with self.assertRaisesRegex(ValueError, "normalization quality must be passed"):
            materialize_first_batch_regulation_selection(
                selection=build_first_batch_regulation_selection(
                    candidate_audit=_candidate_audit(),
                    consistency_report=_consistency_report(),
                    institutional_materialization=institutional,
                    scoped_materialization=scoped,
                    selected_notice_ids=("594", "620"),
                ),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store=_FakeObjectStore(_source_ref_objects()),
                execute=True,
                env=_object_store_env(),
            )

    def test_execute_rejects_unexpected_existing_target_id_collision(self) -> None:
        registry = InMemoryDocumentRegistry(
            (
                _existing_scoped_rule_record(
                    document_id="institutional_regulation:muc:620",
                    units_key="regulations/documents/scoped_rules/colliding/document-units.jsonl",
                ),
            )
        )
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        with self.assertRaisesRegex(ValueError, "unexpected existing target collision"):
            materialize_first_batch_regulation_selection(
                selection=build_first_batch_regulation_selection(
                    candidate_audit=_candidate_audit(),
                    consistency_report=_consistency_report(),
                    institutional_materialization=institutional,
                    scoped_materialization=scoped,
                    selected_notice_ids=("594", "620"),
                ),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                registry=registry,
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store=_FakeObjectStore(_source_ref_objects()),
                execute=True,
                env=_object_store_env(),
            )

    def test_provenance_hardening_updates_existing_selected_records(self) -> None:
        selection = build_first_batch_regulation_selection(
            candidate_audit=_candidate_audit(),
            consistency_report=_consistency_report(),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            selected_notice_ids=("594", "620"),
        )
        registry = InMemoryDocumentRegistry(
            (
                _existing_regulation_record(
                    document_id="institutional_regulation:muc:594",
                    collection="institutional_rules",
                ),
                _existing_regulation_record(
                    document_id="institutional_regulation:muc:620",
                    collection="scoped_rules",
                ),
            )
        )

        report = harden_first_batch_regulation_registry_provenance(
            selection=selection,
            registry=registry,
            execute=True,
            generated_at="2026-04-30T00:00:00+00:00",
        )

        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["updated_record_count"], 2)
        updated = registry.latest_versions(
            "institutional_regulation:muc:594",
            revision_track="current-effective",
        )[0]
        self.assertEqual(updated.source_channel, "authenticated_notice_portal")
        self.assertEqual(updated.source_uri, "https://my.muc.edu.cn/file/594.pdf")
        self.assertEqual(
            [observation.source_channel for observation in updated.source_observations],
            ["authenticated_notice_portal", "manual_curated"],
        )
        rerun_report = harden_first_batch_regulation_registry_provenance(
            selection=selection,
            registry=registry,
            execute=False,
            generated_at="2026-04-30T00:01:00+00:00",
        )

        self.assertEqual(rerun_report["candidate_update_count"], 0)
        self.assertEqual(rerun_report["updated_target_document_ids"], [])
        self.assertEqual(
            rerun_report["unchanged_target_document_ids"],
            [
                "institutional_regulation:muc:594",
                "institutional_regulation:muc:620",
            ],
        )


def _candidate_audit() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_candidate_audit.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "candidates": [
            _candidate("594", "institutional_rules", "institutional_rules_candidate"),
            _candidate("620", "scoped_rules", "scoped_rules_candidate"),
            {
                **_candidate("477", None, "needs_multimodal"),
                "consumption_class": "needs_multimodal",
                "owner_text_status": "not_ready",
            },
            {
                **_candidate("481", None, "manual_review"),
                "consumption_class": "defer",
            },
        ],
        "class_counts": {
            "institutional_rules_candidate": 1,
            "scoped_rules_candidate": 1,
            "needs_multimodal": 1,
            "manual_review": 1,
        },
    }


def _candidate(
    source_notice_id: str,
    target_collection: str | None,
    regulation_class: str,
) -> dict[str, object]:
    return {
        "source_notice_id": source_notice_id,
        "source_document_id": f"file-release:muc_internal_portal:{source_notice_id}",
        "source_url": f"https://my.muc.edu.cn/file/{source_notice_id}.pdf",
        "source_object_refs": [_source_ref(source_notice_id, "released_file")],
        "title": f"测试规章 {source_notice_id}",
        "regulation_title_normalized": f"测试规章 {source_notice_id}",
        "issuing_org": "中央民族大学",
        "consumption_class": "downstream_admitted",
        "regulation_admission_class": regulation_class,
        "target_collection": target_collection,
        "target_identity_preview": (
            f"institutional_regulation:muc:{source_notice_id}" if target_collection else None
        ),
        "owner_text_status": "ready",
        "owner_text_recovery": {
            "written_refs": {"searchable_merge_input": _source_ref(source_notice_id, "owner_text")}
        },
    }


def _consistency_report() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_materialization_consistency.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "verdict": "passed",
        "failure_reason_codes": [],
        "counts": {
            "downstream_admitted": 2,
            "institutional_rules_document_count": 1,
            "scoped_rules_document_count": 1,
            "skipped_not_admitted": 2,
            "duplicate_target_document_id_count": 0,
            "normalization_failed_document_count": 0,
            "normalization_flagged_document_count": 0,
        },
    }


def _materialization_report(
    *,
    target_collection: str,
    documents: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_materialization_preview.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "release_publish_enabled": False,
        "query_serving_enabled": False,
        "target": "regulation",
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}",
        "document_count": len(documents),
        "documents": documents,
    }


def _target_document(
    *,
    source_notice_id: str,
    collection: str,
    quality_verdict: str = "passed",
    canonical_markdown: str | None = None,
) -> dict[str, object]:
    title = f"测试规章 {source_notice_id}"
    content_role_prefix = "regulation" if collection == "institutional_rules" else "scoped_rule"
    return {
        "schema_version": "collected_notice_regulation_target_document_preview.v1",
        "target": "regulation",
        "target_collection": collection,
        "target_surface": f"regulations/{collection}",
        "target_document_id": f"institutional_regulation:muc:{source_notice_id}",
        "target_identity_preview": f"institutional_regulation:muc:{source_notice_id}",
        "candidate_key": f"candidate:{source_notice_id}",
        "title": title,
        "issuing_org": "中央民族大学",
        "canonical_markdown": canonical_markdown
        or f"# {title}\n\n第一条 为测试第一批规章提升，制定本办法。\n\n第二条 本办法用于验证 selected write gate。\n",
        "normalization_quality": {
            "target_collection": collection,
            "target_document_id": f"institutional_regulation:muc:{source_notice_id}",
            "source_notice_ids": [source_notice_id],
            "title": title,
            "wrapper_removed": True,
            "suspicious_prefix": False,
            "title_occurrence_count": 2,
            "chapter_count": 0,
            "article_count": 2,
            "page_artifact_count": 0,
            "unit_count": 2,
            "soft_wrap_repair_count": 0,
            "soft_wrap_residue_count": 0,
            "readability_normalization_count": 0,
            "normalizer_version": "collected_notice_regulation_canonical_cleaning_v2",
            "quality_verdict": quality_verdict,
            "reason_codes": [] if quality_verdict == "passed" else ["soft_wrap_residue"],
        },
        "source_notice_ids": [source_notice_id],
        "source_notice_release_time": "2024-11-16 18:58:28",
        "source_document_ids": [f"file-release:muc_internal_portal:{source_notice_id}"],
        "source_urls": [f"https://my.muc.edu.cn/file/{source_notice_id}.pdf"],
        "source_scope": {
            "source_channel": "authenticated_notice_portal",
            "source_surface": "file_release",
            "source_corpus": "authenticated_documents",
            "source_collection": "file_release_source",
        },
        "source_object_refs": [_source_ref(source_notice_id, "released_file")],
        "owner_text_recovery": {
            "written_refs": {"searchable_merge_input": _source_ref(source_notice_id, "owner_text")}
        },
        "no_write_boundary": {
            "db_writes_enabled": False,
            "object_store_writes_enabled": False,
            "release_publish_enabled": False,
            "query_serving_enabled": False,
        },
        "test_content_role_prefix": content_role_prefix,
    }


def _source_ref(source_notice_id: str, role: str) -> dict[str, object]:
    return {
        "bucket": "campus-rag-source",
        "key": f"source/{source_notice_id}/{role}.json",
        "role": role,
    }


def _source_ref_objects() -> dict[tuple[str, str], bytes]:
    objects: dict[tuple[str, str], bytes] = {}
    for notice_id in ("594", "620"):
        for role in ("released_file", "owner_text"):
            ref = _source_ref(notice_id, role)
            objects[(str(ref["bucket"]), str(ref["key"]))] = b"{}"
    return objects


def _existing_scoped_rule_record(
    *,
    document_id: str = "existing:scoped-rule",
    units_key: str = "regulations/documents/scoped_rules/existing/document-units.jsonl",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id="sha256:existing",
        source_uri="campusrag://existing/scoped-rule",
        content_hash="sha256:existing",
        corpus="regulations",
        collection="scoped_rules",
        cleaning_policy_version="scoped_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="collected_notice_regulation_first_batch_promotion_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="test",
    )


def _existing_regulation_record(
    *,
    document_id: str,
    collection: str,
) -> DocumentRegistryRecord:
    units_key = f"regulations/documents/{collection}/existing/document-units.jsonl"
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id="sha256:existing",
        source_uri="campusrag://manual/regulation",
        content_hash="sha256:existing",
        corpus="regulations",
        collection=collection,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="collected_notice_regulation_first_batch_promotion_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="test",
    )


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_MODEL": "mock-embedding-8d",
    }


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = copy.deepcopy(objects or {})
        self.puts: list[tuple[str, str, bytes, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key, data, content_type))


if __name__ == "__main__":
    unittest.main()
