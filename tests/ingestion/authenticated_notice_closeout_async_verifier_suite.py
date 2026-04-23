from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *


class CloseoutVerifierTest(unittest.TestCase):
    def test_verifier_reconciles_document_and_raw_asset_sets(self) -> None:
        verifier = CloseoutVerifier()

        document_report = verifier.reconcile_documents(
            {"notice:muc:1", "notice:muc:2"},
            {"notice:muc:1"},
        )
        raw_report = verifier.reconcile_raw_assets(
            {"asset:1", "asset:2"},
            {"asset:1", "asset:3"},
        )

        self.assertEqual(document_report["missing_document_id_count"], 1)
        self.assertEqual(document_report["unexpected_document_id_count"], 0)
        self.assertEqual(raw_report["matching_raw_asset_id_count"], 1)
        self.assertEqual(raw_report["unexpected_raw_asset_id_count"], 1)
