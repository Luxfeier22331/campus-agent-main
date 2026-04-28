from __future__ import annotations

import unittest
from dataclasses import replace

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
)
from campus_ingestion_core.internal_notice_regulation_owner_recovery import (
    build_internal_notice_regulation_owner_recovery_report,
)
from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    InternalNoticeSelectedRegulationCohortAuditReport,
    InternalNoticeSelectedRegulationCohortAuditRow,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.ingestion.internal_notice_regulation_promotion_test_support import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryDocumentRegistry,
    _canonical_markdown,
    _FakeObjectStore,
    _inventory_entry,
)


class InternalNoticeRegulationOwnerRecoveryTest(unittest.TestCase):
    def test_recovery_prefers_captured_attachment_over_file_release(self) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory(
                    notice_id="300004",
                    title="关于发布《中央民族大学关于学生使用人工智能的指导意见》的通知",
                    owner_kind="attachment_document",
                    relation_type="attachment_ref",
                    owner_title_hint="中央民族大学关于学生使用人工智能的指导意见",
                    attachment_ref_id="attachment-0001",
                ),
            )
        )
        attachment = _source_record(
            document_id="notice_attachment:muc_internal_portal:300004:attachment-0001",
            source_uri="https://portal.example.edu/notices/300004/attachments/1",
            corpus="campus_notices",
            collection="internal_notice",
            canonical_key="campus_notices/documents/internal_notice/300004/attachment-0001/canonical.md",
            units_key="campus_notices/documents/internal_notice/300004/attachment-0001/document-units.jsonl",
        )
        file_release_store = _file_release_store(
            _file_release_entry(
                file_release_id=646,
                filename="中央民族大学关于学生使用人工智能的指导意见.pdf",
                object_key="file-release/646/source.pdf",
                sha256="sha256:file-release-646",
            )
        )

        report = build_internal_notice_regulation_owner_recovery_report(
            audit_report=_audit_report(
                _audit_row(
                    notice_id="300004",
                    title="关于发布《中央民族大学关于学生使用人工智能的指导意见》的通知",
                    classification="attachment_owner_candidate",
                    stable_reason="attachment_backed_regulation_body_missing",
                )
            ),
            source_truth_inventory_store=inventory_store,
            registry=InMemoryDocumentRegistry((attachment,)),
            object_store=_FakeObjectStore(
                objects={
                    ("campus-rag-derived", attachment.canonical_markdown_object_key): (
                        _canonical_markdown(
                            "# 中央民族大学关于学生使用人工智能的指导意见\n\n"
                            "第一条 为规范学生使用人工智能，制定本指导意见。"
                        )
                    )
                }
            ),
            file_release_inventory_store=file_release_store,
        )

        row = report.rows[0]
        self.assertEqual(report.ready_candidate_notice_ids, ("300004",))
        self.assertEqual(row.status, "ready")
        self.assertEqual(row.selected_source_kind, "captured_attachment")
        self.assertEqual(
            row.selected_source_document_id,
            "notice_attachment:muc_internal_portal:300004:attachment-0001",
        )
        self.assertTrue(row.source_backed_candidate)
        self.assertTrue(row.notice_card_preserved)
        self.assertEqual(
            tuple(attempt.source_kind for attempt in row.attempts),
            ("captured_attachment",),
        )

    def test_recovery_uses_file_release_when_attachment_source_is_missing(self) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory(
                    notice_id="300011",
                    title="关于《中央民族大学差旅费管理办法》发布实施的通知",
                    owner_kind="file_release_document",
                    relation_type="file_release_ref",
                    owner_title_hint="中央民族大学差旅费管理办法",
                ),
            )
        )
        file_release_store = _file_release_store(
            _file_release_entry(
                file_release_id=647,
                filename="中央民族大学差旅费管理办法.pdf",
                object_key="file-release/647/source.pdf",
                sha256="sha256:file-release-647",
            )
        )

        report = build_internal_notice_regulation_owner_recovery_report(
            audit_report=_audit_report(
                _audit_row(
                    notice_id="300011",
                    title="关于《中央民族大学差旅费管理办法》发布实施的通知",
                    classification="file_release_owner_candidate",
                    stable_reason="file_release_backed_regulation_body_missing",
                )
            ),
            source_truth_inventory_store=inventory_store,
            registry=InMemoryDocumentRegistry(()),
            file_release_inventory_store=file_release_store,
        )

        row = report.rows[0]
        self.assertEqual(row.status, "ready")
        self.assertEqual(row.selected_source_kind, "authenticated_file_release")
        self.assertEqual(row.selected_source_document_id, "file_release:muc_internal_portal:647")
        self.assertEqual(row.selected_source_uri, "https://portal.example.edu/files/647/download")
        self.assertEqual(row.attempts[0].reason, "captured_attachment_not_found")
        self.assertEqual(row.attempts[1].evidence["file_release_id"], 647)

    def test_recovery_prefers_official_web_source_over_existing_registry(self) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory(
                    notice_id="300012",
                    title="关于发布《中央民族大学科研经费管理办法》的通知",
                    owner_kind="official_web_document",
                    relation_type="official_web_ref",
                    owner_title_hint="中央民族大学科研经费管理办法",
                ),
            )
        )
        official_record = _source_record(
            document_id="official_web:muc_public_pages:article_detail:research-fund-rule",
            source_uri="https://www.muc.edu.cn/info/research-fund-rule.htm",
            corpus="official_web",
            collection="muc_public_pages",
            canonical_key="official_web/documents/research-fund-rule/canonical.md",
            units_key="official_web/documents/research-fund-rule/document-units.jsonl",
            source_channel="official_web",
        )
        existing_record = _source_record(
            document_id="institutional_regulation:muc:科研经费管理办法:existing",
            source_uri="campusrag://regulations/institutional_rules/research-fund-rule",
            corpus="regulations",
            collection="institutional_rules",
            canonical_key="regulations/documents/institutional_rules/research-fund-rule/canonical.md",
            units_key="regulations/documents/institutional_rules/research-fund-rule/document-units.jsonl",
            source_channel="manual_curated",
        )

        report = build_internal_notice_regulation_owner_recovery_report(
            audit_report=_audit_report(
                _audit_row(
                    notice_id="300012",
                    title="关于发布《中央民族大学科研经费管理办法》的通知",
                    classification="official_web_owner_candidate",
                    stable_reason="official_web_backed_regulation_body_missing",
                )
            ),
            source_truth_inventory_store=inventory_store,
            registry=InMemoryDocumentRegistry((official_record, existing_record)),
            object_store=_FakeObjectStore(
                objects={
                    ("campus-rag-derived", official_record.canonical_markdown_object_key): (
                        _canonical_markdown(
                            "# 中央民族大学科研经费管理办法\n\n"
                            "第一条 为规范科研经费管理，制定本办法。"
                        )
                    ),
                    ("campus-rag-derived", existing_record.canonical_markdown_object_key): (
                        _canonical_markdown(
                            "# 中央民族大学科研经费管理办法\n\n"
                            "第一条 为规范科研经费管理，制定本办法。"
                        )
                    ),
                }
            ),
            file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
        )

        row = report.rows[0]
        self.assertEqual(row.status, "ready")
        self.assertEqual(row.selected_source_kind, "official_web_source")
        self.assertEqual(row.selected_source_document_id, official_record.document_id)
        self.assertEqual(
            tuple(attempt.source_kind for attempt in row.attempts),
            (
                "captured_attachment",
                "authenticated_file_release",
                "official_web_source",
            ),
        )

    def test_recovery_fails_closed_without_owner_source(self) -> None:
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory(
                    notice_id="187233",
                    title="关于修订《中央民族大学采购工作管理办法》的通知",
                    owner_kind="file_release_document",
                    relation_type="file_release_ref",
                    owner_title_hint="中央民族大学采购工作管理办法",
                ),
            )
        )

        report = build_internal_notice_regulation_owner_recovery_report(
            audit_report=_audit_report(
                _audit_row(
                    notice_id="187233",
                    title="关于修订《中央民族大学采购工作管理办法》的通知",
                    classification="file_release_owner_candidate",
                    stable_reason="file_release_backed_regulation_body_missing",
                )
            ),
            source_truth_inventory_store=inventory_store,
            registry=InMemoryDocumentRegistry(()),
            file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
        )

        row = report.rows[0]
        self.assertEqual(report.unresolved_notice_ids, ("187233",))
        self.assertEqual(row.status, "unresolved")
        self.assertEqual(row.reason, "owner_recovery_source_not_found")
        self.assertIsNone(row.selected_source_document_id)
        self.assertFalse(row.source_backed_candidate)
        self.assertFalse(row.import_eligible)
        self.assertTrue(row.notice_card_preserved)


