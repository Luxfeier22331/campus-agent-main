from __future__ import annotations

import math
from io import BytesIO
from pathlib import Path

from PIL import Image

from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    DEFAULT_REGION_TILE_COLS,
    DEFAULT_REGION_TILE_ROWS,
    DEFAULT_RENDER_DPI,
    DEFAULT_TILE_OVERLAP_RATIO,
    CurriculumCourseMapInventoryEntry,
    CurriculumCourseMapRenderedRegion,
    CurriculumCourseMapRenderedSample,
    DetectedCourseMapRegion,
)


def render_curriculum_course_map_sample(
    *,
    pdf_bytes: bytes,
    entry: CurriculumCourseMapInventoryEntry,
    sample_id: str,
    output_dir: Path | None = None,
) -> CurriculumCourseMapRenderedSample:
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pymupdf is required for curriculum course-map rendering") from exc

    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if entry.page_number > document.page_count:
            raise ValueError(
                f"page {entry.page_number} exceeds PDF page_count {document.page_count}"
            )
        page = document.load_page(entry.page_number - 1)
        page_rect = page.rect
        provider_canvas = derive_provider_canvas(
            pdf_page_width=page_rect.width,
            pdf_page_height=page_rect.height,
            provider_page_height=entry.provider_page_height,
        )
        pdf_bbox = project_provider_bbox_to_pdf_rect(
            provider_bbox=entry.bbox_provider,
            provider_canvas=provider_canvas,
            pdf_page_width=page_rect.width,
            pdf_page_height=page_rect.height,
        )
        full_page_png = page.get_pixmap(dpi=DEFAULT_RENDER_DPI, alpha=False).tobytes("png")
        crop_png = page.get_pixmap(
            dpi=DEFAULT_RENDER_DPI,
            alpha=False,
            clip=fitz.Rect(*pdf_bbox),
        ).tobytes("png")

    full_page_image_path = None
    crop_image_path = None
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        full_page_path = output_dir / f"{sample_id}-page-{entry.page_number}.png"
        crop_path = output_dir / f"{sample_id}-page-{entry.page_number}-crop.png"
        full_page_path.write_bytes(full_page_png)
        crop_path.write_bytes(crop_png)
        full_page_image_path = str(full_page_path.resolve())
        crop_image_path = str(crop_path.resolve())
    return CurriculumCourseMapRenderedSample(
        sample_id=sample_id,
        page_number=entry.page_number,
        document_id=entry.document_id,
        document_title=entry.document_title,
        row_id=entry.row_id,
        parent_heading_hint=entry.parent_heading_hint,
        provider_bbox=entry.bbox_provider,
        provider_canvas=provider_canvas,
        pdf_bbox=pdf_bbox,
        full_page_png=full_page_png,
        crop_png=crop_png,
        full_page_image_path=full_page_image_path,
        crop_image_path=crop_image_path,
    )


def derive_provider_canvas(
    *,
    pdf_page_width: float,
    pdf_page_height: float,
    provider_page_height: float,
) -> tuple[float, float]:
    if pdf_page_width <= 0 or pdf_page_height <= 0:
        raise ValueError("pdf page dimensions must be positive")
    if provider_page_height <= 0:
        raise ValueError("provider_page_height must be positive")
    provider_width = provider_page_height * (pdf_page_width / pdf_page_height)
    return (provider_width, provider_page_height)


def project_provider_bbox_to_pdf_rect(
    *,
    provider_bbox: tuple[float, float, float, float],
    provider_canvas: tuple[float, float],
    pdf_page_width: float,
    pdf_page_height: float,
) -> tuple[float, float, float, float]:
    canvas_width, canvas_height = provider_canvas
    if canvas_width <= 0 or canvas_height <= 0:
        raise ValueError("provider canvas must be positive")
    if pdf_page_width <= 0 or pdf_page_height <= 0:
        raise ValueError("pdf page dimensions must be positive")
    x0, y0, x1, y1 = provider_bbox
    if x1 <= x0 or y1 <= y0:
        raise ValueError("provider bbox must have positive area")
    scale_x = pdf_page_width / canvas_width
    scale_y = pdf_page_height / canvas_height
    return (
        max(0.0, x0 * scale_x),
        max(0.0, y0 * scale_y),
        min(pdf_page_width, x1 * scale_x),
        min(pdf_page_height, y1 * scale_y),
    )


