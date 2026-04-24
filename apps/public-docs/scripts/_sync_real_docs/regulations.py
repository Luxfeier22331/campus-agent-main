from __future__ import annotations

import json
import re
import shutil
from hashlib import sha1

from .shared import PublicRegulationDoc, _format_json_content, _remove_stale_generated_files
from .storage import _list_object_keys, _read_text_object

_PUBLIC_REGULATION_COLLECTIONS = {
    "institutional_rules": "学校规章",
    "scoped_rules": "专项规则",
}
_REGULATION_ROUTE_PREFIX = "campus-regulation"
_MARKDOWN_HEADING_RE = re.compile(r"^\s*#+\s*(?P<text>.+?)\s*$")


def _build_public_regulation_index() -> str:
    return "\n".join(
        [
            "---",
            "title: 校内规章",
            "description: 当前公开阅读面中已显式 admission 的校内规章目录。",
            "---",
            "",
            "这里仅展示已明确标记为公开可发布的规章制度文档。",
            "",
            "认证内网来源、带有受限 entitlement 的制度文档不会进入当前公开文档站。",
            "",
        ]
    )


def _discover_public_regulation_docs(client) -> tuple[PublicRegulationDoc, ...]:
    docs: list[PublicRegulationDoc] = []
    seen_slugs: set[str] = set()
    for collection, collection_label in _PUBLIC_REGULATION_COLLECTIONS.items():
        prefix = f"regulations/documents/{collection}/"
        for key in _list_object_keys(client, prefix=prefix):
            if not key.endswith("/document-units.jsonl"):
                continue
            jsonl_text = _read_text_object(client=client, key=key)
            if not _is_explicit_public_regulation_doc(jsonl_text):
                continue
            doc_id = _resolve_regulation_doc_id(jsonl_text, key=key)
            title = _resolve_regulation_doc_title(jsonl_text, key=key)
            slug = _build_public_regulation_doc_slug(
                collection=collection,
                doc_id=doc_id,
                title=title,
            )
            if slug in seen_slugs:
                slug = f"{slug}-{sha1(doc_id.encode('utf-8')).hexdigest()[:10]}"
            if slug in seen_slugs:
                raise ValueError(f"duplicate public regulation slug discovered: {slug}")
            seen_slugs.add(slug)
            docs.append(
                PublicRegulationDoc(
                    slug=slug,
                    title=title,
                    key=key,
                    collection=collection,
                    collection_label=collection_label,
                )
            )
    return tuple(sorted(docs, key=lambda item: (item.collection_label, item.title)))


def _build_public_regulation_markdown(
    *,
    doc: PublicRegulationDoc,
    jsonl_text: str,
) -> str:
    lines = [
        "---",
        f"title: {json.dumps(doc.title, ensure_ascii=False)}",
        "corpus: regulations",
        f"collection: {doc.collection}",
        f"collectionLabel: {json.dumps(doc.collection_label, ensure_ascii=False)}",
        "---",
        "",
    ]
    wrote_body = False
    for row in _iter_rows(jsonl_text):
        row_type = str(row.get("row_type") or "").strip()
        text = _normalize_text(row.get("clean_text"))
        if not text or row_type == "page_number":
            continue
        if row_type == "heading":
            heading_text = _normalize_heading_text(text)
            if heading_text == doc.title and not wrote_body:
                continue
            lines.extend([f"## {heading_text}", ""])
            wrote_body = True
            continue
        if row_type == "table":
            html = _normalize_text(row.get("html")) or text
            lines.extend([html, ""])
            wrote_body = True
            continue
        lines.extend([text, ""])
        wrote_body = True
    return "\n".join(lines).rstrip() + "\n"


def _sync_public_regulation_docs(
    client,
    *,
    docs_root,
    regulation_docs: tuple[PublicRegulationDoc, ...] | None = None,
) -> tuple[PublicRegulationDoc, ...]:
    target_dir = docs_root / "campus-regulations"
    if regulation_docs is None:
        regulation_docs = _discover_public_regulation_docs(client)
    if not regulation_docs:
        if target_dir.exists():
            shutil.rmtree(target_dir)
        return ()

    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "_meta.json").write_text(
        _format_json_content(["index", *[doc.slug for doc in regulation_docs]]),
        encoding="utf-8",
    )
    (target_dir / "index.md").write_text(_build_public_regulation_index(), encoding="utf-8")
    for doc in regulation_docs:
        jsonl_text = _read_text_object(client=client, key=doc.key)
        markdown = _build_public_regulation_markdown(doc=doc, jsonl_text=jsonl_text)
        (target_dir / f"{doc.slug}.md").write_text(markdown, encoding="utf-8")
    _remove_stale_generated_files(
        target_dir,
        expected_names={
            "_meta.json",
            "index.md",
            *[f"{doc.slug}.md" for doc in regulation_docs],
        },
    )
    return regulation_docs


def _is_explicit_public_regulation_doc(jsonl_text: str) -> bool:
    rows = tuple(_iter_rows(jsonl_text))
    if not rows:
        return False
    for row in rows:
        visibility_level = _normalize_text(row.get("visibility_level"))
        entitlement_groups = row.get("entitlement_groups")
        if visibility_level != "public":
            return False
        if isinstance(entitlement_groups, list) and entitlement_groups:
            return False
        if entitlement_groups not in (None, [], ()):
            return False
    return True


def _resolve_regulation_doc_id(jsonl_text: str, *, key: str) -> str:
    for row in _iter_rows(jsonl_text):
        doc_id = _normalize_text(row.get("doc_id"))
        if doc_id:
            return doc_id
    raise ValueError(f"doc_id is required in regulation document-units: {key}")


def _resolve_regulation_doc_title(jsonl_text: str, *, key: str) -> str:
    doc_id = ""
    for row in _iter_rows(jsonl_text):
        if not doc_id:
            doc_id = _normalize_text(row.get("doc_id"))
        metadata = row.get("metadata")
        if isinstance(metadata, dict):
            metadata_title = _normalize_text(metadata.get("title"))
            if metadata_title:
                return metadata_title
        if str(row.get("row_type") or "") == "heading":
            heading_text = _normalize_heading_text(row.get("clean_text"))
            if heading_text:
                return heading_text
    if doc_id:
        return doc_id.split(":")[-2] if ":" in doc_id else doc_id
    raise ValueError(f"unable to resolve regulation title from: {key}")


def _build_public_regulation_doc_slug(*, collection: str, doc_id: str, title: str) -> str:
    title_slug = re.sub(r"[_\W]+", "-", title, flags=re.UNICODE).strip("-")
    collection_slug = collection.replace("_", "-")
    if title_slug:
        return f"{_REGULATION_ROUTE_PREFIX}-{collection_slug}-{title_slug}"
    return f"{_REGULATION_ROUTE_PREFIX}-{collection_slug}-{sha1(doc_id.encode('utf-8')).hexdigest()[:10]}"


def _normalize_heading_text(value: object) -> str:
    text = _normalize_text(value)
    match = _MARKDOWN_HEADING_RE.match(text)
    return match.group("text").strip() if match else text


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _iter_rows(jsonl_text: str):
    for line in jsonl_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        yield json.loads(stripped)