def _inventory(
    *,
    notice_id: str,
    title: str,
    owner_kind: str,
    relation_type: str,
    owner_title_hint: str,
    attachment_ref_id: str | None = None,
):
    entry = _inventory_entry(
        notice_id=notice_id,
        notice_title=title,
        owner_expectations=(
            {
                "owner_expectation_id": f"owner:{notice_id}",
                "owner_kind": owner_kind,
                "relation_type": relation_type,
                "owner_title_hint": owner_title_hint,
                "attachment_ref_id": attachment_ref_id,
            },
        ),
    )
    snapshot = dict(entry.parent_snapshot)
    snapshot["notice_browser_url"] = f"https://portal.example.edu/notices/{notice_id}"
    return replace(entry, parent_snapshot=snapshot)


def _audit_report(*rows: InternalNoticeSelectedRegulationCohortAuditRow):
    return InternalNoticeSelectedRegulationCohortAuditReport(
        source_corpus="campus_notices",
        source_collection="internal_notice",
        requested_notice_ids=tuple(row.notice_id for row in rows),
        selected_notice_ids=tuple(row.notice_id for row in rows),
        missing_projection_notice_ids=(),
        row_count=len(rows),
        classification_counts={row.classification: 1 for row in rows},
        selected_import_notice_ids=(),
        held_notice_ids=tuple(row.notice_id for row in rows),
        rows=rows,
    )


