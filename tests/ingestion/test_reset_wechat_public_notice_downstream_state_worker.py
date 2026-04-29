from __future__ import annotations

import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.reset_wechat_public_notice_downstream_state"
)


class ResetWeChatPublicNoticeDownstreamStateWorkerCliTest(unittest.TestCase):
    def test_main_requires_yes_flag(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.load_worker_env"
            ),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

    def test_main_resets_scope_and_reports_counts(self) -> None:
        projection_entries = (
            SimpleNamespace(
                role_metadata={
                    "ocr_manifest_keys": (
                        "articles/a/projection/wechat_public_notice/multimodal/ref-1/ocr-manifest.json",
                    ),
                }
            ),
        )
        read_model_rows = (
            SimpleNamespace(canonical_markdown_object_key="derived/wechat/article-a/canonical.md"),
        )
        registry_rows = (
            SimpleNamespace(
                document_id="wechat_notice_image:muc:a:ref-1",
                source_channel="wechat_official_account",
                import_source="wechat_public_notice_inline_image_ocr",
                processed_object_keys=(
                    "derived/wechat/article-a/ref-1/canonical.md",
                    "derived/wechat/article-a/ref-1/document-units.jsonl",
                ),
                canonical_markdown_object_key="derived/wechat/article-a/ref-1/canonical.md",
                document_units_object_key="derived/wechat/article-a/ref-1/document-units.jsonl",
            ),
        )
        attempt_rows = (
            {
                "fetch_manifest_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/source-image-reference.json",
                "ocr_manifest_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/ocr-manifest.json",
                "provider_response_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/provider/model/provider-response.jsonl",
                "layout_elements_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/provider/model/layout-elements.jsonl",
            },
        )
        admission_rows = ({"batch_id": "batch-1"}, {"batch_id": "batch-2"})
        object_store = _DeleteRecordingObjectStore(
            ocr_payloads={
                "articles/a/projection/wechat_public_notice/multimodal/ref-1/ocr-manifest.json": {
                    "provider_response_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/provider/model/provider-response.jsonl",
                    "layout_elements_key": "articles/a/projection/wechat_public_notice/multimodal/ref-1/provider/model/layout-elements.jsonl",
                    "child_canonical_markdown_key": "derived/wechat/article-a/ref-1/canonical.md",
                    "child_document_units_key": "derived/wechat/article-a/ref-1/document-units.jsonl",
                }
            }
        )
        projection_store = _ReplaceScopeStore(projection_entries)
        read_model_store = _ReplaceScopeStore(read_model_rows)
        registry = _Registry(registry_rows)

        with (
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.build_notice_consumption_projection_store_from_env",
                return_value=projection_store,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.build_internal_notice_read_model_store_from_env",
                return_value=read_model_store,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.build_document_registry_from_env",
                return_value=registry,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.ObjectStoreSettings.from_env",
                return_value=SimpleNamespace(
                    bucket_source="source",
                    bucket_derived="derived",
                ),
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state.S3ObjectStoreAdmin",
                return_value=object_store,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state._load_attempt_rows",
                return_value=attempt_rows,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state._load_admission_rows",
                return_value=admission_rows,
            ),
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state._delete_attempt_rows"
            ) as delete_attempts,
            patch(
                "campus_ingestion_worker.reset_wechat_public_notice_downstream_state._delete_admission_rows"
            ) as delete_admissions,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--yes"])

        self.assertEqual(projection_store.replace_scope_calls[0]["records"], ())
        self.assertEqual(read_model_store.replace_scope_calls[0]["records"], ())
        self.assertEqual(registry.deleted_document_ids, ["wechat_notice_image:muc:a:ref-1"])
        delete_attempts.assert_called_once()
        delete_admissions.assert_called_once()
        self.assertIn(
            (
                "source",
                "articles/a/projection/wechat_public_notice/multimodal/ref-1/ocr-manifest.json",
            ),
            object_store.deleted,
        )
        self.assertIn(("derived", "derived/wechat/article-a/canonical.md"), object_store.deleted)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["projection_removed_count"], 1)
        self.assertEqual(payload["read_model_removed_count"], 1)
        self.assertEqual(payload["registry_document_removed_count"], 1)
        self.assertEqual(payload["attempt_row_removed_count"], 1)
        self.assertEqual(payload["admission_row_removed_count"], 2)


class _ReplaceScopeStore:
    def __init__(self, rows) -> None:
        self.rows = tuple(rows)
        self.replace_scope_calls: list[dict[str, object]] = []

    def list_by_scope(self, *args, **kwargs):
        return self.rows

    def replace_scope(self, source_corpus, source_collection, records):
        self.replace_scope_calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "records": records,
            }
        )


class _Registry:
    def __init__(self, rows) -> None:
        self.rows = tuple(rows)
        self.deleted_document_ids: list[str] = []

    def list_by_scope(self, *args, **kwargs):
        return self.rows

    def delete_document(self, document_id: str) -> None:
        self.deleted_document_ids.append(document_id)


class _DeleteRecordingObjectStore:
    def __init__(self, *, ocr_payloads: dict[str, dict[str, object]]) -> None:
        self.ocr_payloads = ocr_payloads
        self.deleted: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return json.dumps(self.ocr_payloads[key], ensure_ascii=False).encode("utf-8")

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys=()) -> None:
        raise AssertionError("reset must delete exact object keys, not prefixes")

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append((bucket, key))


if __name__ == "__main__":
    unittest.main()
