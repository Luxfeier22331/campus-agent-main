from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from campus_ingestion_core.file_asset_ooxml import (
    build_ooxml_layout_elements_bytes,
    extract_docx_text_blocks,
    extract_xlsx_text_blocks,
)


@dataclass(frozen=True, slots=True)
class OoxmlVerificationSample:
    sample_kind: str
    source_object_key: str
    source_filename: str
    normalized_path: Path
    target_format: str


class OoxmlStructuredNormalizationVerificationError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify OOXML structured normalization against real authenticated_notice "
            "samples produced during the legacy Office runtime recheck."
        )
    )
    parser.add_argument(
        "--input-manifest",
        default=".tmp/phase-h-libreoffice-runtime-productization-recheck/samples/manifest.json",
        help="Manifest produced by the real-asset legacy Office runtime verification.",
    )
    parser.add_argument(
        "--output-dir",
        default=".tmp/phase-i-ooxml-structured-normalization",
        help="Directory for layout artifacts, JSON report, and markdown summaries.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the final verification report as JSON.",
    )
    return parser


def load_ooxml_verification_samples(manifest_path: Path) -> tuple[OoxmlVerificationSample, ...]:
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    samples_payload = payload.get("samples")
    if not isinstance(samples_payload, list):
        raise OoxmlStructuredNormalizationVerificationError(
            "OOXML verification manifest must contain a samples array"
        )
    samples: list[OoxmlVerificationSample] = []
    for item in samples_payload:
        if not isinstance(item, Mapping):
            continue
        normalized_path = Path(str(item.get("normalized_path") or "")).resolve()
        target_format = str(item.get("target_format") or "").strip().lower()
        source_filename = str(item.get("source_filename") or "").strip()
        source_object_key = str(item.get("source_object_key") or "").strip()
        sample_kind = str(item.get("sample_kind") or "").strip()
        if not normalized_path.is_file():
            raise OoxmlStructuredNormalizationVerificationError(
                f"OOXML verification sample missing normalized file: {normalized_path}"
            )
        if target_format not in {"docx", "xlsx"}:
            continue
        if not sample_kind or not source_filename or not source_object_key:
            raise OoxmlStructuredNormalizationVerificationError(
                "OOXML verification sample is missing required fields"
            )
        samples.append(
            OoxmlVerificationSample(
                sample_kind=sample_kind,
                source_object_key=source_object_key,
                source_filename=source_filename,
                normalized_path=normalized_path,
                target_format=target_format,
            )
        )
    if not samples:
        raise OoxmlStructuredNormalizationVerificationError(
            "OOXML verification manifest did not provide any .docx/.xlsx samples"
        )
    return tuple(samples)


def validate_xlsx_forward_fill_prefix(table_cells: Sequence[Mapping[str, object]]) -> bool:
    by_row: dict[int, list[Mapping[str, object]]] = {}
    for cell in table_cells:
        row_number = int(cell.get("row") or 0)
        if row_number <= 1:
            continue
        by_row.setdefault(row_number, []).append(cell)
    for row_number, cells in by_row.items():
        del row_number
        forward_filled = sorted(
            int(cell.get("col") or 0)
            for cell in cells
            if bool(cell.get("is_forward_filled"))
        )
        explicit = sorted(
            int(cell.get("col") or 0)
            for cell in cells
            if not bool(cell.get("is_forward_filled"))
        )
        if not forward_filled:
            continue
        if not explicit:
            return False
        first_explicit = explicit[0]
        expected_prefix = list(range(1, first_explicit))
        if forward_filled != expected_prefix:
            return False
    return True