def _audit_row(
    *,
    notice_id: str,
    title: str,
    classification: str,
    stable_reason: str,
) -> InternalNoticeSelectedRegulationCohortAuditRow:
    return InternalNoticeSelectedRegulationCohortAuditRow(
        notice_id=notice_id,
        title=title,
        source_url=f"https://portal.example.edu/notices/{notice_id}",
        notice_release_time="2026-04-10",
        attachment_ref_count=0,
        attachment_document_count=0,
        owner_expectation_count=1,
        owner_expectation_kinds=("file_release_document",),
        target_surfaces=("notice_level_query",),
        consumption_statuses=("retained_for_notice_query",),
        source_document_ids=(f"notice:muc_internal_portal:{notice_id}",),
        classification=classification,
        target_recommendation="owner_recovery",
        stable_reason=stable_reason,
        import_eligible=False,
    )


def _source_record(
    *,
    document_id: str,
    source_uri: str,
    corpus: str,
    collection: str,
    canonical_key: str,
    units_key: str,
    source_channel: str = "authenticated_notice_portal",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{document_id}:source-faithful",
        source_uri=source_uri,
        content_hash=f"sha256:{document_id}",
        corpus=corpus,
        collection=collection,
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-10T00:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel=source_channel,
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(canonical_key, units_key),
        import_source="test",
        published_date="2026-04-10",
    )


def _file_release_store(
    *entries: AuthenticatedNoticeFileReleaseInventoryEntry,
) -> InMemoryAuthenticatedNoticeFileReleaseInventoryStore:
    store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
    store.upsert_many(entries)
    return store


def _file_release_entry(
    *,
    file_release_id: int,
    filename: str,
    object_key: str,
    sha256: str,
) -> AuthenticatedNoticeFileReleaseInventoryEntry:
    return AuthenticatedNoticeFileReleaseInventoryEntry(
        corpus="campus_notices",
        collection="file_release_capture",
        file_release_id=file_release_id,
        site_id="muc_internal_portal",
        export_scope="latest",
        collector_contract_version="authenticated_notice_file_release_export_v1",
        source_home_url="https://portal.example.edu",
        filename=filename,
        upfilename=None,
        filecode=f"CODE-{file_release_id}",
        filetime="2026-04-10",
        filedepartment="学校办公室",
        explain_department=None,
        file_type_id=1,
        file_type_name="制度文件",
        resolved_download_url=f"https://portal.example.edu/files/{file_release_id}/download",
        released_file_storage_provider="object_store",
        released_file_bucket="campus-rag-source",
        released_file_object_key=object_key,
        released_file_sha256=sha256,
        released_file_byte_size=1024,
        released_file_ingest_status="stored",
        released_file_provenance_status="verified",
    )


if __name__ == "__main__":
    unittest.main()
