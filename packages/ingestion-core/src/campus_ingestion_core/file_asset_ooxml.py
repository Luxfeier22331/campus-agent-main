from __future__ import annotations

from dataclasses import dataclass
import hashlib
from importlib import metadata
from io import BytesIO
import posixpath
from xml.etree import ElementTree
import zipfile

from campus_ingestion_core.file_asset_contract import (
    ArtifactProvenance,
    ExtractionOutcome,
    FileAssetDescriptor,
)


_DOCX_DOCUMENT_PATH = "word/document.xml"
_WORDPROCESSINGML_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_XLSX_WORKBOOK_PATH = "xl/workbook.xml"
_XLSX_WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels"
_XLSX_SHARED_STRINGS_PATH = "xl/sharedStrings.xml"
_SPREADSHEETML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_OFFICE_DOC_REL_ID_ATTR = (
    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
)
_DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@dataclass(frozen=True, slots=True)
class OoxmlTextExtractionResult(ExtractionOutcome):
    pass


@dataclass(frozen=True, slots=True)
class _XlsxCellValue:
    text: str
    formula: str | None = None


def extract_docx_text_blocks(
    file_bytes: bytes,
    *,
    filename: str = "attachment.docx",
    source_object_key: str | None = None,
    media_type: str = _DOCX_MEDIA_TYPE,
) -> OoxmlTextExtractionResult:
    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("python-docx is required for docx extraction") from exc

    document = Document(BytesIO(file_bytes))
    blocks: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            blocks.append(text)
    for table in document.tables:
        rows: list[str] = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                rows.append(" | ".join(cells))
        if rows:
            blocks.append("\n".join(rows))
    if not blocks:
        raise ValueError("docx attachment produced no extractable text")
    return OoxmlTextExtractionResult(
        descriptor=FileAssetDescriptor(
            asset_family="modern_ooxml",
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
            source_sha256=hashlib.sha256(file_bytes).hexdigest(),
        ),
        provenance=ArtifactProvenance(
            engine_name="python-docx",
            engine_version=_read_package_version("python-docx"),
        ),
        text_blocks=tuple(blocks),
        extraction_strategy="docx_structured_blocks",
    )


def extract_xlsx_text_blocks(
    file_bytes: bytes,
    *,
    filename: str = "attachment.xlsx",
    source_object_key: str | None = None,
    media_type: str = _XLSX_MEDIA_TYPE,
) -> OoxmlTextExtractionResult:
    try:
        with zipfile.ZipFile(BytesIO(file_bytes)) as archive:
            workbook_xml = archive.read(_XLSX_WORKBOOK_PATH)
            workbook_root = ElementTree.fromstring(workbook_xml)
            workbook_relationship_targets = _load_xlsx_workbook_relationship_targets(archive)
            shared_strings = _load_xlsx_shared_strings(archive)
            blocks: list[str] = []
            for sheet in workbook_root.findall(f".//{_SPREADSHEETML_NS}sheet"):
                rel_id = sheet.attrib.get(_OFFICE_DOC_REL_ID_ATTR)
                if not rel_id:
                    continue
                worksheet_target = workbook_relationship_targets.get(rel_id)
                if worksheet_target is None:
                    continue
                worksheet_path = _resolve_xlsx_zip_member_path(
                    base_path=_XLSX_WORKBOOK_PATH,
                    target=worksheet_target,
                )
                sheet_xml = archive.read(worksheet_path)
                sheet_rows = _load_xlsx_sheet_rows(
                    sheet_xml=sheet_xml,
                    shared_strings=shared_strings,
                )
                if not sheet_rows:
                    continue
                sheet_name = (sheet.attrib.get("name") or "").strip()
                blocks.append(_serialize_spreadsheet_sheet_block(sheet_name, sheet_rows))
    except KeyError as exc:
        raise ValueError("xlsx workbook.xml is required") from exc
    if not blocks:
        raise ValueError("xlsx attachment produced no extractable text")
    return OoxmlTextExtractionResult(
        descriptor=FileAssetDescriptor(
            asset_family="modern_ooxml",
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
            source_sha256=hashlib.sha256(file_bytes).hexdigest(),
        ),
        provenance=ArtifactProvenance(
            engine_name="spreadsheetml-zip-xml",
            engine_version="spreadsheetml-zip-xml-v1",
        ),
        text_blocks=tuple(blocks),
        extraction_strategy="xlsx_structured_blocks",
    )


