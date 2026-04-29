from __future__ import annotations

import unittest
from types import SimpleNamespace

from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
)
from campus_ingestion_core.raw_ingestion_source_truth_support import (
    _needs_dual_run_image_adjudication,
)


class FileAssetRoutingStrategyTest(unittest.TestCase):
    def test_mineru_primary_image_strategy_bypasses_dual_run_adjudication(self) -> None:
        settings = SimpleNamespace(
            source_ocr_image_routing_strategy="mineru_primary",
            online_ocr=SimpleNamespace(provider=ONLINE_OCR_PROVIDER_ASYNC_JOBS),
            mineru_online_ocr=SimpleNamespace(provider=ONLINE_OCR_PROVIDER_MINERU_API),
        )
        raw_asset_record = SimpleNamespace(
            asset_kind="image",
            asset_subkind="generic_image",
        )

        self.assertFalse(
            _needs_dual_run_image_adjudication(
                settings=settings,
                raw_asset_record=raw_asset_record,
            )
        )


if __name__ == "__main__":
    unittest.main()
