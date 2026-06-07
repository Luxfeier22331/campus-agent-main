from __future__ import annotations

import json
import subprocess
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTION_CONTROL_DIR = REPO_ROOT / "apps" / "execution-control"
DEFAULT_GO_RUNNER_COMMAND = ("go", "run", "./cmd/official-web-preview-runtime-verifier")
DEFAULT_REPORT_NAME = "official-web-selected-write-preview-runtime-verification.json"
DEFAULT_TARGET_INVENTORY_PATH = (
    REPO_ROOT / "configs/sources/official_web/muc_public/target-inventory.json"
)
BUNDLE_SCOPE_TASK_SCOPE = "task_scope"
BUNDLE_SCOPE_FULL_IMPACT = "full_impact"
SUPPORTED_BUNDLE_SCOPES = (BUNDLE_SCOPE_TASK_SCOPE, BUNDLE_SCOPE_FULL_IMPACT)


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWritePreviewRuntimeCase:
    case_id: str
    collection: str
    inventory_id: str
    mode: str
    user_goal: str
    expected_target: str
    expected_payload_kind: str
    expected_selected_tool: str
    expected_outcome: str
    expected_resolved_display_name: str = ""
    expected_fail_close_reason: str = ""
    expected_field_status: dict[str, str] | None = None
    expected_guide_focus: str = ""
    required_selected_section_ids: tuple[str, ...] = ()
    max_selected_section_count: int | None = None
    required_body_tokens: tuple[str, ...] = ()
    forbidden_body_tokens: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWritePreviewRuntimeCaseResult:
    case_id: str
    collection: str
    inventory_id: str
    selected_write_id: str
    passed: bool
    failures: tuple[str, ...]
    observed: dict[str, object]


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWritePreviewRuntimeVerificationReport:
    passed: bool
    output_path: Path
    summary: dict[str, object]
    case_results: tuple[OfficialWebSelectedWritePreviewRuntimeCaseResult, ...]


class PreviewRuntimeRunner(Protocol):
    def __call__(
        self,
        *,
        report_path: Path,
        selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
        bundle_scope: str,
    ) -> dict[str, object]: ...