def _load_xlsx_workbook_relationship_targets(archive: zipfile.ZipFile) -> dict[str, str]:
    try:
        relationships_root = ElementTree.fromstring(archive.read(_XLSX_WORKBOOK_RELS_PATH))
    except KeyError:
        return {}
    return {
        str(node.attrib.get("Id") or "").strip(): str(node.attrib.get("Target") or "").strip()
        for node in relationships_root.findall(f"{_PACKAGE_REL_NS}Relationship")
        if str(node.attrib.get("Id") or "").strip() and str(node.attrib.get("Target") or "").strip()
    }


def _load_xlsx_shared_strings(archive: zipfile.ZipFile) -> tuple[str, ...]:
    try:
        shared_strings_root = ElementTree.fromstring(archive.read(_XLSX_SHARED_STRINGS_PATH))
    except KeyError:
        return ()
    values: list[str] = []
    for node in shared_strings_root.findall(f"{_SPREADSHEETML_NS}si"):
        values.append(
            "".join(text_node.text or "" for text_node in node.iter(f"{_SPREADSHEETML_NS}t")).strip()
        )
    return tuple(values)


def _resolve_xlsx_zip_member_path(*, base_path: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_path), target))


def _load_xlsx_sheet_rows(
    *,
    sheet_xml: bytes,
    shared_strings: tuple[str, ...],
) -> tuple[str, ...]:
    root = ElementTree.fromstring(sheet_xml)
    rows: list[str] = []
    for row in root.findall(f".//{_SPREADSHEETML_NS}row"):
        cells: dict[int, _XlsxCellValue] = {}
        for cell in row.findall(f"{_SPREADSHEETML_NS}c"):
            value = _load_xlsx_cell_value(cell=cell, shared_strings=shared_strings)
            if value is None:
                continue
            column_index = _xlsx_column_index(cell.attrib.get("r"))
            cells[column_index] = value
        serialized = _serialize_spreadsheet_row(cells)
        if serialized is not None:
            rows.append(serialized)
    return tuple(rows)


def _load_xlsx_cell_value(
    *,
    cell,
    shared_strings: tuple[str, ...],
) -> _XlsxCellValue | None:
    cell_type = str(cell.attrib.get("t") or "").strip()
    formula_node = cell.find(f"{_SPREADSHEETML_NS}f")
    formula = None
    if formula_node is not None and formula_node.text is not None:
        formula = formula_node.text.strip() or None

    if cell_type == "inlineStr":
        value = "".join(text_node.text or "" for text_node in cell.iter(f"{_SPREADSHEETML_NS}t")).strip()
        if not value:
            return None
        return _XlsxCellValue(text=value, formula=formula)

    value_node = cell.find(f"{_SPREADSHEETML_NS}v")
    if value_node is None or value_node.text is None:
        return _XlsxCellValue(text=f"[formula={formula}]", formula=formula) if formula else None
    raw_value = value_node.text.strip()
    if not raw_value:
        return _XlsxCellValue(text=f"[formula={formula}]", formula=formula) if formula else None
    if cell_type == "s":
        try:
            shared_string = shared_strings[int(raw_value)]
        except (IndexError, ValueError):
            text = raw_value
        else:
            text = shared_string or raw_value
        return _XlsxCellValue(text=text, formula=formula)
    if cell_type == "b":
        return _XlsxCellValue(text="TRUE" if raw_value == "1" else "FALSE", formula=formula)
    return _XlsxCellValue(text=raw_value, formula=formula)


def _xlsx_column_index(cell_ref: str | None) -> int:
    if cell_ref is None:
        return 0
    letters = "".join(character for character in cell_ref if character.isalpha()).upper()
    if not letters:
        return 0
    value = 0
    for character in letters:
        value = value * 26 + (ord(character) - ord("A") + 1)
    return value - 1


def _serialize_spreadsheet_sheet_block(sheet_name: str, rows: tuple[str, ...]) -> str:
    if sheet_name:
        return f"{sheet_name}\n" + "\n".join(rows)
    return "\n".join(rows)


def _serialize_spreadsheet_row(cells: dict[int, _XlsxCellValue]) -> str | None:
    if not cells:
        return None
    max_index = max(cells)
    values: list[str] = []
    for index in range(max_index + 1):
        cell = cells.get(index)
        if cell is None:
            values.append("")
            continue
        text = cell.text
        if cell.formula:
            text = f"{text} [formula={cell.formula}]"
        values.append(text)
    return " | ".join(value.strip() for value in values).strip()


def _read_package_version(distribution_name: str) -> str:
    try:
        return metadata.version(distribution_name)
    except metadata.PackageNotFoundError:  # pragma: no cover
        return "unknown"


__all__ = [
    "OoxmlTextExtractionResult",
    "extract_docx_text_blocks",
    "extract_xlsx_text_blocks",
]
