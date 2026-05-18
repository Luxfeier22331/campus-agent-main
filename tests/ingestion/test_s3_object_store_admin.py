from __future__ import annotations

import unittest

from botocore.exceptions import ClientError
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin


class _Body:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeS3Client:
    def __init__(self, error_code: str | None = None) -> None:
        self.error_code = error_code
        self.put_object_kwargs: dict[str, object] | None = None

    def get_object(self, **kwargs: object) -> dict[str, object]:
        if self.error_code:
            raise ClientError({"Error": {"Code": self.error_code}}, "GetObject")
        return {"Body": _Body(b"payload")}

    def put_object(self, **kwargs: object) -> None:
        self.put_object_kwargs = dict(kwargs)


class S3ObjectStoreAdminTest(unittest.TestCase):
    def test_get_bytes_translates_missing_object_to_file_not_found(self) -> None:
        admin = S3ObjectStoreAdmin.__new__(S3ObjectStoreAdmin)
        admin._client = _FakeS3Client(error_code="NoSuchKey")

        with self.assertRaisesRegex(FileNotFoundError, "missing-key"):
            admin.get_bytes(bucket="bucket", key="missing-key")

    def test_get_bytes_preserves_non_missing_s3_errors(self) -> None:
        admin = S3ObjectStoreAdmin.__new__(S3ObjectStoreAdmin)
        admin._client = _FakeS3Client(error_code="AccessDenied")

        with self.assertRaises(ClientError):
            admin.get_bytes(bucket="bucket", key="denied-key")

    def test_get_bytes_reads_body(self) -> None:
        admin = S3ObjectStoreAdmin.__new__(S3ObjectStoreAdmin)
        admin._client = _FakeS3Client()

        self.assertEqual(admin.get_bytes(bucket="bucket", key="present-key"), b"payload")

    def test_put_bytes_sets_explicit_content_length(self) -> None:
        admin = S3ObjectStoreAdmin.__new__(S3ObjectStoreAdmin)
        client = _FakeS3Client()
        admin._client = client

        admin.put_bytes(
            bucket="bucket",
            key="target.md",
            data="中文正文\n".encode(),
            content_type="text/markdown; charset=utf-8",
        )

        self.assertEqual(client.put_object_kwargs["ContentLength"], len("中文正文\n".encode()))


if __name__ == "__main__":
    unittest.main()
