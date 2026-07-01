from .chunking_policy_test_support import *


class ChunkingPolicyProfileTest(_ChunkingPolicyTestCase):
    def test_default_profile_matches_generic_structure_first_budget_defaults(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.chunk_size, DEFAULT_CHUNK_SIZE)
        self.assertEqual(profile.max_chunk_size, DEFAULT_MAX_CHUNK_SIZE)
        self.assertEqual(profile.chunk_overlap, DEFAULT_CHUNK_OVERLAP)
        self.assertEqual(profile.min_chunk_size, DEFAULT_MIN_CHUNK_SIZE)
        self.assertEqual(profile.split_strategy, "structure_first")
        self.assertEqual(profile.chunk_policy_version, DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.cleaning_policy_version, DEFAULT_CLEANING_POLICY_VERSION)

    def test_chunk_profile_rejects_invalid_boundaries(self) -> None:
        with self.assertRaises(ValueError):
            ChunkProfile(chunk_size=0)
        with self.assertRaises(ValueError):
            ChunkProfile(chunk_size=64, max_chunk_size=63)
        with self.assertRaises(ValueError):
            ChunkProfile(max_chunk_size=64, chunk_overlap=64)
        with self.assertRaises(ValueError):
            ChunkProfile(min_chunk_size=0)
        with self.assertRaises(ValueError):
            ChunkProfile(max_chunk_size=64, min_chunk_size=64)
        with self.assertRaises(ValueError):
            ChunkProfile(split_strategy="unknown")  # type: ignore[arg-type]

    def test_default_profile_keeps_structure_first_strategy_available(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.strategy_name, "structure_first_default_v1")
        self.assertIsInstance(profile.strategy, StudentHandbookChunkingStrategy)

    def test_build_student_handbook_chunk_profile_v2_uses_current_runtime_budget(self) -> None:
        profile = build_student_handbook_chunk_profile(
            profile_version="student_handbook_semantic_v2",
            model_name="Qwen3-Embedding-4B",
        )

        self.assertEqual(profile.chunk_size, 384)
        self.assertEqual(profile.max_chunk_size, 512)
        self.assertEqual(profile.chunk_overlap, 64)
        self.assertEqual(profile.min_chunk_size, 96)
        self.assertEqual(profile.chunk_policy_version, "student_handbook_semantic_v2")
        self.assertIn("Qwen3-Embedding-4B", profile.tokenizer_name)

    def test_build_student_handbook_chunk_profile_v3_uses_qwen_tokenizer_and_final_text_budgeting(
        self,
    ) -> None:
        profile = build_student_handbook_chunk_profile(
            profile_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
            model_name="Qwen3-Embedding-4B",
        )

        self.assertEqual(profile.chunk_size, 384)
        self.assertEqual(profile.max_chunk_size, 512)
        self.assertEqual(profile.chunk_overlap, 64)
        self.assertEqual(profile.min_chunk_size, 96)
        self.assertEqual(profile.chunk_policy_version, HANDBOOK_V3_CHUNK_POLICY_VERSION)
        self.assertTrue(profile.final_text_aware)
        self.assertEqual(profile.safety_margin, 16)
        self.assertEqual(profile.strategy_name, "student_handbook_structure_v3")
        self.assertEqual(profile.tokenizer_name, "hf:Qwen/Qwen3-Embedding-4B")

    def test_chunking_tokenizers_module_normalizes_qwen_embedding_alias(self) -> None:
        self.assertEqual(
            normalize_embedding_model_name_from_tokenizers_module("Qwen/Qwen3-Embedding-4B"),
            "Qwen3-Embedding-4B",
        )

    def test_mock_embedding_model_uses_explicit_mock_token_counter(self) -> None:
        counter = build_token_counter("mock-embedding-8d")

        self.assertEqual(counter.name, "mock:mock-embedding-8d")
        self.assertGreater(counter.count("冬季作息时间为23:00熄灯。"), 0)

    def test_tiktoken_counter_fails_closed_when_dependency_is_missing(self) -> None:
        with (
            mock.patch.dict(sys.modules, {"tiktoken": None}),
            self.assertRaisesRegex(RuntimeError, "tiktoken is required"),
        ):
            TiktokenTokenCounter(model_name="text-embedding-3-large").count("hello")

    def test_resolve_prefetched_hf_tokenizer_path_requires_local_cache(self) -> None:
        with (
            mock.patch(
                "campus_ingestion_core.tokenizer_cache._snapshot_download",
                side_effect=RuntimeError("cache miss"),
            ) as snapshot_download,
            self.assertRaisesRegex(RuntimeError, "Tokenizer cache miss"),
        ):
            try:
                tokenizer_cache.resolve_prefetched_hf_tokenizer_path("Qwen/Qwen3-Embedding-4B")
            except RuntimeError as exc:
                removed_module = "prefetch" + "_tokenizer"
                self.assertNotIn(f"python -m campus_ingestion_core.{removed_module}", str(exc))
                self.assertIn("Pre-provision", str(exc))
                raise

        snapshot_download.assert_called_once_with(
            "Qwen/Qwen3-Embedding-4B",
            allow_patterns=tokenizer_cache.HF_TOKENIZER_ALLOW_PATTERNS,
            local_files_only=True,
        )

    def test_prefetch_hf_tokenizer_downloads_expected_tokenizer_files(self) -> None:
        with mock.patch(
            "campus_ingestion_core.tokenizer_cache._snapshot_download",
            return_value="/tmp/qwen-tokenizer",
        ) as snapshot_download:
            result = tokenizer_cache.prefetch_hf_tokenizer("Qwen/Qwen3-Embedding-4B")

        self.assertEqual(result, "/tmp/qwen-tokenizer")
        snapshot_download.assert_called_once_with(
            "Qwen/Qwen3-Embedding-4B",
            allow_patterns=tokenizer_cache.HF_TOKENIZER_ALLOW_PATTERNS,
        )

    def test_count_hf_tokens_uses_local_tokenizer_kernel(self) -> None:
        with (
            mock.patch(
                "campus_ingestion_core.chunking_tokenizers.count_tokens_with_local_tokenizer",
                return_value=2,
            ) as count_tokens,
        ):
            result = _count_hf_tokens("Qwen/Qwen3-Embedding-4B", "hello world")

        self.assertEqual(result, 2)
        count_tokens.assert_called_once_with(
            repo_id="Qwen/Qwen3-Embedding-4B",
            text="hello world",
        )

    def test_count_hf_tokens_initializes_once_under_concurrent_calls(self) -> None:
        _count_hf_tokens.cache_clear()
        call_count = [0]
        call_lock = threading.Lock()

        def fake_count_tokens(*, repo_id: str, text: str) -> int:
            self.assertEqual(repo_id, "Qwen/Qwen3-Embedding-4B")
            self.assertEqual(text, "hello world")
            with call_lock:
                call_count[0] += 1
            time.sleep(0.05)
            return 2

        with (
            mock.patch(
                "campus_ingestion_core.chunking_tokenizers.count_tokens_with_local_tokenizer",
                side_effect=fake_count_tokens,
            ),
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            counts = list(
                executor.map(
                    lambda _: _count_hf_tokens("Qwen/Qwen3-Embedding-4B", "hello world"),
                    range(8),
                )
            )

        self.assertEqual(call_count[0], 1)
        self.assertEqual(counts, [2] * 8)

    def test_local_tokenizer_counts_without_special_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tokenizer_path = Path(temp_dir) / "tokenizer.json"
            tokenizer_path.write_text(
                """{
  "version": "1.0",
  "truncation": null,
  "padding": null,
  "added_tokens": [
    {"id": 2, "content": "[CLS]", "single_word": false, "lstrip": false, "rstrip": false, "normalized": false, "special": true}
  ],
  "normalizer": null,
  "pre_tokenizer": {"type": "Whitespace"},
  "post_processor": {
    "type": "TemplateProcessing",
    "single": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}],
    "pair": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}, {"Sequence": {"id": "B", "type_id": 0}}],
    "special_tokens": {"[CLS]": {"id": "[CLS]", "ids": [2], "tokens": ["[CLS]"]}}
  },
  "decoder": null,
  "model": {
    "type": "WordLevel",
    "vocab": {"hello": 0, "world": 1, "[CLS]": 2, "[UNK]": 3},
    "unk_token": "[UNK]"
  }
}""",
                encoding="utf-8",
            )
            with mock.patch(
                "campus_ingestion_core.tokenizer_cache._snapshot_download",
                return_value=temp_dir,
            ):
                count = _count_hf_tokens("Qwen/Qwen3-Embedding-4B", "hello world")

        self.assertEqual(count, 2)
