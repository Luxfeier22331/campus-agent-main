from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INGESTION_CORE_PACKAGE_ROOT = REPO_ROOT / "packages/ingestion-core"

ACTIVE_SCAN_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "infra",
    REPO_ROOT / "packages",
    REPO_ROOT / "scripts",
    REPO_ROOT / "tests",
)

TEXT_SUFFIXES = {
    ".go",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

ALLOWLISTED_PATHS = {
    Path("tests/infra/test_ingestion_python_clean_target_residue.py"),
    Path("tests/ingestion/test_ingestion_clean_target_boundary.py"),
    Path("tests/ingestion/test_internal_notice_consumption_no_legacy_manual_state.py"),
    Path("tests/ingestion/test_qdrant_native_backup_contract.py"),
    Path("tests/test_workspace_layout.py"),
}

ALLOWLISTED_PREFIXES = (
    ("docs", "decisions"),
    ("docs", "reference", "archive"),
    ("docs", "runbooks", "archive"),
)

WORKER_REF_PATTERN = re.compile(r"campus_ingestion_worker\.[a-zA-Z0-9_]+")

REMOVED_INGESTION_CORE_MODULES = {
    "artifact_keys",
    "artifacts",
    "campus_agent_ingestion_artifacts",
    "campus_agent_ingestion_authorization",
    "chunking",
    "chunking_context",
    "chunking_structure",
    "chunking_tables",
    "chunking_token_windows",
    "chunking_tokenizers",
    "corpus_profiles",
    "curriculum_chunk_units",
    "curriculum_chunk_units_chunking",
    "curriculum_document_units",
    "curriculum_document_units_build",
    "curriculum_document_units_shared",
    "curriculum_title_normalization",
    "document_import_models",
    "handbook_article_structure",
    "handbook_cleanup",
    "handbook_cleanup_article_boundaries",
    "handbook_cleanup_normalize",
    "handbook_cleanup_normalize_overlap",
    "handbook_cleanup_ocr_repairs",
    "handbook_cleanup_policy",
    "handbook_cleanup_projection",
    "handbook_cleanup_projection_completion",
    "handbook_cleanup_projection_event_repairs",
    "handbook_cleanup_projection_events",
    "handbook_cleanup_projection_render",
    "handbook_cleanup_projection_selection",
    "handbook_cleanup_shared",
    "handbook_cleanup_table_render",
    "handbook_cleanup_tables",
    "handbook_cleanup_text_normalization",
    "handbook_semantics",
    "handbook_structure",
    "local_tokenizer",
    "models",
    "official_web_chunking_audit",
    "official_web_regulation_materialization",
    "process",
    "process_candidate_aggregation",
    "process_candidate_merging",
    "process_candidate_merging_curriculum",
    "process_candidate_merging_short_textual",
    "process_candidate_postprocess",
    "process_chunking",
    "process_loading",
    "process_shared",
    "raw_ingestion",
    "raw_ingestion_split_manifest",
    "raw_ingestion_split_manifest_curriculum",
    "raw_ingestion_source_truth_execution",
    "readable_text_normalization",
    "regulation_chunking",
    "regulation_chunking_answer_ready_contracts",
    "regulation_chunking_answer_ready_grouping",
    "regulation_chunking_answer_ready_support",
    "regulation_chunking_list_helpers",
    "regulation_chunking_mixed_procedure",
    "regulation_chunking_piece_conversion",
    "regulation_chunking_segment_builder",
    "regulation_chunking_shared",
    "scope_catalog",
    "source_truth_common",
    "split_manifest",
    "split_manifest_canonical_markdown",
    "tokenizer_cache",
}

REMOVED_SCRIPT_FILES = {
    "academic_calendar_selected_write_runtime_smoke.py",
    "check_java_tracked.py",
    "official_web_service_guide_no_promotion_helpers.py",
    "official_web_live_seam_report.py",
    "official_web_source_pack_report.py",
    "prefetch_tokenizer.py",
    "publish_academic_calendar_projection.py",
    "service_guide_selected_write_runtime_smoke.py",
    "verify_ooxml_structured_normalization.py",
}

REMOVED_TEXT_TOKENS = {
    "academic_calendar_selected_write_runtime_smoke",
    "official_web_service_guide_no_promotion_helpers",
    "official_web_live_seam_report",
    "official_web_source_pack_report",
    "prefetch_tokenizer",
    "process_raw_ingestion_job",
    "publish_academic_calendar_projection",
    "scripts.service_guide_selected_write_runtime_smoke",
    "infer_raw_asset_typed_metadata",
    "persist_raw_provider_artifact",
    "refine_raw_asset_typed_metadata_with_ocr_evidence",
    "RawAssetTypeRefinement",
    "RawAssetTypedMetadata",
    "DerivedStructuredUnit",
    "build_curriculum_structured_units",
    "HandbookCleanupResult",
    "cleanup_handbook_document",
    "serialize_handbook_document_units",
    "campus_ingestion_core",
    "packages/ingestion-core",
}

REMOVED_MODULE_REF_PATTERNS = (
    re.compile(r"campus_ingestion_core\.chunking(?!_)"),
    re.compile(r"campus_ingestion_core\.artifact_keys(?!_)"),
    re.compile(r"campus_ingestion_core\.artifacts(?!_)"),
    re.compile(r"campus_ingestion_core\.campus_agent_ingestion_artifacts(?!_)"),
    re.compile(r"campus_ingestion_core\.campus_agent_ingestion_authorization(?!_)"),
    re.compile(r"campus_ingestion_core\.chunking_context(?!_)"),
    re.compile(r"campus_ingestion_core\.chunking_structure(?!_)"),
    re.compile(r"campus_ingestion_core\.chunking_tables(?!_)"),
    re.compile(r"campus_ingestion_core\.chunking_token_windows(?!_)"),
    re.compile(r"campus_ingestion_core\.chunking_tokenizers(?!_)"),
    re.compile(r"campus_ingestion_core\.corpus_profiles(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_chunk_units(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_chunk_units_chunking(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_document_units(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_document_units_build(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_document_units_shared(?!_)"),
    re.compile(r"campus_ingestion_core\.curriculum_title_normalization(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_article_structure(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_article_boundaries(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_normalize(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_normalize_overlap(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_ocr_repairs(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_policy(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection_completion(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection_event_repairs(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection_events(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection_render(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_projection_selection(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_shared(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_table_render(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_tables(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_cleanup_text_normalization(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_semantics(?!_)"),
    re.compile(r"campus_ingestion_core\.handbook_structure(?!_)"),
    re.compile(r"campus_ingestion_core\.local_tokenizer(?!_)"),
    re.compile(r"campus_ingestion_core\.official_web_chunking_audit(?!_)"),
    re.compile(r"campus_ingestion_core\.official_web_regulation_materialization(?!_)"),
    re.compile(r"campus_ingestion_core\.process(?!_)"),
    re.compile(r"campus_ingestion_core\.process_candidate_aggregation(?!_)"),
    re.compile(r"campus_ingestion_core\.process_candidate_merging(?!_)"),
    re.compile(r"campus_ingestion_core\.process_candidate_merging_curriculum(?!_)"),
    re.compile(r"campus_ingestion_core\.process_candidate_merging_short_textual(?!_)"),
    re.compile(r"campus_ingestion_core\.process_candidate_postprocess(?!_)"),
    re.compile(r"campus_ingestion_core\.process_chunking(?!_)"),
    re.compile(r"campus_ingestion_core\.process_loading(?!_)"),
    re.compile(r"campus_ingestion_core\.process_shared(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion_split_manifest(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion_split_manifest_curriculum(?!_)"),
    re.compile(r"campus_ingestion_core\.raw_ingestion_source_truth_execution(?!_)"),
    re.compile(r"campus_ingestion_core\.readable_text_normalization(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_answer_ready_contracts(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_answer_ready_grouping(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_answer_ready_support(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_list_helpers(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_mixed_procedure(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_piece_conversion(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_segment_builder(?!_)"),
    re.compile(r"campus_ingestion_core\.regulation_chunking_shared(?!_)"),
    re.compile(r"campus_ingestion_core\.scope_catalog(?!_)"),
    re.compile(r"campus_ingestion_core\.source_truth_common(?!_)"),
    re.compile(r"campus_ingestion_core\.split_manifest(?!_)"),
    re.compile(r"campus_ingestion_core\.split_manifest_canonical_markdown(?!_)"),
    re.compile(r"campus_ingestion_core\.tokenizer_cache(?!_)"),
)

TS_ONLY_PYTHON_WORKSPACE_RESIDUE = {
    Path("apps/authenticated-notice-collector/pyproject.toml"),
    Path("apps/official-web-collector/pyproject.toml"),
}

RETIRED_INGESTION_PYTHON_PACKAGES = {
    Path("packages/official-web-core"),
    Path("packages/regulation-semantics"),
    Path("packages/wechat-official-account-core"),
}


def _is_allowlisted(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if relative in ALLOWLISTED_PATHS:
        return True
    return any(relative.parts[: len(prefix)] == prefix for prefix in ALLOWLISTED_PREFIXES)


class IngestionPythonCleanTargetResidueTest(unittest.TestCase):
    def test_ingestion_worker_app_is_not_present(self) -> None:
        self.assertFalse(
            (REPO_ROOT / "apps/ingestion-worker").exists(),
            "apps/ingestion-worker must stay removed; use ingestion-control Temporal workers "
            "and ingestion-core library code instead.",
        )

    def test_legacy_python_ingestion_core_package_is_not_present(self) -> None:
        self.assertFalse(INGESTION_CORE_PACKAGE_ROOT.exists())

    def test_retired_ingestion_packages_are_not_present(self) -> None:
        for package_root in RETIRED_INGESTION_PYTHON_PACKAGES:
            with self.subTest(package_root=str(package_root)):
                self.assertFalse((REPO_ROOT / package_root).exists())

    def test_legacy_office_conversion_service_is_not_present(self) -> None:
        self.assertFalse((REPO_ROOT / "apps/legacy-office-conversion-service").exists())
        self.assertFalse(
            (REPO_ROOT / "infra/local/docker-compose.legacy-office-conversion.yml").exists()
        )

    def test_active_surfaces_do_not_reference_ingestion_worker_modules(self) -> None:
        offenders: list[str] = []
        for root in ACTIVE_SCAN_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                if _is_allowlisted(path):
                    continue
                text = path.read_text(encoding="utf-8")
                for module_ref in sorted(set(WORKER_REF_PATTERN.findall(text))):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}: {module_ref}")

        self.assertFalse(
            sorted(offenders),
            "active surfaces must not reference removed ingestion Python worker modules:\n"
            + "\n".join(sorted(offenders)),
        )

    def test_removed_ingestion_core_lifecycle_modules_are_not_present(self) -> None:
        offenders = [
            str(
                (
                    INGESTION_CORE_PACKAGE_ROOT / "src/campus_ingestion_core" / f"{module_name}.py"
                ).relative_to(REPO_ROOT)
            )
            for module_name in sorted(REMOVED_INGESTION_CORE_MODULES)
            if (
                INGESTION_CORE_PACKAGE_ROOT / "src/campus_ingestion_core" / f"{module_name}.py"
            ).exists()
        ]

        self.assertFalse(
            offenders,
            "old ingestion-core lifecycle modules must be deleted:\n" + "\n".join(offenders),
        )

    def test_removed_active_python_ingestion_scripts_are_not_present(self) -> None:
        offenders = [
            str((REPO_ROOT / "scripts" / file_name).relative_to(REPO_ROOT))
            for file_name in sorted(REMOVED_SCRIPT_FILES)
            if (REPO_ROOT / "scripts" / file_name).exists()
        ]

        self.assertFalse(
            offenders,
            "old active Python ingestion scripts must be deleted:\n" + "\n".join(offenders),
        )

    def test_ts_only_collector_packages_do_not_reenter_uv_workspace(self) -> None:
        offenders = [
            str(path)
            for path in sorted(TS_ONLY_PYTHON_WORKSPACE_RESIDUE)
            if (REPO_ROOT / path).exists()
        ]

        self.assertFalse(
            offenders,
            "TS-owned collector/core packages must not carry pyproject.toml workspace shells:\n"
            + "\n".join(offenders),
        )

    def test_active_surfaces_do_not_reference_removed_core_lifecycle_tokens(self) -> None:
        offenders: list[str] = []
        for root in ACTIVE_SCAN_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                if _is_allowlisted(path):
                    continue
                text = path.read_text(encoding="utf-8")
                for token in sorted(REMOVED_TEXT_TOKENS):
                    if token in text:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {token}")
                for pattern in REMOVED_MODULE_REF_PATTERNS:
                    if pattern.search(text):
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {pattern.pattern}")

        self.assertFalse(
            sorted(offenders),
            "active surfaces must not reference removed ingestion lifecycle tokens:\n"
            + "\n".join(sorted(offenders)),
        )


if __name__ == "__main__":
    unittest.main()
