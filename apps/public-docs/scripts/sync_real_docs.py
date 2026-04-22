from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def _load_sync_exports() -> None:
    global CourseMapDocEmbed
    global DOCS_ROOT
    global REPO_ROOT
    global HandbookDoc
    global _build_course_map_data_import_name
    global _build_course_map_data_module
    global _build_course_map_data_payload
    global _build_curriculum_markdown
    global _build_curriculum_plan_index
    global _build_handbook_doc_key
    global _build_handbook_index
    global _build_home_page
    global _clean_handbook_markdown
    global _create_s3_client
    global _discover_curriculum_docs
    global _format_json_content
    global _infer_course_map_route_group
    global _load_handbook_docs
    global _read_text_object
    global _remove_legacy_section_dirs_impl
    global _remove_stale_generated_files
    global _resolve_curriculum_doc_title
    global _sync_curriculum_course_map_artifacts
    global _write_text

    from _sync_real_docs import (
        DOCS_ROOT,
        REPO_ROOT,
        CourseMapDocEmbed,
        HandbookDoc,
        _build_course_map_data_import_name,
        _build_course_map_data_module,
        _build_course_map_data_payload,
        _build_curriculum_markdown,
        _build_curriculum_plan_index,
        _build_handbook_index,
        _build_home_page,
        _clean_handbook_markdown,
        _create_s3_client,
        _discover_curriculum_docs,
        _format_json_content,
        _infer_course_map_route_group,
        _load_handbook_docs,
        _read_text_object,
        _remove_stale_generated_files,
        _resolve_curriculum_doc_title,
        _sync_curriculum_course_map_artifacts,
        _write_text,
    )
    from _sync_real_docs import (
        _remove_legacy_section_dirs as _remove_legacy_section_dirs_impl,
    )
    from _sync_real_docs.handbook import _build_handbook_doc_key


_load_sync_exports()


def main() -> None:
    from campus_ingestion_worker.env_bootstrap import load_worker_env

    load_worker_env(repo_root=REPO_ROOT)
    client = _create_s3_client()
    handbook_docs = _load_handbook_docs()
    curriculum_docs = _discover_curriculum_docs(client)

    _remove_legacy_section_dirs()
    _write_text(
        DOCS_ROOT / "_meta.json",
        _format_json_content(
            [
                "index",
                {"type": "dir", "name": "student-handbook", "label": "学生手册"},
                {"type": "dir", "name": "curriculum-plan", "label": "培养方案"},
            ]
        ),
    )
    _write_text(DOCS_ROOT / "index.md", _build_home_page())
    _sync_handbook_docs(client, handbook_docs=handbook_docs)
    _sync_curriculum_docs(client, curriculum_docs=curriculum_docs)


def _sync_handbook_docs(client, *, handbook_docs: tuple[HandbookDoc, ...] | None = None) -> None:
    target_dir = DOCS_ROOT / "student-handbook"
    target_dir.mkdir(parents=True, exist_ok=True)
    handbook_docs = handbook_docs or _load_handbook_docs()

    _write_text(
        target_dir / "_meta.json",
        _format_json_content(["index", *[doc.slug for doc in handbook_docs]]),
    )
    _write_text(target_dir / "index.md", _build_handbook_index())

    for doc in handbook_docs:
        markdown = _clean_handbook_markdown(
            _read_text_object(client=client, key=_build_handbook_doc_key(doc))
        )
        _write_text(target_dir / f"{doc.slug}.md", markdown)
    _remove_stale_generated_files(
        target_dir,
        expected_names={"_meta.json", "index.md", *[f"{doc.slug}.md" for doc in handbook_docs]},
    )


def _sync_curriculum_docs(client, *, curriculum_docs) -> None:
    target_dir = DOCS_ROOT / "curriculum-plan"
    target_dir.mkdir(parents=True, exist_ok=True)
    course_map_embeds = _sync_curriculum_course_map_artifacts(
        client,
        curriculum_docs=curriculum_docs,
        docs_root=DOCS_ROOT,
    )

    _write_text(
        target_dir / "_meta.json",
        _format_json_content(["index", *[doc.slug for doc in curriculum_docs]]),
    )
    _write_text(target_dir / "index.md", _build_curriculum_plan_index())

    for doc in curriculum_docs:
        jsonl_text = _read_text_object(client=client, key=doc.key)
        markdown = _build_curriculum_markdown(
            slug=doc.slug,
            title=doc.title,
            jsonl_text=jsonl_text,
            course_map_embed=course_map_embeds.get(doc.slug),
        )
        _write_text(target_dir / f"{doc.slug}.mdx", markdown)
    _remove_stale_generated_files(
        target_dir,
        expected_names={"_meta.json", "index.md", *[f"{doc.slug}.mdx" for doc in curriculum_docs]},
    )


def _remove_legacy_section_dirs() -> None:
    _remove_legacy_section_dirs_impl(DOCS_ROOT)


if __name__ == "__main__":
    main()
