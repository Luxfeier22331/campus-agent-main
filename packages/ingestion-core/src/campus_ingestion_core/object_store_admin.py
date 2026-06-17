from __future__ import annotations

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings


class S3ObjectStoreAdmin:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def healthcheck(self, *, bucket: str) -> None:
        self._client.list_objects_v2(Bucket=bucket, MaxKeys=1)

    def ensure_bucket(self, *, bucket: str) -> None:
        try:
            self._client.head_bucket(Bucket=bucket)
        except Exception as exc:
            if not _is_missing_object_error(exc):
                raise
            self._client.create_bucket(Bucket=bucket)

    def delete_object(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)

    def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
        exclude_keys: tuple[str, ...] = (),
        include_path_segment_suffix: str | None = None,
    ) -> None:
        excluded = set(exclude_keys)
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys = [
                {"Key": item["Key"]}
                for item in response.get("Contents") or ()
                if item["Key"] not in excluded
                and _matches_path_segment_suffix(
                    str(item["Key"]),
                    include_path_segment_suffix,
                )
            ]
            for start in range(0, len(keys), 1000):
                batch = keys[start : start + 1000]
                if batch:
                    self._client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": batch, "Quiet": True},
                    )
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=bucket, Key=key)
        except Exception as exc:
            if _is_missing_object_error(exc):
                raise FileNotFoundError(key) from exc
            raise
        return response["Body"].read()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentLength=len(data),
            ContentType=content_type,
        )

    def upload_file(
        self,
        *,
        bucket: str,
        key: str,
        file_path: str,
        content_type: str,
    ) -> None:
        self._client.upload_file(
            Filename=file_path,
            Bucket=bucket,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None:
        self._client.download_file(
            Bucket=bucket,
            Key=key,
            Filename=file_path,
        )

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        return self._client.head_object(Bucket=bucket, Key=key)

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys: list[str] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys.extend(str(item["Key"]) for item in response.get("Contents") or ())
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return tuple(keys)

    def copy_bytes(
        self,
        *,
        bucket: str,
        source_key: str,
        target_key: str,
        content_type: str,
    ) -> None:
        data = self.get_bytes(bucket=bucket, key=source_key)
        self.put_bytes(bucket=bucket, key=target_key, data=data, content_type=content_type)


def _matches_path_segment_suffix(key: str, suffix: str | None) -> bool:
    if suffix is None:
        return True
    return any(segment.endswith(suffix) for segment in key.split("/"))


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    if not isinstance(error, dict):
        return False
    code = str(error.get("Code") or "").strip()
    return code in {"404", "NoSuchBucket", "NoSuchKey", "NotFound"}


__all__ = ["S3ObjectStoreAdmin"]