def default_official_web_selected_write_preview_runtime_cases() -> tuple[
    OfficialWebSelectedWritePreviewRuntimeCase, ...
]:
    return (
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-information-disclosure-procedure",
            collection="service_guide",
            inventory_id="muc-information-disclosure-application-process",
            mode="planner_runtime",
            user_goal="信息公开申请流程怎么办理",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学信息公开依申请公开工作流程",
            expected_guide_focus="procedure",
            required_body_tokens=("15个工作日", "学校信息公开办公室"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-information-disclosure-entry-fail-close",
            collection="service_guide",
            inventory_id="muc-information-disclosure-application-process",
            mode="planner_runtime",
            user_goal="信息公开申请入口在哪里",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="temporarily_unverifiable",
            expected_fail_close_reason="field_not_provided_by_source",
            expected_guide_focus="entry",
            expected_field_status={"service_entry": "source_not_provided"},
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="contact-information-disclosure-phone",
            collection="contact_directory",
            inventory_id="muc-information-disclosure-contact",
            mode="planner_runtime",
            user_goal="信息公开联系电话是多少",
            expected_target="campus-services-agent",
            expected_payload_kind="contact_directory_lookup",
            expected_selected_tool="contact_directory_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学信息公开联系方式",
            required_body_tokens=("010-68932551", "010-68933983"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="contact-it-service-location",
            collection="contact_directory",
            inventory_id="muc-it-service-contacts",
            mode="planner_runtime",
            user_goal="信息化办办公地点在哪里",
            expected_target="campus-services-agent",
            expected_payload_kind="contact_directory_lookup",
            expected_selected_tool="contact_directory_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学信息化服务联系方式",
            required_body_tokens=("北京市海淀区中关村南大街27号",),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-campus-card-contact",
            collection="service_guide",
            inventory_id="muc-it-student-campus-card-service-guide",
            mode="planner_runtime",
            user_goal="校园卡丢了怎么挂失，电话是多少",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="学生校园卡服务",
            expected_guide_focus="contact",
            required_body_tokens=("010-68933381", "010-83878225"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-campus-card-entry",
            collection="service_guide",
            inventory_id="muc-it-student-campus-card-service-guide",
            mode="planner_runtime",
            user_goal="校园卡在哪里补办",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="学生校园卡服务",
            expected_guide_focus="entry",
            required_body_tokens=("自助补卡机", "校园卡管理中心前台"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-campus-card-office-hours",
            collection="service_guide",
            inventory_id="muc-it-student-campus-card-service-guide",
            mode="planner_runtime",
            user_goal="校园卡补办办公时间是什么",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="temporarily_unverifiable",
            expected_fail_close_reason="field_not_provided_by_source",
            expected_field_status={"office_hours": "source_not_provided"},
            expected_guide_focus="office_hours",
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-campus-card-eligibility",
            collection="service_guide",
            inventory_id="muc-it-student-campus-card-service-guide",
            mode="planner_runtime",
            user_goal="校园卡补办哪些人能办",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="temporarily_unverifiable",
            expected_fail_close_reason="source_truth_unavailable",
            expected_guide_focus="eligibility",
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-network-auth-entry",
            collection="service_guide",
            inventory_id="muc-it-network-auth-service-guide",
            mode="planner_runtime",
            user_goal="校园网认证入口在哪里",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学校园网认证及使用说明",
            expected_guide_focus="entry",
            required_body_tokens=("中央民族大学校园网新版认证系统", "rz.muc.edu.cn"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-email-materials",
            collection="service_guide",
            inventory_id="muc-it-email-service-guide",
            mode="planner_runtime",
            user_goal="校园邮箱需要什么材料",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学校园电子邮件服务",
            expected_guide_focus="required_materials",
            required_body_tokens=("申请表格", "中央民族大学教工电子邮件申请表"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-vpn-entry",
            collection="service_guide",
            inventory_id="muc-it-vpn-service-guide",
            mode="planner_runtime",
            user_goal="VPN入口在哪里",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学 VPN 使用说明",
            expected_guide_focus="entry",
            max_selected_section_count=1,
            required_body_tokens=("https://vpn.muc.edu.cn",),
            forbidden_body_tokens=("EasyConnect", "下载客户端", "Install EasyConnect.pkg"),
        ),
        OfficialWebSelectedWritePreviewRuntimeCase(
            case_id="service-guide-vpn-client-install",
            collection="service_guide",
            inventory_id="muc-it-vpn-service-guide",
            mode="planner_runtime",
            user_goal="VPN客户端怎么安装",
            expected_target="campus-services-agent",
            expected_payload_kind="service_guide_lookup",
            expected_selected_tool="service_guide_lookup",
            expected_outcome="resolved_current",
            expected_resolved_display_name="中央民族大学 VPN 使用说明",
            expected_guide_focus="procedure",
            required_selected_section_ids=(
                "service:official_web:vpn:procedure_group:client_install",
            ),
            max_selected_section_count=1,
            required_body_tokens=("下载客户端", "Install EasyConnect.pkg"),
            forbidden_body_tokens=("直接登录", "进入资源列表页面", "点击相应的资源进行访问"),
        ),
    )


def run_selected_write_preview_runtime_verification(
    *,
    report_path: Path,
    output_dir: Path,
    cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...] | None = None,
    bundle_scope: str = BUNDLE_SCOPE_TASK_SCOPE,
    runner: PreviewRuntimeRunner | None = None,
) -> OfficialWebSelectedWritePreviewRuntimeVerificationReport:
    resolved_bundle_scope = _normalize_bundle_scope(bundle_scope)
    resolved_report_path = report_path.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_report = _load_preview_report(resolved_report_path)
    supported_targets = _supported_targets(
        preview_report,
        bundle_scope=resolved_bundle_scope,
    )
    selected_cases = (
        cases if cases is not None else _default_cases_for_supported_targets(supported_targets)
    )
    covered_targets = {
        f"{case.collection}:{case.inventory_id}"
        for case in selected_cases
        if case.collection in {"service_guide", "contact_directory"}
    }
    uncovered_supported_targets = sorted(supported_targets - covered_targets)
    resolved_runner = runner or _run_go_preview_runtime_runner
    payload = resolved_runner(
        report_path=resolved_report_path,
        selected_cases=selected_cases,
        bundle_scope=resolved_bundle_scope,
    )
    case_results = _case_results_from_payload(payload)
    failed_case_ids = [item.case_id for item in case_results if not item.passed]
    summary = {
        "report_path": str(resolved_report_path),
        "bundle_scope": resolved_bundle_scope,
        "total_cases": len(case_results),
        "passed_cases": len(case_results) - len(failed_case_ids),
        "failed_cases": len(failed_case_ids),
        "failed_case_ids": failed_case_ids,
        "supported_targets": sorted(supported_targets),
        "covered_targets": sorted(covered_targets),
        "uncovered_supported_targets": uncovered_supported_targets,
    }
    report = OfficialWebSelectedWritePreviewRuntimeVerificationReport(
        passed=not failed_case_ids and not uncovered_supported_targets,
        output_path=output_dir / DEFAULT_REPORT_NAME,
        summary=summary,
        case_results=case_results,
    )
    report.output_path.write_text(
        json.dumps(_report_to_dict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _run_go_preview_runtime_runner(
    *,
    report_path: Path,
    selected_cases: tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...],
    bundle_scope: str,
) -> dict[str, object]:
    payload = {
        "preview_report_path": str(report_path),
        "bundle_scope": _normalize_bundle_scope(bundle_scope),
        "cases": [asdict(case) for case in selected_cases],
    }
    completed = subprocess.run(
        DEFAULT_GO_RUNNER_COMMAND,
        cwd=EXECUTION_CONTROL_DIR,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "go preview runtime verifier failed: "
            f"exit={completed.returncode} stderr={completed.stderr.strip()}"
        )
    parsed = json.loads(completed.stdout)
    if not isinstance(parsed, dict):
        raise RuntimeError("go preview runtime verifier output must be an object")
    return parsed


def _load_preview_report(report_path: Path) -> dict[str, object]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("selected-write preview report must be an object")
    return payload


def _normalize_bundle_scope(bundle_scope: str) -> str:
    normalized = str(bundle_scope).strip() or BUNDLE_SCOPE_TASK_SCOPE
    if normalized not in SUPPORTED_BUNDLE_SCOPES:
        raise RuntimeError(
            "unsupported bundle_scope: "
            f"{normalized} (expected one of {', '.join(SUPPORTED_BUNDLE_SCOPES)})"
        )
    return normalized


def _supported_targets(
    report: dict[str, object],
    *,
    bundle_scope: str,
) -> set[str]:
    results = report.get("results")
    if not isinstance(results, list):
        raise RuntimeError("selected-write preview report results must be a list")
    supported: set[str] = set()
    for item in results:
        if not isinstance(item, dict):
            continue
        collection = str(item.get("collection") or "").strip()
        inventory_id = str(item.get("inventory_id") or "").strip()
        if collection not in {"service_guide", "contact_directory"} or not inventory_id:
            continue
        supported.add(f"{collection}:{inventory_id}")
        if bundle_scope == BUNDLE_SCOPE_FULL_IMPACT:
            supported.update(_full_impact_targets(item, collection=collection))
    return supported


def _full_impact_targets(
    preview_result: Mapping[str, object],
    *,
    collection: str,
) -> set[str]:
    full_bundle = preview_result.get("full_bundle")
    if not isinstance(full_bundle, dict):
        return set()
    records_field = (
        "service_guide_records"
        if collection == "service_guide"
        else "contact_records"
        if collection == "contact_directory"
        else ""
    )
    if not records_field:
        return set()
    inventory_lookup = _target_inventory_lookup(collection=collection)
    targets: set[str] = set()
    for record in _mapping_list(full_bundle.get(records_field)):
        inventory_id = _inventory_id_for_record(record, inventory_lookup=inventory_lookup)
        if inventory_id:
            targets.add(f"{collection}:{inventory_id}")
    return targets


def _target_inventory_lookup(*, collection: str) -> dict[str, dict[str, object]]:
    try:
        inventory = json.loads(DEFAULT_TARGET_INVENTORY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    expected_target = (
        "campus_services/service_guide"
        if collection == "service_guide"
        else "campus_services/contact_directory"
    )
    lookup: dict[str, dict[str, object]] = {}
    for entry in _mapping_list(inventory.get("entries")):
        if str(entry.get("selected_write_target") or "").strip() != expected_target:
            continue
        inventory_id = str(entry.get("inventory_id") or "").strip()
        if not inventory_id:
            continue
        lookup[inventory_id] = {
            "target_label": str(entry.get("target_label") or "").strip(),
            "source_urls": _string_list(entry.get("source_urls")),
        }
    return lookup


def _inventory_id_for_record(
    record: Mapping[str, object],
    *,
    inventory_lookup: Mapping[str, Mapping[str, object]],
) -> str:
    source_refs = _string_list(record.get("source_refs"))
    for source_ref in source_refs:
        inventory_id = _inventory_id_from_official_web_ref(source_ref)
        if inventory_id in inventory_lookup:
            return inventory_id
    source_ref_set = set(source_refs)
    display_name = str(record.get("display_name") or "").strip()
    for inventory_id, entry in inventory_lookup.items():
        if display_name and display_name == str(entry.get("target_label") or "").strip():
            return inventory_id
        if source_ref_set & set(_string_list(entry.get("source_urls"))):
            return inventory_id
    return ""


def _inventory_id_from_official_web_ref(source_ref: str) -> str:
    parts = source_ref.split(":", 2)
    if len(parts) < 3 or parts[0] != "official_web":
        return ""
    return parts[1].strip()


def _case_results_from_payload(
    payload: dict[str, object],
) -> tuple[OfficialWebSelectedWritePreviewRuntimeCaseResult, ...]:
    raw_results = payload.get("results")
    if payload.get("runner") != "execution-control-go":
        raise RuntimeError(f"unexpected preview runtime runner: {payload.get('runner')}")
    if not isinstance(raw_results, list):
        raise RuntimeError("preview runtime verifier results must be a list")
    results: list[OfficialWebSelectedWritePreviewRuntimeCaseResult] = []
    for item in raw_results:
        if not isinstance(item, dict):
            raise RuntimeError("preview runtime verifier result must be an object")
        observed = item.get("observed")
        if not isinstance(observed, dict):
            raise RuntimeError("preview runtime verifier observed must be an object")
        results.append(
            OfficialWebSelectedWritePreviewRuntimeCaseResult(
                case_id=str(item.get("case_id") or "").strip(),
                collection=str(item.get("collection") or "").strip(),
                inventory_id=str(item.get("inventory_id") or "").strip(),
                selected_write_id=str(item.get("selected_write_id") or "").strip(),
                passed=bool(item.get("passed") is True),
                failures=tuple(
                    str(value).strip()
                    for value in (item.get("failures") or [])
                    if str(value).strip()
                ),
                observed=dict(observed),
            )
        )
    return tuple(results)


def _default_cases_for_supported_targets(
    supported_targets: set[str],
) -> tuple[OfficialWebSelectedWritePreviewRuntimeCase, ...]:
    return tuple(
        case
        for case in default_official_web_selected_write_preview_runtime_cases()
        if f"{case.collection}:{case.inventory_id}" in supported_targets
    )


def _mapping_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _report_to_dict(
    report: OfficialWebSelectedWritePreviewRuntimeVerificationReport,
) -> dict[str, object]:
    return {
        "schema_version": "official_web_selected_write_preview_runtime_verification_report.v1",
        "passed": report.passed,
        "summary": report.summary,
        "results": [asdict(item) for item in report.case_results],
    }


__all__ = [
    "BUNDLE_SCOPE_FULL_IMPACT",
    "BUNDLE_SCOPE_TASK_SCOPE",
    "DEFAULT_GO_RUNNER_COMMAND",
    "DEFAULT_REPORT_NAME",
    "OfficialWebSelectedWritePreviewRuntimeCase",
    "OfficialWebSelectedWritePreviewRuntimeCaseResult",
    "OfficialWebSelectedWritePreviewRuntimeVerificationReport",
    "default_official_web_selected_write_preview_runtime_cases",
    "run_selected_write_preview_runtime_verification",
]
