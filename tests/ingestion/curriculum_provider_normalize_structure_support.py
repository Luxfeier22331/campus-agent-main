from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result


class CurriculumProviderNormalizeStructureBaseTest(unittest.TestCase):
    def _normalize_fixture_rows(self, fixture_path: str) -> list[dict[str, object]]:
        structured_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=Path(fixture_path).read_bytes(),
            source_pdf="synthetic-curriculum-plan.pdf",
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )
        return [
            json.loads(line)
            for line in structured_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

    def _normalize_rows(self, provider_payload: dict[str, object]) -> list[dict[str, object]]:
        structured_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
            source_pdf="curriculum-plan.pdf",
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )
        return [
            json.loads(line)
            for line in structured_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