def _build_rendered_region(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    detected_region: DetectedCourseMapRegion,
    output_dir: Path | None,
) -> CurriculumCourseMapRenderedRegion:
    crop_png = _crop_png_with_normalized_bbox(
        image_bytes=rendered_sample.crop_png,
        normalized_bbox=detected_region.region_bbox_normalized,
    )
    tile_pngs = _build_region_tiles(crop_png)
    crop_image_path = None
    tile_image_paths: list[str] = []
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        crop_path = output_dir / f"map-{detected_region.map_index:02d}.png"
        crop_path.write_bytes(crop_png)
        crop_image_path = str(crop_path.resolve())
        for tile_index, tile_png in enumerate(tile_pngs, start=1):
            tile_path = (
                output_dir / f"map-{detected_region.map_index:02d}-tile-{tile_index:02d}.png"
            )
            tile_path.write_bytes(tile_png)
            tile_image_paths.append(str(tile_path.resolve()))
    return CurriculumCourseMapRenderedRegion(
        detected_region=detected_region,
        crop_png=crop_png,
        tile_pngs=tile_pngs,
        crop_image_path=crop_image_path,
        tile_image_paths=tuple(tile_image_paths),
    )


def _crop_png_with_normalized_bbox(
    *,
    image_bytes: bytes,
    normalized_bbox: tuple[float, float, float, float],
) -> bytes:
    with Image.open(BytesIO(image_bytes)) as image:
        width, height = image.size
        x0 = max(0, min(width - 1, int(math.floor(normalized_bbox[0] * width))))
        y0 = max(0, min(height - 1, int(math.floor(normalized_bbox[1] * height))))
        x1 = max(x0 + 1, min(width, int(math.ceil(normalized_bbox[2] * width))))
        y1 = max(y0 + 1, min(height, int(math.ceil(normalized_bbox[3] * height))))
        cropped = image.crop((x0, y0, x1, y1))
        buffer = BytesIO()
        cropped.save(buffer, format="PNG")
        return buffer.getvalue()


def _build_region_tiles(image_bytes: bytes) -> tuple[bytes, ...]:
    with Image.open(BytesIO(image_bytes)) as image:
        width, height = image.size
        tile_width = max(1, math.ceil(width / DEFAULT_REGION_TILE_COLS))
        tile_height = max(1, math.ceil(height / DEFAULT_REGION_TILE_ROWS))
        overlap_x = math.floor(tile_width * DEFAULT_TILE_OVERLAP_RATIO)
        overlap_y = math.floor(tile_height * DEFAULT_TILE_OVERLAP_RATIO)
        tiles: list[bytes] = []
        for row in range(DEFAULT_REGION_TILE_ROWS):
            for col in range(DEFAULT_REGION_TILE_COLS):
                x0 = max(0, col * tile_width - overlap_x)
                y0 = max(0, row * tile_height - overlap_y)
                x1 = min(width, (col + 1) * tile_width + overlap_x)
                y1 = min(height, (row + 1) * tile_height + overlap_y)
                tile = image.crop((x0, y0, x1, y1))
                buffer = BytesIO()
                tile.save(buffer, format="PNG")
                tiles.append(buffer.getvalue())
        return tuple(tiles)


def _project_normalized_crop_bbox_to_sample_bboxes(
    *,
    normalized_bbox: tuple[float, float, float, float],
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    crop_pdf_x0, crop_pdf_y0, crop_pdf_x1, crop_pdf_y1 = rendered_sample.pdf_bbox
    crop_provider_x0, crop_provider_y0, crop_provider_x1, crop_provider_y1 = (
        rendered_sample.provider_bbox
    )
    width_pdf = crop_pdf_x1 - crop_pdf_x0
    height_pdf = crop_pdf_y1 - crop_pdf_y0
    width_provider = crop_provider_x1 - crop_provider_x0
    height_provider = crop_provider_y1 - crop_provider_y0
    pdf_bbox = (
        crop_pdf_x0 + width_pdf * normalized_bbox[0],
        crop_pdf_y0 + height_pdf * normalized_bbox[1],
        crop_pdf_x0 + width_pdf * normalized_bbox[2],
        crop_pdf_y0 + height_pdf * normalized_bbox[3],
    )
    provider_bbox = (
        crop_provider_x0 + width_provider * normalized_bbox[0],
        crop_provider_y0 + height_provider * normalized_bbox[1],
        crop_provider_x0 + width_provider * normalized_bbox[2],
        crop_provider_y0 + height_provider * normalized_bbox[3],
    )
    return pdf_bbox, provider_bbox


__all__ = [
    "_build_region_tiles",
    "_build_rendered_region",
    "_crop_png_with_normalized_bbox",
    "_project_normalized_crop_bbox_to_sample_bboxes",
    "derive_provider_canvas",
    "project_provider_bbox_to_pdf_rect",
    "render_curriculum_course_map_sample",
]
