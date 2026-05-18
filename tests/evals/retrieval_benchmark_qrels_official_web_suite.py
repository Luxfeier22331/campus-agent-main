from __future__ import annotations

import json
from pathlib import Path

from tests.evals.retrieval_benchmark_test_support import (
    OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
    OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_MANIFEST_PATH,
    OFFICIAL_WEB_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH,
    KnowledgeScope,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    load_retrieval_qrels_dataset,
    resolve_retrieval_fixture_manifest_path,
    unittest,
    validate_retrieval_qrels_fixture,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_OFFICIAL_WEB_TARGET_INVENTORY_PATH = (
    _REPO_ROOT / "configs" / "sources" / "official_web" / "muc_public" / "target-inventory.json"
)
_OFFICIAL_WEB_PROJECTION_ROUTING_PATH = (
    _REPO_ROOT / "configs" / "sources" / "official_web" / "muc_public" / "projection-routing.json"
)
_QUERY_ENABLED_OFFICIAL_WEB_COLLECTIONS = frozenset({"stable_reference"})


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise AssertionError(f"{path} must contain a JSON object")
    return payload


def _stable_reference_target_inventory_urls() -> frozenset[str]:
    payload = _load_json(_OFFICIAL_WEB_TARGET_INVENTORY_PATH)
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise AssertionError("target-inventory entries must be an array")
    urls: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("consumer_family") != "stable_reference_candidate":
            continue
        if entry.get("selected_write_target") != "official_web/stable_reference":
            continue
        if bool(entry.get("inventory_only")):
            continue
        source_urls = entry.get("source_urls")
        if not isinstance(source_urls, list):
            raise AssertionError(
                f"stable_reference target {entry.get('inventory_id')} has no source_urls"
            )
        urls.update(str(url).strip() for url in source_urls if str(url).strip())
    return frozenset(urls)


class RetrievalOfficialWebQrelsFixtureTest(unittest.TestCase):
    def test_official_web_projection_routing_does_not_open_query_enabled_surfaces(self) -> None:
        payload = _load_json(_OFFICIAL_WEB_PROJECTION_ROUTING_PATH)
        routes = payload.get("routes")
        if not isinstance(routes, list):
            self.fail("projection-routing routes must be an array")

        routed_collections = {
            str(route.get("target_collection"))
            for route in routes
            if isinstance(route, dict)
            and str(route.get("target_corpus")) == "official_web"
            and str(route.get("target_collection")) in _QUERY_ENABLED_OFFICIAL_WEB_COLLECTIONS
        }

        self.assertEqual(
            routed_collections,
            set(),
            "projection-routing is legacy title routing and must not independently admit "
            "official_web query-enabled surfaces; target-inventory/source-pack lineage must drive admission",
        )

    def test_stable_reference_manifest_is_subset_of_target_inventory_admission(self) -> None:
        manifest = _load_json(OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH)
        documents = manifest.get("documents")
        if not isinstance(documents, list):
            self.fail("stable_reference split manifest documents must be an array")

        manifest_urls = {
            str(document.get("source_uri")).strip()
            for document in documents
            if isinstance(document, dict) and str(document.get("status") or "active") == "active"
        }
        admitted_urls = _stable_reference_target_inventory_urls()

        self.assertTrue(manifest_urls)
        self.assertLessEqual(manifest_urls, admitted_urls)

    def test_stable_reference_qrels_only_reference_manifest_documents(self) -> None:
        manifest = _load_json(OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH)
        manifest_doc_ids = {
            str(document.get("document_id")).strip()
            for document in manifest.get("documents") or ()
            if isinstance(document, dict) and str(document.get("status") or "active") == "active"
        }
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH)
        referenced_doc_ids = {
            source.doc_id
            for case in dataset.cases
            for source in (*case.expected_sources, *case.forbidden_sources)
            if source.doc_id
        }

        self.assertTrue(manifest_doc_ids)
        self.assertLessEqual(referenced_doc_ids, manifest_doc_ids)

    def test_load_official_web_retrieval_qrels_dataset_reads_inventory_guard_baseline(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="muc_public_pages")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(dataset.baseline["scope_posture"], "inventory_qc_only")
        self.assertEqual(
            {case.case_id for case in dataset.cases},
            {
                "inventory-only-scholars-page",
                "inventory-only-current-leadership-page",
                "inventory-only-lecture-notice-page",
                "inventory-only-law-interpretation-page",
            },
        )

    def test_official_web_muc_public_pages_qrels_fixture_has_no_answer_bearing_truth(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_QRELS_FIXTURE_PATH)

        self.assertTrue(dataset.cases)
        self.assertTrue(all(not case.expected_sources for case in dataset.cases))
        self.assertTrue(all(not case.forbidden_sources for case in dataset.cases))
        self.assertEqual(
            set(dataset.coverage_scenarios),
            {"mixed_inventory_not_query_enabled"},
        )

    def test_validate_official_web_qrels_fixture_against_current_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_scope(self) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(OFFICIAL_WEB_QRELS_FIXTURE_PATH),
            OFFICIAL_WEB_MANIFEST_PATH,
        )

    def test_load_official_web_stable_reference_retrieval_qrels_dataset_reads_split_baseline(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="stable_reference")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(
            {case.case_id for case in dataset.cases},
            {
                "stable-reference-school-profile",
                "stable-reference-teaching-research-units",
                "stable-reference-fee-disclosure",
                "stable-reference-no-hit-fictional-service",
            },
        )

    def test_official_web_stable_reference_qrels_fixture_locks_expected_sources_to_split_doc_truth(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH)
        cases = {case.case_id: case for case in dataset.cases}

        self.assertEqual(
            cases["stable-reference-school-profile"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    version_id="owdocver:239b3237c2259702ed1fe2955afe869303e943f6",
                    grade=2,
                    rationale="学校简介 query 应命中 target-inventory/source-pack 准入的学校简介页面。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-teaching-research-units"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    version_id="owdocver:043d9feb870de5219c0ff7de6bd065f9adc8b4c0",
                    grade=2,
                    rationale="教学和科研单位 query 应命中 target-inventory/source-pack 准入的单位列表页面。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-fee-disclosure"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:directory_page:9d7917bb1eb39649f02c6285c51280d811790cae",
                    version_id="owdocver:493b69ab0ae0b4ec0173a18801ef809b4c694f1b",
                    grade=2,
                    rationale="收费公示 query 应命中 target-inventory/source-pack 准入的教育收费公示表。",
                ),
            ),
        )
        self.assertNotIn("stable-reference-scholars", cases)
        self.assertNotIn("stable-reference-school-overview", cases)
        self.assertNotIn("stable-reference-current-leadership", cases)

    def test_validate_official_web_stable_reference_qrels_fixture_against_split_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_stable_reference_scope(
        self,
    ) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(
                OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH
            ),
            OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
        )

    def test_load_official_web_fresh_news_retrieval_qrels_dataset_reads_seed_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="fresh_news")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(len(dataset.cases), 8)
        self.assertEqual(dataset.baseline["scope_posture"], "offline_seed_validation_only")

    def test_validate_official_web_fresh_news_qrels_fixture_against_split_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_fresh_news_scope(
        self,
    ) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH),
            OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
        )
