from __future__ import annotations

import importlib
import unittest

"""Loads focused internal notice schedule image OCR case modules."""

CASE_MODULES = (
    "tests.ingestion.cases_internal_notice_schedule_image_ocr_part01",
    "tests.ingestion.cases_internal_notice_schedule_image_ocr_part02",
    "tests.ingestion.cases_internal_notice_schedule_image_ocr_part03",
    "tests.ingestion.cases_internal_notice_schedule_image_ocr_part04",
)


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for module_name in CASE_MODULES:
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(module_name)))
    return suite


if __name__ == "__main__":
    unittest.main()
