from __future__ import annotations

import os

import boto3

from .shared import DERIVED_BUCKET


def _create_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["OBJECT_STORE_ENDPOINT"],
        aws_access_key_id=os.environ["OBJECT_STORE_ACCESS_KEY"],
        aws_secret_access_key=os.environ["OBJECT_STORE_SECRET_KEY"],
    )


def _read_text_object(*, client, key: str, bucket: str = DERIVED_BUCKET) -> str:
    return client.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")


def _read_optional_bytes_object(*, client, key: str, bucket: str = DERIVED_BUCKET) -> bytes | None:
    try:
        return client.get_object(Bucket=bucket, Key=key)["Body"].read()
    except KeyError:
        return None
    except Exception as exc:  # pragma: no cover - boto3 path
        response = getattr(exc, "response", None)
        if isinstance(response, dict):
            error = response.get("Error") or {}
            if str(error.get("Code") or "") in {"NoSuchKey", "404", "NotFound"}:
                return None
        raise


def _list_object_keys(
    client,
    *,
    prefix: str,
    bucket: str = DERIVED_BUCKET,
) -> tuple[str, ...]:
    continuation_token: str | None = None
    keys: list[str] = []
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**kwargs)
        keys.extend(
            str(item.get("Key") or "").strip()
            for item in response.get("Contents") or ()
            if str(item.get("Key") or "").strip()
        )
        if not response.get("IsTruncated"):
            break
        continuation_token = str(response.get("NextContinuationToken") or "").strip() or None
    return tuple(sorted(dict.fromkeys(keys)))
