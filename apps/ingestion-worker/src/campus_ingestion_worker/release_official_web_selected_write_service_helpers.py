from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

from campus_ingestion_worker.release_official_web_selected_write_common import (
    _candidate_public_source_ref,
    _mapping_list,
    _object_mapping,
    _string_list,
    _unique_strings,
)


def _with_public_service_guide_source_refs(
    *,
    record: dict[str, object],
    selected_write_task: dict[str, object],
    public_source_refs: list[str],
) -> dict[str, object]:
    source_refs = _unique_strings([*_string_list(record.get("source_refs")), *public_source_refs])
    primary_source_ref = source_refs[0]

    def replace_item_sources(value: object) -> list[dict[str, object]]:
        return [
            {
                **item,
                "source_refs": _public_item_source_refs(
                    item=item,
                    public_source_refs=source_refs,
                    fallback_source_ref=primary_source_ref,
                ),
            }
            for item in _mapping_list(value)
        ]

    def replace_procedure_group_sources(value: object) -> list[dict[str, object]]:
        groups: list[dict[str, object]] = []
        for group in _mapping_list(value):
            steps = [
                {
                    **step,
                    "source_refs": _public_item_source_refs(
                        item=step,
                        public_source_refs=source_refs,
                        fallback_source_ref=primary_source_ref,
                    ),
                }
                for step in _mapping_list(group.get("steps"))
            ]
            groups.append(
                {
                    **group,
                    "steps": steps,
                    "source_refs": _public_item_source_refs(
                        item=group,
                        public_source_refs=source_refs,
                        fallback_source_ref=primary_source_ref,
                    ),
                }
            )
        return groups

    return {
        **record,
        "source_refs": source_refs,
        "guide_sections": replace_item_sources(record.get("guide_sections")),
        "procedure_groups": replace_procedure_group_sources(record.get("procedure_groups")),
        "materials": replace_item_sources(record.get("materials")),
        "entry_refs": replace_item_sources(record.get("entry_refs")),
        "office_hours": replace_item_sources(record.get("office_hours")),
        "contact_refs": replace_item_sources(record.get("contact_refs")),
    }


def _candidate_field_source_refs(
    *,
    field_source_urls: Mapping[str, object],
    field_name: str,
    fallback_source_ref: str,
) -> list[str]:
    return _unique_strings(_string_list(field_source_urls.get(field_name)) or [fallback_source_ref])


def _public_item_source_refs(
    *,
    item: Mapping[str, object],
    public_source_refs: Sequence[str],
    fallback_source_ref: str,
) -> list[str]:
    source_refs = _string_list(item.get("source_refs"))
    if not source_refs:
        return [fallback_source_ref]
    public_ref_set = set(public_source_refs)
    public_refs = [source_ref for source_ref in source_refs if source_ref in public_ref_set]
    return _unique_strings(public_refs or [fallback_source_ref])


