from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Protocol

from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    AuthenticatedNoticeAttachmentFetchStatusRecord,
)
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired


class AuthenticatedNoticeAttachmentFetchStatusStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None: ...

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]: ...


class InMemoryAuthenticatedNoticeAttachmentFetchStatusStore:
    def __init__(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord] = (),
    ) -> None:
        self._records: dict[
            tuple[str, str, str], AuthenticatedNoticeAttachmentFetchStatusRecord
        ] = {}
        self.upsert_many(records)

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None:
        for record in records:
            self._records[(record.site_id, record.notice_id, record.attachment_ref_id)] = record

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
        normalized_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
        rows = [
            record
            for key, record in self._records.items()
            if key[0] == site_id and (not normalized_notice_ids or key[1] in normalized_notice_ids)
        ]
        return tuple(sorted(rows, key=lambda item: (item.notice_id, item.attachment_ref_id)))


def build_authenticated_notice_attachment_fetch_status_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> AuthenticatedNoticeAttachmentFetchStatusStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("authenticated notice attachment fetch status")


__all__ = [
    "AuthenticatedNoticeAttachmentFetchStatusStore",
    "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
]
