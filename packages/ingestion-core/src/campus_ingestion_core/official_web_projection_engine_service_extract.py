from __future__ import annotations

import hashlib
import re
from typing import Literal

from campus_ingestion_core.official_web_projection_engine_common import (
    _CAMPUS_ADDRESS_RE,
    _CONTACT_POINT_RE,
    _LOCATION_RE,
    _REGULATION_FORMAL_TITLE_RE,
    _REGULATION_NON_RULE_FRAGMENT_TITLE_RE,
    _REGULATION_NOTICE_TITLE_SUPPRESSION_RE,
    _RESPONSIBLE_OFFICE_RE,
    _SELECTED_WRITE_SUPPRESSION_RE,
    _SERVICE_APP_RE,
    _SERVICE_ENTRY_RE,
    _SERVICE_EXPLANATION_PREFIX_RE,
    _SERVICE_HOST_ENTRY_RE,
    _SERVICE_MATERIAL_DECLARATION_RE,
    _SERVICE_MATERIAL_ITEM_RE,
    _SERVICE_MINIPROGRAM_RE,
    _SERVICE_OFFLINE_ENTRY_RE,
    _SERVICE_ORDERED_STEP_RE,
    _SERVICE_ORDERED_STEP_SIGNAL_RE,
    _SERVICE_PROCESS_RE,
    _SERVICE_SELF_SERVICE_MACHINE_RE,
    _SERVICE_SYSTEM_ENTRY_SIGNAL_RE,
    _SERVICE_SYSTEM_NON_ENTRY_RE,
    _SERVICE_SYSTEM_RE,
    _SERVICE_URL_RE,
    _require_optional_text,
    _unique,
)
from campus_ingestion_core.official_web_target_labeling import (
    choose_official_web_contact_display_name,
    choose_official_web_service_name,
)


def _extract_locations(lines: list[str]) -> list[str]:
    locations: list[str] = []
    for line in lines:
        for match in _LOCATION_RE.findall(line):
            normalized = match.strip()
            if normalized:
                locations.append(normalized)
        for match in _CAMPUS_ADDRESS_RE.finditer(line):
            label = match.group("label").strip()
            address = _clean_campus_address(match.group("address"))
            if label and address:
                locations.append(f"{label}：{address}")
    return _unique(locations)


