from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_core import ImportReport, import_campusrag_existing_ocr


def main() -> None:
    report = import_campusrag_existing_ocr()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["ImportReport", "import_campusrag_existing_ocr", "main"]


if __name__ == "__main__":
    main()