def verify_ooxml_structured_normalization(
    *,
    input_manifest: Path,
    output_dir: Path,
) -> dict[str, Any]:
    samples = load_ooxml_verification_samples(input_manifest.resolve())
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for sample in samples:
        sample_dir = output_dir / sample.sample_kind
        sample_dir.mkdir(parents=True, exist_ok=True)
        file_bytes = sample.normalized_path.read_bytes()
        if sample.target_format == "docx":
            extraction_outcome = extract_docx_text_blocks(
                file_bytes,
                filename=sample.normalized_path.name,
                source_object_key=sample.source_object_key,
            )
        else:
            extraction_outcome = extract_xlsx_text_blocks(
                file_bytes,
                filename=sample.normalized_path.name,
                source_object_key=sample.source_object_key,
            )
        layout_elements_bytes = build_ooxml_layout_elements_bytes(
            file_bytes,
            filename=sample.normalized_path.name,
            source_object_key=sample.source_object_key,
        )
        rows = _load_jsonl_rows(layout_elements_bytes)
        (sample_dir / "layout-elements.jsonl").write_bytes(layout_elements_bytes)
        result = _build_sample_result(
            sample=sample,
            extraction_outcome=extraction_outcome,
            layout_rows=rows,
        )
        (sample_dir / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        results.append(result)

    report = {
        "schema_version": "ooxml_structured_normalization_report_v1",
        "input_manifest_path": str(input_manifest),
        "output_dir": str(output_dir),
        "results": results,
    }
    (output_dir / "ooxml-structured-normalization-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "OOXML-STRUCTURED-NORMALIZATION-SUMMARY.md").write_text(
        _build_summary(results),
        encoding="utf-8",
    )
    (output_dir / "OOXML-STRUCTURED-QUALITY-VALIDATION.md").write_text(
        _build_quality_validation(results),
        encoding="utf-8",
    )
    return report


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = verify_ooxml_structured_normalization(
        input_manifest=Path(args.input_manifest),
        output_dir=Path(args.output_dir),
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(Path(report["output_dir"]) / "OOXML-STRUCTURED-NORMALIZATION-SUMMARY.md")
    return 0


def _load_jsonl_rows(layout_elements_bytes: bytes) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for line in layout_elements_bytes.decode("utf-8").splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            rows.append(payload)
    return tuple(rows)


def _build_sample_result(
    *,
    sample: OoxmlVerificationSample,
    extraction_outcome,
    layout_rows: Sequence[Mapping[str, object]],
) -> dict[str, Any]:
    row_type_counts = {
        row_type: sum(1 for row in layout_rows if str(row.get("row_type") or "") == row_type)
        for row_type in sorted({str(row.get("row_type") or "") for row in layout_rows})
    }
    table_rows = [
        row
        for row in layout_rows
        if str(row.get("row_type") or "") == "table"
    ]
    first_heading = next(
        (
            str(row.get("text_normalized") or "").strip()
            for row in layout_rows
            if str(row.get("row_type") or "") == "heading" and str(row.get("text_normalized") or "").strip()
        ),
        None,
    )
    result: dict[str, Any] = {
        "sample_kind": sample.sample_kind,
        "source_object_key": sample.source_object_key,
        "source_filename": sample.source_filename,
        "normalized_path": str(sample.normalized_path),
        "target_format": sample.target_format,
        "extraction_strategy": extraction_outcome.extraction_strategy,
        "extraction_engine_name": extraction_outcome.provenance.engine_name,
        "extraction_engine_version": extraction_outcome.provenance.engine_version,
        "text_block_count": len(extraction_outcome.text_blocks),
        "layout_row_count": len(layout_rows),
        "row_type_counts": row_type_counts,
        "first_heading": first_heading,
        "table_count": len(table_rows),
        "verdict": "pass",
    }
    if sample.target_format == "docx":
        result["docx_validation"] = {
            "has_title_heading": bool(
                layout_rows
                and str(layout_rows[0].get("row_type") or "") == "heading"
                and int(layout_rows[0].get("heading_level") or 0) == 1
            ),
            "heading_count": row_type_counts.get("heading", 0),
            "list_item_count": row_type_counts.get("list_item", 0),
            "paragraph_count": row_type_counts.get("paragraph", 0),
            "table_count": len(table_rows),
        }
        if not (
            result["docx_validation"]["has_title_heading"]
            and result["docx_validation"]["heading_count"] >= 2
            and result["docx_validation"]["table_count"] >= 1
        ):
            result["verdict"] = "fail"
    else:
        table_cells = list(table_rows[0].get("table_cells") or []) if table_rows else []
        forward_filled_cells = [
            cell
            for cell in table_cells
            if isinstance(cell, Mapping) and bool(cell.get("is_forward_filled"))
        ]
        prefix_valid = validate_xlsx_forward_fill_prefix(
            [cell for cell in table_cells if isinstance(cell, Mapping)]
        )
        result["xlsx_validation"] = {
            "heading_count": row_type_counts.get("heading", 0),
            "table_count": len(table_rows),
            "forward_filled_cell_count": len(forward_filled_cells),
            "forward_fill_prefix_valid": prefix_valid,
            "table_row_count": int(table_rows[0].get("table_row_count") or 0) if table_rows else 0,
            "table_column_count": int(table_rows[0].get("table_column_count") or 0) if table_rows else 0,
        }
        if not (
            result["xlsx_validation"]["heading_count"] >= 1
            and result["xlsx_validation"]["table_count"] == 1
            and result["xlsx_validation"]["forward_filled_cell_count"] >= 1
            and result["xlsx_validation"]["forward_fill_prefix_valid"]
        ):
            result["verdict"] = "fail"
    return result


def _build_summary(results: Sequence[Mapping[str, object]]) -> str:
    lines = ["# OOXML Structured Normalization Recheck", ""]
    for result in results:
        lines.append(f"- source: `{result['source_object_key']}`")
        lines.append(f"  - normalized_path: `{result['normalized_path']}`")
        lines.append(f"  - target_format: `{result['target_format']}`")
        lines.append(f"  - extraction_strategy: `{result['extraction_strategy']}`")
        lines.append(
            f"  - extraction_engine: `{result['extraction_engine_name']}` `{result['extraction_engine_version']}`"
        )
        lines.append(f"  - layout_row_count: `{result['layout_row_count']}`")
        lines.append(f"  - row_type_counts: `{json.dumps(result['row_type_counts'], ensure_ascii=False)}`")
        if result.get("first_heading") is not None:
            lines.append(f"  - first_heading: `{result['first_heading']}`")
        if result["target_format"] == "xlsx":
            validation = dict(result.get("xlsx_validation") or {})
            lines.append(
                f"  - forward_filled_cell_count: `{validation.get('forward_filled_cell_count', 0)}`"
            )
            lines.append(
                f"  - forward_fill_prefix_valid: `{validation.get('forward_fill_prefix_valid', False)}`"
            )
        lines.append(f"  - verdict: `{result['verdict']}`")
    return "\n".join(lines).strip() + "\n"


def _build_quality_validation(results: Sequence[Mapping[str, object]]) -> str:
    lines = [
        "# OOXML Structured Quality Validation",
        "",
        "## Validation Summary",
        "",
    ]
    for result in results:
        lines.append(f"### {str(result['target_format']).upper()}")
        lines.append("")
        lines.append(f"- Sample: `{result['source_filename']}`")
        lines.append(f"- Verdict: `{result['verdict']}`")
        lines.append(f"- Extracted blocks: `{result['text_block_count']}`")
        lines.append(f"- Structured rows: `{result['layout_row_count']}`")
        lines.append(f"- Row type counts: `{json.dumps(result['row_type_counts'], ensure_ascii=False)}`")
        if result["target_format"] == "docx":
            validation = dict(result.get("docx_validation") or {})
            lines.append(f"- Title promoted to heading: `{validation.get('has_title_heading', False)}`")
            lines.append(f"- Heading count: `{validation.get('heading_count', 0)}`")
            lines.append(f"- List item count: `{validation.get('list_item_count', 0)}`")
            lines.append(f"- Table count: `{validation.get('table_count', 0)}`")
        else:
            validation = dict(result.get("xlsx_validation") or {})
            lines.append(f"- Heading count: `{validation.get('heading_count', 0)}`")
            lines.append(f"- Table count: `{validation.get('table_count', 0)}`")
            lines.append(
                f"- Forward-filled cells: `{validation.get('forward_filled_cell_count', 0)}`"
            )
            lines.append(
                f"- Forward-fill prefix valid: `{validation.get('forward_fill_prefix_valid', False)}`"
            )
            lines.append(f"- Table rows: `{validation.get('table_row_count', 0)}`")
            lines.append(f"- Table columns: `{validation.get('table_column_count', 0)}`")
        lines.append("")
    overall_verdict = "pass" if all(str(result.get("verdict") or "") == "pass" for result in results) else "fail"
    lines.extend(
        [
            "## Assessment",
            "",
            f"Overall verdict: `{overall_verdict}`",
            "",
            "This recheck verifies that:",
            "",
            "- source-faithful OOXML extraction still works on the real authenticated_notice sample set",
            "- post-extraction structured normalization now emits retrieval-grade layout rows",
            "- real DOCX samples no longer stop at flat paragraphs only",
            "- XLSX continuation handling now forward-fills only the leading repeated cells, not arbitrary interior blanks",
        ]
    )
    return "\n".join(lines).strip() + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