def _selected_write_effective_from(
    task_created_at: datetime,
    generated_at: str,
) -> str:
    if task_created_at.tzinfo is not None:
        return (
            task_created_at.astimezone(UTC)
            .replace(
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            .isoformat()
        )
    return generated_at


def _service_entry_url(entry: str) -> str:
    normalized = entry.strip()
    if normalized.startswith(("http://", "https://")):
        return normalized
    if normalized.lower() in {"rz.muc.edu.cn", "mail.muc.edu.cn", "vpn.muc.edu.cn"}:
        return f"https://{normalized.lower()}"
    return ""


def _official_web_service_aliases(*, display_name: str, source_title: str) -> list[str]:
    aliases: list[str] = []
    normalized_display = display_name.strip()
    normalized_source = source_title.strip()
    if "电子邮件" in normalized_display or "电子邮件" in normalized_source:
        aliases.append("校园邮箱")
    if "校园网认证" in normalized_display or "校园网新版认证系统" in normalized_source:
        aliases.extend(["校园网认证", "上网认证"])
    if "VPN" in normalized_display or "VPN" in normalized_source.upper():
        aliases.extend(["VPN", "vpn"])
    if "信息公开" in normalized_display or "信息公开" in normalized_source:
        aliases.extend(["信息公开申请流程", "信息公开申请"])
    if "校园卡" in normalized_display or "校园卡" in normalized_source:
        aliases.extend(["校园卡", "一卡通", "校园卡补办", "校园卡挂失"])
    return _unique_strings(aliases)


def _service_guide_sections(
    *,
    service_id: str,
    display_name: str,
    process_steps: list[str],
    materials: list[str],
    entry_points: list[str],
    responsible_offices: list[str],
    process_source_refs: list[str],
    material_source_refs: list[str],
    entry_source_refs: list[str],
    office_source_refs: list[str],
    fallback_source_ref: str,
) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    if process_steps:
        sections.append(
            _service_guide_section(
                service_id=service_id,
                key="procedure",
                title=display_name,
                content="\n".join(
                    f"{index}. {step}" for index, step in enumerate(process_steps, start=1)
                ),
                order=1,
                source_refs=process_source_refs,
            )
        )
    if materials:
        sections.append(
            _service_guide_section(
                service_id=service_id,
                key="required_materials",
                title="申请材料",
                content="\n".join(materials),
                order=2,
                source_refs=material_source_refs,
            )
        )
    if entry_points:
        sections.append(
            _service_guide_section(
                service_id=service_id,
                key="entry",
                title="办理入口",
                content="\n".join(entry_points),
                order=3,
                source_refs=entry_source_refs,
            )
        )
    if responsible_offices:
        sections.append(
            _service_guide_section(
                service_id=service_id,
                key="contact",
                title="负责部门",
                content="\n".join(responsible_offices),
                order=4,
                source_refs=office_source_refs,
            )
        )
    return sections or [_overview_section(service_id, display_name, fallback_source_ref)]


def _service_guide_section(
    *,
    service_id: str,
    key: str,
    title: str,
    content: str,
    order: int,
    source_refs: list[str],
) -> dict[str, object]:
    return {
        "section_id": f"{service_id}:section:{key}",
        "section_type": key,
        "title": title,
        "content": content,
        "order": order,
        "source_refs": source_refs,
    }


def _service_guide_sections_from_items(
    *,
    service_id: str,
    display_name: str,
    process_items: list[dict[str, str]],
    material_items: list[dict[str, str]],
    entry_items: list[dict[str, str]],
    office_items: list[dict[str, str]],
    fallback_source_ref: str,
) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    for key, title, items, order in (
        ("procedure", display_name, process_items, 1),
        ("required_materials", "申请材料", material_items, 2),
        ("entry", "办理入口", entry_items, 3),
        ("contact", "负责部门", office_items, 4),
    ):
        if not items:
            continue
        sections.append(
            _service_guide_section(
                service_id=service_id,
                key=key,
                title=title,
                content=_section_content(key=key, items=items),
                order=order,
                source_refs=_unique_strings([item["source_ref"] for item in items]),
            )
        )
    return sections or [_overview_section(service_id, display_name, fallback_source_ref)]


def _section_content(*, key: str, items: list[dict[str, str]]) -> str:
    if key == "procedure":
        return "\n".join(f"{index}. {item['text']}" for index, item in enumerate(items, start=1))
    return "\n".join(item["text"] for item in items)


def _overview_section(
    service_id: str, display_name: str, fallback_source_ref: str
) -> dict[str, object]:
    return {
        "section_id": f"{service_id}:section:overview",
        "section_type": "overview",
        "title": display_name,
        "content": display_name,
        "order": 1,
        "source_refs": [fallback_source_ref],
    }


def _service_guide_items_by_source(
    *,
    candidates: Sequence[Mapping[str, object]],
    field_name: str,
    fallback_source_ref: str,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        typed_candidate = _object_mapping(candidate.get("typed_candidate"))
        source_ref = _candidate_public_source_ref(candidate) or fallback_source_ref
        for text in _string_list(typed_candidate.get(field_name)):
            key = (text, source_ref)
            if key in seen:
                continue
            seen.add(key)
            items.append({"text": text, "source_ref": source_ref})
    return items


def _merged_service_guide_procedure_groups(
    *,
    candidates: Sequence[Mapping[str, object]],
    fallback_source_ref: str,
) -> list[dict[str, object]]:
    merged: list[dict[str, object]] = []
    seen: set[str] = set()
    for candidate in candidates:
        typed_candidate = _object_mapping(candidate.get("typed_candidate"))
        for group in _mapping_list(typed_candidate.get("procedure_groups")):
            group_id = str(group.get("group_id") or "").strip()
            if not group_id or group_id in seen:
                continue
            seen.add(group_id)
            merged.append(
                {
                    **group,
                    "source_refs": _unique_strings(
                        _string_list(group.get("source_refs"))
                        or [_candidate_public_source_ref(candidate) or fallback_source_ref]
                    ),
                }
            )
    return merged


def _service_guide_procedure_groups(
    *,
    service_id: str,
    procedure_groups: Sequence[Mapping[str, object]],
    fallback_source_refs: Sequence[str],
) -> list[dict[str, object]]:
    groups: list[dict[str, object]] = []
    for order, group in enumerate(procedure_groups, start=1):
        group_id = (
            str(group.get("group_id") or "").strip() or f"{service_id}:procedure_group:{order}"
        )
        title = str(group.get("title") or "").strip()
        if not title:
            continue
        steps = _service_guide_group_steps(
            group_id=group_id,
            raw_steps=_mapping_list(group.get("steps")),
            fallback_source_refs=fallback_source_refs,
        )
        if not steps:
            continue
        groups.append(
            {
                "group_id": group_id,
                "title": title,
                "focus_tags": _string_list(group.get("focus_tags")),
                "order": int(group.get("order") or order),
                "steps": steps,
                "source_refs": _unique_strings(
                    _string_list(group.get("source_refs")) or list(fallback_source_refs)
                ),
            }
        )
    return groups


def _service_guide_group_steps(
    *,
    group_id: str,
    raw_steps: list[dict[str, object]],
    fallback_source_refs: Sequence[str],
) -> list[dict[str, object]]:
    steps: list[dict[str, object]] = []
    for step_order, raw_step in enumerate(raw_steps, start=1):
        content = str(raw_step.get("content") or "").strip()
        if not content:
            continue
        step_id = str(raw_step.get("step_id") or "").strip() or f"{group_id}:step:{step_order}"
        steps.append(
            {
                "step_id": step_id,
                "content": content,
                "order": step_order,
                "source_refs": _unique_strings(
                    _string_list(raw_step.get("source_refs")) or list(fallback_source_refs)
                ),
            }
        )
    return steps


def _merged_service_guide_contacts(
    candidates: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    merged: dict[str, list[str]] = {
        "emails": [],
        "locations": [],
        "office_hours": [],
        "phones": [],
    }
    for candidate in candidates:
        contacts = _object_mapping(
            _object_mapping(candidate.get("typed_candidate")).get("contacts")
        )
        for key in merged:
            merged[key].extend(_string_list(contacts.get(key)))
    return {key: _unique_strings(values) for key, values in merged.items()}


def _service_guide_contact_refs(
    *,
    contacts: Mapping[str, object],
    display_name: str,
    responsible_offices: list[str],
    service_id: str,
    source_ref: str,
) -> list[dict[str, object]]:
    phones = _string_list(contacts.get("phones"))
    emails = _string_list(contacts.get("emails"))
    locations = _string_list(contacts.get("locations"))
    contact_count = max(len(responsible_offices), len(phones), len(emails), len(locations))
    return [
        {
            "contact_id": f"{service_id}:contact:{index}",
            "label": _indexed_value(responsible_offices, offset) or display_name,
            "department": _indexed_value(responsible_offices, offset) or display_name,
            "phone": _indexed_value(phones, offset),
            "email": _indexed_value(emails, offset),
            "location_ref": _indexed_value(locations, offset),
            "source_refs": [source_ref],
        }
        for offset, index in enumerate(range(1, contact_count + 1))
    ]


def _indexed_value(values: list[str], offset: int) -> str:
    if offset < len(values):
        return values[offset]
    return ""