def _clean_campus_address(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized.strip(" ，,。；;")


def _extract_responsible_offices(lines: list[str]) -> list[str]:
    offices: list[str] = []
    for line in lines:
        for match in _RESPONSIBLE_OFFICE_RE.finditer(line):
            office = _clean_responsible_office(match.group("office"))
            if office:
                offices.append(office)
    return _unique(offices)


def _clean_responsible_office(value: str) -> str:
    normalized = value.strip(" ，,。；;：:")
    normalized = re.sub(r"^(?:并由|由|经)", "", normalized)
    for prefix in ("校园网电子邮件由", "电子邮件由", "由"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
    return normalized.strip()


def _extract_service_materials(lines: list[str]) -> list[str]:
    materials: list[str] = []
    for line in lines:
        if _SERVICE_EXPLANATION_PREFIX_RE.search(line):
            continue
        if _is_service_material_name_line(line):
            materials.append(line.strip())
            continue
        if not _SERVICE_MATERIAL_DECLARATION_RE.search(line):
            continue
        fragment = _material_fragment(line)
        declared_items = _extract_declared_material_items(fragment)
        if declared_items:
            materials.extend(declared_items)
            continue
        matches = _SERVICE_MATERIAL_ITEM_RE.findall(fragment)
        materials.extend(matches)
    return _unique(materials)


def _extract_service_process_steps(lines: list[str]) -> list[str]:
    return _unique(line for line in lines if _is_service_process_line(line))


def _extract_service_procedure_groups(
    *,
    title: str,
    target_lineage: dict[str, object] | None,
    normalized_canonical_url: str,
    process_steps: list[str],
) -> list[dict[str, object]]:
    if not process_steps:
        return []
    service_seed = _service_procedure_group_seed(
        title=title,
        target_lineage=target_lineage,
        normalized_canonical_url=normalized_canonical_url,
    )
    public_source_refs = [normalized_canonical_url]
    cleaned_steps = [
        _clean_service_procedure_step_content(step)
        for step in process_steps
        if _clean_service_procedure_step_content(step)
    ]
    if not cleaned_steps:
        return []
    if service_seed == "vpn":
        grouped_steps: dict[str, list[str]] = {
            "direct_login": [],
            "client_install": [],
            "mobile_usage": [],
        }
        for step in cleaned_steps:
            bucket = _vpn_procedure_group_kind(step)
            grouped_steps[bucket].append(step)
        procedure_groups: list[dict[str, object]] = []
        for order, (group_key, title_text, focus_tags) in enumerate(
            (
                ("direct_login", "直接登录", ["entry", "direct_login"]),
                ("client_install", "客户端安装", ["procedure", "install", "client"]),
                ("mobile_usage", "移动端使用", ["procedure", "mobile"]),
            ),
            start=1,
        ):
            steps = grouped_steps[group_key]
            if not steps:
                continue
            group_id = f"service:official_web:{service_seed}:procedure_group:{group_key}"
            procedure_groups.append(
                {
                    "group_id": group_id,
                    "title": title_text,
                    "focus_tags": focus_tags,
                    "steps": [
                        {
                            "step_id": f"{group_id}:step:{index}",
                            "content": content,
                            "source_refs": public_source_refs,
                        }
                        for index, content in enumerate(steps, start=1)
                    ],
                    "source_refs": public_source_refs,
                    "order": order,
                }
            )
        return procedure_groups

    group_id = f"service:official_web:{service_seed}:procedure_group:default"
    return [
        {
            "group_id": group_id,
            "title": "办理步骤",
            "focus_tags": ["procedure"],
            "steps": [
                {
                    "step_id": f"{group_id}:step:{index}",
                    "content": content,
                    "source_refs": public_source_refs,
                }
                for index, content in enumerate(cleaned_steps, start=1)
            ],
            "source_refs": public_source_refs,
            "order": 1,
        }
    ]


def _service_procedure_group_seed(
    *,
    title: str,
    target_lineage: dict[str, object] | None,
    normalized_canonical_url: str,
) -> str:
    target_label = _require_optional_text((target_lineage or {}).get("targetLabel")) or ""
    combined = f"{title}\n{target_label}\n{normalized_canonical_url}".lower()
    if "vpn" in combined:
        return "vpn"
    if "信息公开" in f"{title}{target_label}":
        return "information_disclosure"
    if any(token in combined for token in ("电子邮件", "邮箱", "mail")):
        return "email"
    if "校园卡" in f"{title}{target_label}" or "一卡通" in f"{title}{target_label}":
        return "campus_card"
    if "认证" in f"{title}{target_label}" or "rz.muc.edu.cn" in combined:
        return "network_auth"
    path_tail = normalized_canonical_url.rstrip("/").rsplit("/", 1)[-1]
    normalized_tail = re.sub(r"[^a-z0-9]+", "-", path_tail.lower()).strip("-")
    if normalized_tail:
        return normalized_tail
    return hashlib.sha256(normalized_canonical_url.encode("utf-8")).hexdigest()[:8]


def _clean_service_procedure_step_content(step: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        _SERVICE_ORDERED_STEP_RE.sub("", step.strip(), count=1),
    ).strip(" ，,；;")


def _vpn_procedure_group_kind(
    step: str,
) -> Literal["direct_login", "client_install", "mobile_usage"]:
    normalized = step.lower()
    if any(token in step for token in ("移动端", "手机端", "安卓端", "iOS")) or any(
        token in normalized for token in ("easyconnect app", "android", "ios", "mobile")
    ):
        return "mobile_usage"
    if any(
        token in step for token in ("客户端", "安装", "下载", "EasyConnect", "Install EasyConnect")
    ) or any(token in normalized for token in ("easyconnect", ".pkg", ".exe", "install")):
        return "client_install"
    return "direct_login"


def _is_service_process_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if _is_service_material_only_line(normalized):
        return False
    if _SERVICE_ORDERED_STEP_RE.search(normalized) and _SERVICE_ORDERED_STEP_SIGNAL_RE.search(
        normalized
    ):
        return True
    return bool(_SERVICE_PROCESS_RE.search(normalized))


def _is_service_material_only_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if _SERVICE_MATERIAL_DECLARATION_RE.search(normalized):
        return False
    if _SERVICE_PROCESS_RE.search(normalized) and not re.search(
        r"(申请表|审批表|下载)", normalized
    ):
        return False
    return bool(
        re.fullmatch(
            r"[\u4e00-\u9fffA-Za-z0-9（）()《》、，, -]*(?:申请表|审批表|表格|下载)[\u4e00-\u9fffA-Za-z0-9（）()《》、，, -]*",
            normalized,
        )
    )


def _is_service_material_name_line(line: str) -> bool:
    normalized = line.strip(" \t，,。；;：:")
    if not normalized:
        return False
    if "下载" in normalized:
        return False
    if normalized in {"申请表格", "申请表", "审批表", "表格"}:
        return False
    if len(normalized) > 48:
        return False
    return bool(
        re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9（）()《》、，, .·\-－—]+", normalized)
        and re.search(r"(申请表|审批表|表格)", normalized)
    )


def _material_fragment(line: str) -> str:
    normalized = line.strip()
    for separator in ("：", ":", "包括", "包含"):
        if separator in normalized:
            normalized = normalized.split(separator, 1)[1]
            break
    return normalized


def _extract_declared_material_items(fragment: str) -> list[str]:
    normalized = fragment.strip().strip("。；;")
    if not normalized:
        return []
    parts = re.split(r"[、；;，,]|(?:以及)|(?:及)", normalized)
    items: list[str] = []
    for part in parts:
        candidate = part.strip().strip("。；;，,")
        if not candidate:
            continue
        if not (
            _SERVICE_MATERIAL_ITEM_RE.search(candidate)
            or candidate.endswith(("申请表", "审批表", "证明材料", "证明", "复印件", "附件"))
        ):
            continue
        items.append(candidate)
    return _unique(items)


def _extract_service_entry_points(lines: list[str]) -> list[str]:
    entries: list[str] = []
    for line in lines:
        if (
            not _SERVICE_ENTRY_RE.search(line)
            and not _SERVICE_URL_RE.search(line)
            and not _SERVICE_HOST_ENTRY_RE.search(line)
        ):
            continue
        entries.extend(_SERVICE_URL_RE.findall(line))
        entries.extend(match.lower() for match in _SERVICE_HOST_ENTRY_RE.findall(line))
        entries.extend(_SERVICE_SELF_SERVICE_MACHINE_RE.findall(line))
        for pattern in (_SERVICE_APP_RE, _SERVICE_MINIPROGRAM_RE, _SERVICE_OFFLINE_ENTRY_RE):
            for match in pattern.finditer(line):
                entries.append(_clean_service_entry_label(match.group("label")))
        if _SERVICE_SYSTEM_ENTRY_SIGNAL_RE.search(line) and not _SERVICE_SYSTEM_NON_ENTRY_RE.search(
            line
        ):
            for match in _SERVICE_SYSTEM_RE.finditer(line):
                entries.append(_clean_service_entry_label(match.group("label")))
    return _filter_service_entry_points(_unique(entry for entry in entries if entry))


def _service_candidate_name(*, title: str, target_lineage: dict[str, object] | None) -> str:
    return choose_official_web_service_name(
        source_title=title,
        target_label=_target_label_from_lineage(target_lineage),
    )


def _contact_candidate_display_name(
    *,
    title: str,
    contact_points: list[dict[str, str]],
    target_lineage: dict[str, object] | None,
) -> str:
    del contact_points
    return choose_official_web_contact_display_name(
        source_title=title,
        target_label=_target_label_from_lineage(target_lineage),
    )


def _target_label_from_lineage(target_lineage: dict[str, object] | None) -> str:
    if not isinstance(target_lineage, dict):
        return ""
    return _require_optional_text(target_lineage.get("targetLabel")) or ""


def _filter_service_entry_points(entries: list[str]) -> list[str]:
    filtered: list[str] = []
    host_entries = {
        entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        for entry in entries
        if _SERVICE_HOST_ENTRY_RE.fullmatch(
            entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        )
    }
    url_host_entries = {
        entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        for entry in entries
        if entry.lower().startswith(("https://", "http://"))
        and _SERVICE_HOST_ENTRY_RE.fullmatch(
            entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        )
    }
    for entry in entries:
        normalized = entry.strip()
        if not normalized:
            continue
        if normalized in {"APP", "app"}:
            continue
        normalized_host = normalized.lower()
        if normalized_host in url_host_entries and not normalized.lower().startswith(
            ("https://", "http://")
        ):
            continue
        if (
            normalized.endswith(("系统", "平台"))
            and host_entries
            and ("认证" in normalized or "VPN" in normalized or "邮箱" in normalized)
        ):
            continue
        if normalized.endswith("系统") and not (
            "认证" in normalized or "VPN" in normalized or "邮箱" in normalized
        ):
            continue
        filtered.append(normalized)
    return filtered


def _extract_mail_host_entry_points(lines: list[str]) -> list[str]:
    entries: list[str] = []
    for line in lines:
        for match in _SERVICE_HOST_ENTRY_RE.findall(line):
            entries.append(match.lower())
    return _unique(entries)


def _extract_contact_points(lines: list[str]) -> list[dict[str, str]]:
    points: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for line in lines:
        for match in _CONTACT_POINT_RE.finditer(line):
            label = str(match.group("label") or "").strip(" ：:，,。；;")
            phone = str(match.group("phone") or "").strip()
            if not label or not phone:
                continue
            key = (label, phone)
            if key in seen:
                continue
            seen.add(key)
            points.append({"label": label, "phone": phone})
    return points


def _clean_service_entry_label(value: str) -> str:
    normalized = re.sub(r"\s+", "", value).strip(" ，,。；;：:（）()")
    for separator in ("或", "、", "/"):
        if separator in normalized:
            normalized = normalized.split(separator)[-1]
    while True:
        for prefix in (
            "请立即通过",
            "请通过",
            "可登录",
            "可通过",
            "可使用",
            "登录",
            "通过",
            "使用",
            "打开",
            "下载",
            "进入",
            "到",
            "至",
            "前往",
            "在",
        ):
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :]
                break
        else:
            break
    return normalized.strip(" ，,。；;：:（）()")


def _selected_write_suppressed(*, title: str, lines: list[str]) -> bool:
    if _SELECTED_WRITE_SUPPRESSION_RE.search(title):
        return True
    non_boilerplate_text = "\n".join(lines[:3])
    return bool(_SELECTED_WRITE_SUPPRESSION_RE.search(non_boilerplate_text))


def _regulation_selected_write_suppressed(*, title: str) -> bool:
    normalized_title = re.sub(r"\s+", "", title.strip())
    if _REGULATION_NON_RULE_FRAGMENT_TITLE_RE.search(normalized_title):
        return True
    if _REGULATION_FORMAL_TITLE_RE.search(normalized_title):
        return False
    return bool(_REGULATION_NOTICE_TITLE_SUPPRESSION_RE.search(normalized_title))
