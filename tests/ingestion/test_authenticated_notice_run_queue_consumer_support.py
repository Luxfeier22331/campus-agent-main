from __future__ import annotations

import json

import unittest

from pathlib import Path

from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION,
    consume_authenticated_notice_ingest_queue,
)

from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support

__all__ = [name for name in globals() if not name.startswith("__")]
