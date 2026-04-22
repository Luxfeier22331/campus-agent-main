from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    EvidenceBundle,
    EvidenceSource,
    Path,
    RetrievalBenchmarkRun,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    TemporaryDirectory,
    benchmark_main,
    io,
    json,
    live_benchmark_main,
    load_retrieval_benchmark_run,
    patch,
    redirect_stderr,
    redirect_stdout,
    render_retrieval_summary_text,
    unittest,
)


class RetrievalBenchmarkCliTest(unittest.TestCase):
    def test_load_retrieval_benchmark_run_reads_observed_sources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:library",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "score": 0.9,
                                    }
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            run = load_retrieval_benchmark_run(run_path)

        self.assertIsInstance(run, RetrievalBenchmarkRun)
        self.assertEqual(run.schema_version, 1)
        self.assertEqual(
            run.cases[0].retrieved_sources[0],
            RetrievalObservedSource("handbook:library", "v1", "chunk-1", 0.9),
        )

    def test_render_retrieval_summary_text_prints_expected_metrics(self) -> None:
        text = render_retrieval_summary_text(
            RetrievalMetricSummary(
                total_cases=2,
                hit_at_1=0.5,
                hit_at_3=1.0,
                recall_at_5=0.75,
                precision_at_5=0.375,
                mrr_at_5=0.75,
                doc_hit_at_1=0.5,
                doc_hit_at_3=1.0,
                doc_recall_at_5=1.0,
                doc_precision_at_5=0.5,
                doc_mrr_at_5=0.75,
                forbidden_hit_rate=0.5,
                by_split={},
            )
        )

        self.assertIn("Retrieval Benchmark Summary", text)
        self.assertIn("hit@1: 0.500", text)
        self.assertIn("mrr@5: 0.750", text)
        self.assertIn("doc_hit@1: 0.500", text)
        self.assertIn("doc_precision@5: 0.500", text)

    def test_benchmark_main_supports_text_and_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "case-1",
                                "split": "smoke",
                                "query": "library hours",
                                "expected_sources": [{"doc_id": "handbook:library", "grade": 2}],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [{"doc_id": "handbook:library", "score": 0.9}],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            text_buffer = io.StringIO()
            with redirect_stdout(text_buffer):
                exit_code = benchmark_main(["--qrels", str(qrels_path), "--results", str(run_path)])
            json_buffer = io.StringIO()
            with redirect_stdout(json_buffer):
                json_exit_code = benchmark_main(
                    ["--qrels", str(qrels_path), "--results", str(run_path), "--format", "json"]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(json_exit_code, 0)
        self.assertIn("Retrieval Benchmark Summary", text_buffer.getvalue())
        self.assertEqual(json.loads(json_buffer.getvalue())["hit_at_1"], 1.0)

    def test_benchmark_main_fast_fails_when_qrels_fixture_has_unresolved_ambiguity(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "fixed-phrase-ethnic-experimental-class",
                                "split": "smoke",
                                "query": "民族实验班",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps({"schema_version": 1, "cases": []}, ensure_ascii=False),
                encoding="utf-8",
            )

            stderr_buffer = io.StringIO()
            with redirect_stderr(stderr_buffer):
                exit_code = benchmark_main(["--qrels", str(qrels_path), "--results", str(run_path)])

        self.assertEqual(exit_code, 2)
        self.assertIn("ambiguously matches", stderr_buffer.getvalue())

    def test_benchmark_main_loads_repo_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "cases": [],
                    }
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(json.dumps({"schema_version": 1, "cases": []}), encoding="utf-8")
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps({"schema_version": 1, "documents": []}), encoding="utf-8"
            )

            stdout_buffer = io.StringIO()
            with (
                patch("campus_evals.retrieval_benchmark.load_repo_env") as load_repo_env,
                redirect_stdout(stdout_buffer),
            ):
                exit_code = benchmark_main(
                    [
                        "--qrels",
                        str(qrels_path),
                        "--results",
                        str(run_path),
                        "--manifest",
                        str(manifest_path),
                    ]
                )

        self.assertEqual(exit_code, 0)
        load_repo_env.assert_called_once_with()


