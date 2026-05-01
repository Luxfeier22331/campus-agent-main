from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.internal_notice_regulation_target_residue_cleanup import (
    InMemoryRegulationTargetResidueObjectStore,
    InMemoryRegulationTargetResidueRegistry,
    InMemoryRegulationTargetResidueVectorIndex,
    RegulationTargetResidueCleanupRequest,
    cleanup_internal_notice_regulation_target_residue,
)


class InternalNoticeRegulationTargetResidueCleanupTest(unittest.TestCase):
    def test_dry_run_backs_up_but_does_not_delete_exact_targets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryRegulationTargetResidueRegistry(
                [
                    {
                        "collection": "scoped_rules",
                        "document_id": "institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
                        "version_id": "sha256:target-version",
                    }
                ]
            )
            object_store = InMemoryRegulationTargetResidueObjectStore(
                {
                    "campus-rag-derived": {
                        "regulations/documents/scoped_rules/药学院2021年硕博连读博士研究生招生实施细则--b398c5cf/source-faithful/2021/canonical.md": b"# historical target\n",
                    }
                }
            )

            report = cleanup_internal_notice_regulation_target_residue(
                request=_request(root, apply=False),
                registry=registry,
                object_store=object_store,
            )

            self.assertFalse(report["apply"])
            self.assertEqual(report["postgres"]["matched_before"], 1)
            self.assertEqual(report["postgres"]["deleted_rows"], [])
            self.assertEqual(report["object_store"]["backed_up_count"], 1)
            self.assertEqual(report["object_store"]["deleted_keys"], [])
            self.assertEqual(report["residue_audit"]["postgres_exact_remaining"], 1)
            self.assertEqual(len(report["residue_audit"]["object_store_exact_keys_remaining"]), 1)
            self.assertTrue((root / "cleanup" / "cleanup-manifest.json").exists())

    def test_apply_deletes_exact_targets_after_backup_and_reports_zero_residue(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryRegulationTargetResidueRegistry(
                [
                    {
                        "collection": "scoped_rules",
                        "document_id": "institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
                        "version_id": "sha256:target-version",
                    },
                    {
                        "collection": "scoped_rules",
                        "document_id": "institutional_regulation:muc:unrelated:keep",
                        "version_id": "sha256:keep",
                    },
                ]
            )
            object_store = InMemoryRegulationTargetResidueObjectStore(
                {
                    "campus-rag-derived": {
                        "regulations/documents/scoped_rules/药学院2021年硕博连读博士研究生招生实施细则--b398c5cf/source-faithful/2021/canonical.md": b"# historical target\n",
                        "regulations/documents/scoped_rules/unrelated/source-faithful/2026/canonical.md": b"# keep\n",
                    }
                }
            )

            report = cleanup_internal_notice_regulation_target_residue(
                request=_request(root, apply=True),
                registry=registry,
                object_store=object_store,
            )

            self.assertTrue(report["apply"])
            self.assertEqual(len(report["postgres"]["deleted_rows"]), 1)
            self.assertEqual(len(report["object_store"]["deleted_keys"]), 1)
            self.assertEqual(report["residue_audit"]["postgres_exact_remaining"], 0)
            self.assertEqual(report["residue_audit"]["object_store_exact_keys_remaining"], [])
            self.assertEqual(report["residue_audit"]["object_store_title_key_matches"], [])
            self.assertEqual(len(registry.rows), 1)
            self.assertTrue(
                object_store.exists(
                    "campus-rag-derived",
                    "regulations/documents/scoped_rules/unrelated/source-faithful/2026/canonical.md",
                )
            )
            manifest = json.loads((root / "cleanup" / "cleanup-manifest.json").read_text())
            self.assertEqual(
                manifest["schema_version"], "internal_notice_regulation_target_residue_cleanup.v1"
            )

    def test_apply_deletes_exact_qdrant_points_after_audit_match(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = InMemoryRegulationTargetResidueRegistry()
            object_store = InMemoryRegulationTargetResidueObjectStore()
            vector_index = InMemoryRegulationTargetResidueVectorIndex(
                {
                    "scoped_rules__r20260501": [
                        {
                            "id": "point-186977",
                            "payload": {
                                "document_id": "institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
                                "source_notice_ids": ["186977"],
                                "target_surface": "regulations/scoped_rules",
                                "version_id": "sha256:target-version",
                            },
                        },
                        {
                            "id": "point-keep",
                            "payload": {
                                "document_id": "institutional_regulation:muc:unrelated:keep",
                                "source_notice_ids": ["999999"],
                                "target_surface": "regulations/scoped_rules",
                                "version_id": "sha256:keep",
                            },
                        },
                    ]
                }
            )

            report = cleanup_internal_notice_regulation_target_residue(
                request=_request(
                    root,
                    apply=True,
                    qdrant_collections=("scoped_rules__r20260501",),
                ),
                registry=registry,
                object_store=object_store,
                vector_index=vector_index,
            )

            self.assertEqual(report["qdrant"]["matched_before"], 1)
            self.assertEqual(report["qdrant"]["deleted_point_ids"], ["point-186977"])
            self.assertEqual(report["residue_audit"]["qdrant_residue_count"], 0)
            self.assertEqual(
                [point["id"] for point in vector_index.collections["scoped_rules__r20260501"]],
                ["point-keep"],
            )


def _request(
    root: Path,
    *,
    apply: bool,
    qdrant_collections: tuple[str, ...] = (),
) -> RegulationTargetResidueCleanupRequest:
    return RegulationTargetResidueCleanupRequest(
        notice_id="186977",
        title="药学院2021年硕博连读博士研究生招生实施细则",
        collection="scoped_rules",
        document_id="institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
        version_id="sha256:target-version",
        bucket="campus-rag-derived",
        qdrant_collections=qdrant_collections,
        target_keys=(
            "regulations/documents/scoped_rules/药学院2021年硕博连读博士研究生招生实施细则--b398c5cf/source-faithful/2021/canonical.md",
        ),
        output_dir=root / "cleanup",
        apply=apply,
    )


if __name__ == "__main__":
    unittest.main()
