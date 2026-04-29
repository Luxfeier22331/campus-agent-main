from __future__ import annotations

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

    def test_resolve_prefetched_hf_tokenizer_path_requires_local_cache(self) -> None:
        with (
            mock.patch(
                "campus_ingestion_core.tokenizer_cache._snapshot_download",
                side_effect=RuntimeError("cache miss"),
            ) as snapshot_download,
            self.assertRaisesRegex(RuntimeError, "prefetch"),
        ):
            tokenizer_cache.resolve_prefetched_hf_tokenizer_path("Qwen/Qwen3-Embedding-4B")

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

    def test_load_hf_tokenizer_uses_resolved_local_snapshot_only(self) -> None:
        fake_tokenizer = object()
        fake_transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(
                from_pretrained=mock.Mock(return_value=fake_tokenizer)
            )
        )
        with (
            mock.patch(
                "campus_ingestion_core.chunking_tokenizers.resolve_prefetched_hf_tokenizer_path",
                return_value="/tmp/qwen-tokenizer",
            ) as resolve_path,
            mock.patch.dict(sys.modules, {"transformers": fake_transformers}),
        ):
            result = _load_hf_tokenizer("Qwen/Qwen3-Embedding-4B")

        self.assertIs(result, fake_tokenizer)
        resolve_path.assert_called_once_with("Qwen/Qwen3-Embedding-4B")
        fake_transformers.AutoTokenizer.from_pretrained.assert_called_once_with(
            "/tmp/qwen-tokenizer",
            local_files_only=True,
        )

    def test_load_hf_tokenizer_initializes_once_under_concurrent_calls(self) -> None:
        _load_hf_tokenizer.cache_clear()
        call_count = [0]
        call_lock = threading.Lock()

        def fake_from_pretrained(path: str, *, local_files_only: bool = True) -> object:
            self.assertEqual(path, "/tmp/qwen-tokenizer")
            self.assertTrue(local_files_only)
            with call_lock:
                call_count[0] += 1
            time.sleep(0.05)
            return object()

        fake_transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=fake_from_pretrained)
        )

        with (
            mock.patch(
                "campus_ingestion_core.chunking_tokenizers.resolve_prefetched_hf_tokenizer_path",
                return_value="/tmp/qwen-tokenizer",
            ),
            mock.patch.dict(sys.modules, {"transformers": fake_transformers}),
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            results = list(
                executor.map(
                    lambda _: _load_hf_tokenizer("Qwen/Qwen3-Embedding-4B"),
                    range(8),
                )
            )

        self.assertEqual(call_count[0], 1)
        self.assertEqual(len({id(result) for result in results}), 1)
