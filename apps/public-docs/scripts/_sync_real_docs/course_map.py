from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import asdict
from hashlib import sha1
from pathlib import Path

from .shared import (
    _COURSE_MAP_EXTENSION_KEYWORDS,
    _COURSE_MAP_FOUNDATION_KEYWORDS,
    _COURSE_MAP_PRACTICE_KEYWORDS,
    REPO_ROOT,
    CourseMapDocEmbed,
    CurriculumDoc,
    _format_js_object_literal,
    _remove_stale_generated_files,
    _write_text,
)
from .storage import _read_optional_bytes_object


def _sync_curriculum_course_map_artifacts(
    client,
    *,
    curriculum_docs: tuple[CurriculumDoc, ...],
    docs_root: Path,
) -> dict[str, CourseMapDocEmbed]:
    from campus_ingestion_core.curriculum_course_map_docs_surface import (
        build_curriculum_course_map_docs_surface_object_key,
        load_curriculum_course_map_docs_surface,
    )

    generated_dir = docs_root / ".generated" / "course-maps"
    public_root = docs_root / "public" / "course-maps"
    generated_dir.mkdir(parents=True, exist_ok=True)
    public_root.mkdir(parents=True, exist_ok=True)

    embeds: dict[str, CourseMapDocEmbed] = {}
    expected_data_files: set[str] = set()
    expected_public_dirs: set[str] = set()
    for doc in curriculum_docs:
        surface_key = build_curriculum_course_map_docs_surface_object_key(doc.key)
        surface_bytes = _read_optional_bytes_object(client=client, key=surface_key)
        if surface_bytes is None:
            continue
        surface = load_curriculum_course_map_docs_surface(surface_bytes)
        if not surface.blocks:
            continue
        data_module_name = f"{doc.slug}.data.ts"
        image_dir = public_root / doc.slug
        image_dir.mkdir(parents=True, exist_ok=True)
        data_payload = _build_course_map_data_payload(surface=surface, public_slug=doc.slug)
        for block in surface.blocks:
            image_bytes = _read_optional_bytes_object(client=client, key=block.image_object_key)
            if image_bytes is None:
                raise ValueError(
                    f"missing published course-map image object for {doc.slug}: {block.image_object_key}"
                )
            image_path = image_dir / Path(block.image_object_key).name
            image_path.write_bytes(image_bytes)
        _write_text(
            generated_dir / data_module_name,
            _build_course_map_data_module(
                data_payload,
                biome_file_path=f"apps/public-docs/docs/.generated/course-maps/{data_module_name}",
            ),
        )
        expected_data_files.add(data_module_name)
        expected_public_dirs.add(doc.slug)
        embeds[doc.slug] = CourseMapDocEmbed(
            component_import_path="../.components/CourseMapSection",
            data_import_path=f"../.generated/course-maps/{doc.slug}.data",
            data_import_name=_build_course_map_data_import_name(doc.slug),
        )

    _remove_stale_generated_files(generated_dir, expected_names=expected_data_files)
    for path in public_root.iterdir():
        if path.is_dir() and path.name not in expected_public_dirs:
            shutil.rmtree(path)
    return embeds


def _build_course_map_section_block(course_map_embed: CourseMapDocEmbed) -> str:
    return f"<CourseMapSection data={{{course_map_embed.data_import_name}}} />"


def _build_course_map_data_import_name(slug: str) -> str:
    parts = [part for part in re.split(r"[^a-zA-Z0-9]+", slug) if part]
    if not parts:
        return "courseMapData" + sha1(slug.encode("utf-8")).hexdigest()[:8]
    head, *tail = parts
    return head + "".join(part[:1].upper() + part[1:] for part in tail) + "Data"


def _build_course_map_data_module(
    payload: dict[str, object],
    *,
    biome_file_path: str,
) -> str:
    content = "\n".join(
        [
            "const data = " + _format_js_object_literal(payload) + " as const;",
            "",
            "export default data;",
            "",
        ]
    )
    return _format_with_biome(content, biome_file_path=biome_file_path)


def _format_with_biome(content: str, *, biome_file_path: str) -> str:
    completed = subprocess.run(
        [
            "pnpm",
            "exec",
            "biome",
            "format",
            "--stdin-file-path",
            biome_file_path,
        ],
        cwd=REPO_ROOT,
        input=content,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or "unknown biome error"
        raise RuntimeError(f"failed to format {biome_file_path} with Biome: {stderr}")
    return completed.stdout


def _build_course_map_data_payload(*, surface, public_slug: str) -> dict[str, object]:
    return {
        "generatedAt": surface.generated_at,
        "documentTitle": surface.document_title,
        "documentId": surface.document_id,
        "rawAssetId": surface.raw_asset_id,
        "rawVersionId": surface.raw_version_id,
        "blocks": [
            _build_course_map_block_payload(block=block, public_slug=public_slug)
            for block in surface.blocks
        ],
    }


def _build_course_map_block_payload(*, block, public_slug: str) -> dict[str, object]:
    edges = [asdict(edge) for edge in block.edges]
    incoming_counts: dict[str, int] = {}
    outgoing_counts: dict[str, int] = {}
    for edge in edges:
        source_label = str(edge.get("source_label") or "").strip()
        target_label = str(edge.get("target_label") or "").strip()
        if source_label:
            outgoing_counts[source_label] = outgoing_counts.get(source_label, 0) + 1
        if target_label:
            incoming_counts[target_label] = incoming_counts.get(target_label, 0) + 1
    return {
        "blockId": block.block_id,
        "title": block.title,
        "status": block.status,
        "titleConfidence": block.title_confidence,
        "pageNumber": block.page_number,
        "rowId": block.row_id,
        "mapIndex": block.map_index,
        "parentHeadingHint": block.parent_heading_hint,
        "displayStageLabels": list(block.display_stage_labels),
        "extractionNotes": list(block.extraction_notes),
        "imageSrc": f"/course-maps/{public_slug}/{Path(block.image_object_key).name}",
        "nodes": [
            {
                **asdict(node),
                "route_group": _infer_course_map_route_group(node.node_label),
                "incoming_count": incoming_counts.get(node.node_label, 0),
                "outgoing_count": outgoing_counts.get(node.node_label, 0),
            }
            for node in block.nodes
        ],
        "edges": edges,
    }


def _infer_course_map_route_group(node_label: str) -> str:
    normalized = node_label.strip()
    if any(keyword in normalized for keyword in _COURSE_MAP_PRACTICE_KEYWORDS):
        return "practice"
    if any(keyword in normalized for keyword in _COURSE_MAP_EXTENSION_KEYWORDS):
        return "extension"
    if any(keyword in normalized for keyword in _COURSE_MAP_FOUNDATION_KEYWORDS):
        return "foundation"
    return "core"
