from __future__ import annotations

import base64
import hashlib
import unittest

import httpx
from campus_ingestion_core.legacy_office_conversion_client import (
    LegacyOfficeConversionClient,
    LegacyOfficeConversionClientError,
    LegacyOfficeConversionRequest,
    build_legacy_office_conversion_client_from_env,
)


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, payload: dict[str, object]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, object]:
        return self._payload


class LegacyOfficeConversionClientTest(unittest.TestCase):
    def test_convert_posts_typed_request_and_parses_success_payload(self) -> None:
        source_bytes = b"legacy-doc-binary"
        normalized_bytes = b"normalized-docx-binary"
        captured: dict[str, object] = {}

        def fake_post(
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, object],
            timeout: float,
        ) -> _FakeResponse:
            self.assertEqual(timeout, 42.0)
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json
            return _FakeResponse(
                status_code=200,
                payload={
                    "target_format": "docx",
                    "normalized_media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "normalized_sha256": hashlib.sha256(normalized_bytes).hexdigest(),
                    "normalized_bytes_b64": base64.b64encode(normalized_bytes).decode("ascii"),
                    "engine_name": "jodconverter+libreoffice",
                    "engine_version": "7.6.7",
                    "warnings": [],
                },
            )

        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091/",
            internal_shared_secret="internal-secret",
            timeout_seconds=42.0,
            post=fake_post,
        )

        result = client.convert(
            LegacyOfficeConversionRequest(
                source_media_type="application/msword",
                target_format="docx",
                source_sha256=hashlib.sha256(source_bytes).hexdigest(),
                filename="legacy.doc",
                source_bytes=source_bytes,
            )
        )

        self.assertEqual(
            captured["url"], "http://127.0.0.1:8091/api/internal/legacy-office/conversions"
        )
        self.assertEqual(
            captured["headers"],
            {
                "x-app-internal-auth": "internal-secret",
            },
        )
        self.assertEqual(
            captured["body"],
            {
                "source_media_type": "application/msword",
                "target_format": "docx",
                "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
                "filename": "legacy.doc",
                "source_bytes_b64": base64.b64encode(source_bytes).decode("ascii"),
            },
        )
        self.assertEqual(result.target_format, "docx")
        self.assertEqual(
            result.normalized_media_type,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.assertEqual(result.normalized_bytes, normalized_bytes)
        self.assertEqual(result.engine_name, "jodconverter+libreoffice")
        self.assertEqual(result.engine_version, "7.6.7")
        self.assertEqual(result.warnings, ())

    def test_convert_fails_close_on_service_http_error(self) -> None:
        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091",
            internal_shared_secret="internal-secret",
            post=lambda url, **kwargs: _FakeResponse(status_code=503, payload={}),
        )

        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "conversion service returned unexpected status 503",
        ):
            client.convert(
                LegacyOfficeConversionRequest(
                    source_media_type="application/msword",
                    target_format="docx",
                    source_sha256="abc123",
                    filename="legacy.doc",
                    source_bytes=b"legacy-doc-binary",
                )
            )

    def test_convert_fails_close_on_timeout(self) -> None:
        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091",
            internal_shared_secret="internal-secret",
            post=lambda url, **kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("timed out")),
        )

        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "conversion service request failed: timed out",
        ):
            client.convert(
                LegacyOfficeConversionRequest(
                    source_media_type="application/msword",
                    target_format="docx",
                    source_sha256="abc123",
                    filename="legacy.doc",
                    source_bytes=b"legacy-doc-binary",
                )
            )

    def test_convert_fails_close_on_hash_mismatch(self) -> None:
        normalized_bytes = b"normalized-docx-binary"

        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091",
            internal_shared_secret="internal-secret",
            post=lambda url, **kwargs: _FakeResponse(
                payload={
                    "target_format": "docx",
                    "normalized_media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "normalized_sha256": "not-the-real-hash",
                    "normalized_bytes_b64": base64.b64encode(normalized_bytes).decode("ascii"),
                    "engine_name": "jodconverter+libreoffice",
                    "engine_version": "7.6.7",
                    "warnings": [],
                }
            ),
        )

        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "normalized sha256 mismatch",
        ):
            client.convert(
                LegacyOfficeConversionRequest(
                    source_media_type="application/msword",
                    target_format="docx",
                    source_sha256="abc123",
                    filename="legacy.doc",
                    source_bytes=b"legacy-doc-binary",
                )
            )

    def test_convert_fails_close_on_missing_bytes(self) -> None:
        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091",
            internal_shared_secret="internal-secret",
            post=lambda url, **kwargs: _FakeResponse(
                payload={
                    "target_format": "docx",
                    "normalized_media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "normalized_sha256": "abc",
                    "engine_name": "jodconverter+libreoffice",
                    "engine_version": "7.6.7",
                    "warnings": [],
                }
            ),
        )

        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "missing required field 'normalized_bytes_b64'",
        ):
            client.convert(
                LegacyOfficeConversionRequest(
                    source_media_type="application/msword",
                    target_format="docx",
                    source_sha256="abc123",
                    filename="legacy.doc",
                    source_bytes=b"legacy-doc-binary",
                )
            )

    def test_build_from_env_requires_base_url_and_shared_secret(self) -> None:
        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "legacy Office conversion service is not configured",
        ):
            build_legacy_office_conversion_client_from_env(env={})

    def test_build_from_env_rejects_unsupported_target_format(self) -> None:
        client = LegacyOfficeConversionClient(
            base_url="http://127.0.0.1:8091",
            internal_shared_secret="internal-secret",
            post=lambda url, **kwargs: _FakeResponse(payload={}),
        )

        with self.assertRaisesRegex(
            LegacyOfficeConversionClientError,
            "unsupported target_format",
        ):
            client.convert(
                LegacyOfficeConversionRequest(
                    source_media_type="application/pdf",
                    target_format="pdf",
                    source_sha256="abc123",
                    filename="legacy.pdf",
                    source_bytes=b"not-office",
                )
            )


if __name__ == "__main__":
    unittest.main()
