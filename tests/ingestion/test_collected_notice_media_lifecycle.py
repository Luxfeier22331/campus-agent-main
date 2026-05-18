from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_COMPLETED,
    MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    MEDIA_LIFECYCLE_PENDING,
    normalize_media_lifecycle_status,
)


class CollectedNoticeMediaLifecycleTest(unittest.TestCase):
    def test_normalize_media_lifecycle_status_accepts_contract_values(self) -> None:
        self.assertEqual(
            normalize_media_lifecycle_status(MEDIA_LIFECYCLE_PENDING),
            MEDIA_LIFECYCLE_PENDING,
        )
        self.assertEqual(
            normalize_media_lifecycle_status(MEDIA_LIFECYCLE_COMPLETED),
            MEDIA_LIFECYCLE_COMPLETED,
        )
        self.assertEqual(
            normalize_media_lifecycle_status(MEDIA_LIFECYCLE_FAILED_RETRYABLE),
            MEDIA_LIFECYCLE_FAILED_RETRYABLE,
        )

    def test_normalize_media_lifecycle_status_rejects_legacy_aliases_and_missing_values(
        self,
    ) -> None:
        for value in ("", "ready", "succeeded", "stored", "processed", "admitted"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "unsupported value"):
                normalize_media_lifecycle_status(value)
        for value in ("review", "low_confidence", "ocr_low_confidence", "failed"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "unsupported value"):
                normalize_media_lifecycle_status(value)


if __name__ == "__main__":
    unittest.main()
