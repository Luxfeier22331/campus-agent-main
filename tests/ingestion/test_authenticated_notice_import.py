import unittest

from tests.ingestion.authenticated_notice_import_bundle_suite import *
from tests.ingestion.authenticated_notice_import_export_suite import *
from tests.ingestion.authenticated_notice_import_inventory_suite import *
from tests.ingestion.authenticated_notice_import_test_support import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)

__all__ = [
    "_FakeObjectStore",
    "_sample_export_manifest",
    "_sample_notice_bundle",
    "_write_json",
]

if __name__ == "__main__":
    unittest.main()