class RetrievalLiveBenchmarkCliTest(unittest.TestCase):
    def test_live_benchmark_main_writes_run_results_and_applies_runtime_override(self) -> None:
        class FakeBackend:
            def __init__(self) -> None:
                self.requests = []
                self.observed_profiles = []

            def retrieve(self, request):
                import campus_retrieval_core.backend_qdrant as backend_qdrant_module

                self.requests.append(request)
                self.observed_profiles.append(
                    backend_qdrant_module.load_runtime_profile(request.corpus, request.collection)
                )
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        EvidenceSource(
                            doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                            revision_track="source-faithful",
                            version_id="owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                            chunk_id="school-profile:chunk-1",
                            anchor={"page": 1},
                            canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            latest_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            source_channel="official_web",
                            collection="muc_public_pages",
                            is_current=True,
                            snippet="中央民族大学学校简介。",
                            score=0.91,
                        ),
                    ),
                )

        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "official_web",
                        "collection": "muc_public_pages",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "school-profile",
                                "split": "smoke",
                                "query": "中央民族大学学校简介",
                                "expected_sources": [
                                    {
                                        "doc_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                        "version_id": "owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = Path(temp_dir) / "split-manifest.v1.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "official_web_muc_public_pages_split_manifest_v1",
                        "corpus": "official_web",
                        "collection": "muc_public_pages",
                        "raw_asset_id": "asset:official-web-muc-public-pages-current-truth-20260403",
                        "documents": [
                            {
                                "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                "title": "学校简介",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output_path = Path(temp_dir) / "run-results.json"
            fake_backend = FakeBackend()

            stdout_buffer = io.StringIO()
            with (
                patch("campus_evals.retrieval_live_benchmark.load_repo_env") as load_repo_env,
                patch(
                    "campus_evals.retrieval_live_benchmark.build_retrieval_backend",
                    return_value=fake_backend,
                ),
                redirect_stdout(stdout_buffer),
            ):
                exit_code = live_benchmark_main(
                    [
                        "--qrels",
                        str(qrels_path),
                        "--output",
                        str(output_path),
                        "--manifest",
                        str(manifest_path),
                        "--force-enable-retrieval",
                        "--qdrant-collection-name",
                        "muc_public_pages__r20260403_015529",
                        "--format",
                        "json",
                    ]
                )
            output_payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        load_repo_env.assert_called_once_with()
        self.assertEqual(len(fake_backend.requests), 1)
        self.assertTrue(fake_backend.observed_profiles[0].retrieval_enabled)
        self.assertEqual(
            fake_backend.observed_profiles[0].qdrant_index_binding.alias_name,
            "muc_public_pages__r20260403_015529",
        )
        self.assertEqual(fake_backend.requests[0].top_k, 5)
        self.assertEqual(
            output_payload,
            {
                "schema_version": 1,
                "cases": [
                    {
                        "case_id": "school-profile",
                        "retrieved_sources": [
                            {
                                "doc_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                "version_id": "owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                                "chunk_id": "school-profile:chunk-1",
                                "score": 0.91,
                            }
                        ],
                    }
                ],
            },
        )
        self.assertEqual(json.loads(stdout_buffer.getvalue())["hit_at_1"], 1.0)

    def test_live_benchmark_main_maps_canonical_authorized_filter_request_overrides(self) -> None:
        class FakeBackend:
            def __init__(self) -> None:
                self.requests = []

            def retrieve(self, request):
                self.requests.append(request)
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(),
                )

        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "official_web",
                        "collection": "muc_public_pages",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "restricted-profile",
                                "split": "smoke",
                                "query": "南校区面向学生开放的新闻",
                                "request_overrides": {
                                    "entitlement_groups": ["students"],
                                    "visibility_scope": "south",
                                    "visibility_level": "restricted",
                                },
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = Path(temp_dir) / "split-manifest.v1.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "official_web_muc_public_pages_split_manifest_v1",
                        "corpus": "official_web",
                        "collection": "muc_public_pages",
                        "raw_asset_id": "asset:official-web-muc-public-pages-current-truth-20260403",
                        "documents": [
                            {
                                "document_id": "official_web:muc_public:article_detail:restricted",
                                "title": "南校区学生新闻",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "https://www.muc.edu.cn/restricted.htm",
                                "entitlement_groups": ["students"],
                                "visibility_scope": "south",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output_path = Path(temp_dir) / "run-results.json"
            fake_backend = FakeBackend()

            with (
                patch("campus_evals.retrieval_live_benchmark.load_repo_env"),
                patch(
                    "campus_evals.retrieval_live_benchmark.build_retrieval_backend",
                    return_value=fake_backend,
                ),
            ):
                exit_code = live_benchmark_main(
                    [
                        "--qrels",
                        str(qrels_path),
                        "--output",
                        str(output_path),
                        "--manifest",
                        str(manifest_path),
                    ]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(fake_backend.requests), 1)
        request = fake_backend.requests[0]
        self.assertEqual(request.effective_entitlement_groups(), ("students",))
        self.assertEqual(request.effective_visibility_scope(), "south")
        self.assertEqual(request.effective_visibility_level(), "restricted")
