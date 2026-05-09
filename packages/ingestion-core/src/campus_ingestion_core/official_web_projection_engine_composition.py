from __future__ import annotations

from campus_ingestion_core.official_web_projection_engine_candidates import (
    _build_candidate_key,
    _build_consumer_candidate_page,
    _quality_gate,
)
from campus_ingestion_core.official_web_projection_engine_common import (
    _EMAIL_RE,
    _OFFICE_HOURS_RE,
    _PHONE_RE,
    _SERVICE_GUIDE_COMPOSITION_SPECS,
    _find_consumer_match,
    _page_identity,
    _page_lineage_fields,
    _require_optional_text,
    _require_text,
    _string_list,
    _target_from_consumer_match,
    _target_lineage_matched_evidence,
    _target_projection_fields,
    _unique,
)
from campus_ingestion_core.official_web_projection_engine_content import (
    _block_lines,
    _build_evidence_spans,
    _candidate_content_blocks,
    _main_content_blocks,
    _main_content_lines,
)
from campus_ingestion_core.official_web_projection_engine_service_extract import (
    _extract_locations,
    _extract_responsible_offices,
    _extract_service_entry_points,
    _extract_service_materials,
    _extract_service_process_steps,
    _selected_write_suppressed,
    _service_candidate_name,
)


def _resolve_consumer_projection(
    *,
    manifest: dict[str, object],
    matches: list[dict[str, object]],
    blocks: list[dict[str, object]],
    title: str,
    composition_override: dict[str, object] | None = None,
) -> dict[str, object] | None:
    if not matches and composition_override is None:
        return None
    if _is_non_answer_bearing_source_pack_preview_seed(manifest=manifest, matches=matches):
        return {"action": "candidate", "candidate_pages": []}
    stable_match = _find_consumer_match(matches, "stable_reference_candidate")
    if stable_match is not None:
        return {
            "action": "emit_document",
            "target_corpus": "official_web",
            "target_collection": "stable_reference",
            "routing_route_id": "consumer-denominator:stable_reference_candidate",
            "target_lineage": stable_match,
        }

    candidate_pages = _candidate_pages_from_override(composition_override)
    skipped_consumer_families = _skipped_consumer_families(composition_override)
    force_candidate_action = bool(
        composition_override is not None and composition_override.get("force_candidate_action")
    )
    for match in matches:
        if not isinstance(match, dict):
            continue
        consumer_family = _require_optional_text(
            match.get("consumerFamily") or match.get("consumer_family")
        )
        materialization_policy = _require_optional_text(
            match.get("materializationPolicy") or match.get("materialization_policy")
        )
        if consumer_family is None or materialization_policy is None:
            continue
        if consumer_family == "stable_reference_candidate":
            continue
        if consumer_family in skipped_consumer_families:
            continue
        target_corpus, target_collection = _target_from_consumer_match(match)
        selected_write_target = (
            _require_optional_text(
                match.get("selectedWriteTarget") or match.get("selected_write_target")
            )
            or ""
        )
        candidate_pages.append(
            _build_consumer_candidate_page(
                blocks=blocks,
                consumer_family=consumer_family,
                manifest=manifest,
                materialization_policy=materialization_policy,
                matched_evidence=_string_list(
                    match.get("matchedEvidence") or match.get("matched_evidence")
                )
                or _target_lineage_matched_evidence(match),
                review_policy=_require_optional_text(
                    match.get("reviewPolicy") or match.get("review_policy")
                )
                or "",
                selected_write_target=selected_write_target,
                target_lineage=match,
                target_collection=target_collection,
                target_corpus=target_corpus,
                title=title,
            )
        )
        if candidate_pages and not candidate_pages[-1]:
            candidate_pages.pop()
            force_candidate_action = True
    if candidate_pages or force_candidate_action:
        return {"action": "candidate", "candidate_pages": candidate_pages}
    return None


def _is_non_answer_bearing_source_pack_preview_seed(
    *,
    manifest: dict[str, object],
    matches: list[dict[str, object]],
) -> bool:
    if str(manifest.get("pageFamily") or manifest.get("page_family") or "").strip() not in {
        "directory_page",
        "listing_page",
    }:
        return False
    source_pack_id = _require_optional_text(
        manifest.get("sourcePackId") or manifest.get("source_pack_id")
    )
    source_pack_entry_id = _require_optional_text(
        manifest.get("sourcePackEntryId") or manifest.get("source_pack_entry_id")
    )
    if source_pack_id is None or source_pack_entry_id is None or not matches:
        return False
    return all(
        _require_optional_text(match.get("worksetReason") or match.get("workset_reason"))
        == "source_pack_preview_seed"
        for match in matches
        if isinstance(match, dict)
    )


def _build_consumer_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    grouped_contexts: dict[tuple[str, str], list[dict[str, object]]] = {}
    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        raw_page = dict(page_context["raw_page"])
        page_lineage = _page_lineage_fields(manifest=manifest, raw_page=raw_page)
        source_pack_id = _require_optional_text(page_lineage.get("sourcePackId"))
        composition_group = _require_optional_text(page_lineage.get("compositionGroup"))
        if source_pack_id is None or composition_group is None:
            continue
        grouped_contexts.setdefault((source_pack_id, composition_group), []).append(page_context)

    overrides: dict[tuple[str, str], dict[str, object]] = {}
    for (_, composition_group), group_contexts in grouped_contexts.items():
        if composition_group == "information_disclosure":
            overrides.update(_build_information_disclosure_projection_overrides(group_contexts))
        elif composition_group == "email_service":
            overrides.update(_build_email_service_projection_overrides(group_contexts))
    return overrides


def _build_information_disclosure_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    role_contexts, primary_context, suppressed_page_keys, invalid_group = (
        _resolve_service_guide_composition_group(
            page_contexts,
            composition_group="information_disclosure",
        )
    )
    if invalid_group:
        return _empty_service_guide_composition_overrides(suppressed_page_keys)
    if primary_context is None:
        return {}

    procedure_target_lineage = _find_consumer_match(
        list(primary_context["target_matches"]),
        "service_guide_candidate",
    )
    if procedure_target_lineage is None:
        return {}

    procedure_manifest = dict(primary_context["manifest"])
    return _merge_service_guide_primary_with_suppressed_overrides(
        primary_page_key=_page_identity(procedure_manifest),
        primary_candidate_page=_build_information_disclosure_service_candidate_page(
            procedure_context=primary_context,
            material_contexts=role_contexts.get("material_source", []),
            contact_contexts=role_contexts.get("contact_source", []),
            target_lineage=procedure_target_lineage,
        ),
        suppressed_page_keys=suppressed_page_keys,
    )


def _build_email_service_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    role_contexts, primary_context, suppressed_page_keys, invalid_group = (
        _resolve_service_guide_composition_group(
            page_contexts,
            composition_group="email_service",
        )
    )
    if invalid_group:
        return _empty_service_guide_composition_overrides(suppressed_page_keys)
    if primary_context is None:
        return {}

    policy_target_lineage = _find_consumer_match(
        list(primary_context["target_matches"]),
        "service_guide_candidate",
    )
    if policy_target_lineage is None:
        return {}

    policy_manifest = dict(primary_context["manifest"])
    return _merge_service_guide_primary_with_suppressed_overrides(
        primary_page_key=_page_identity(policy_manifest),
        primary_candidate_page=_build_email_service_candidate_page(
            policy_context=primary_context,
            entry_contexts=role_contexts.get("entry_source", []),
            material_contexts=role_contexts.get("material_source", []),
            contact_contexts=role_contexts.get("contact_source", []),
            target_lineage=policy_target_lineage,
        ),
        suppressed_page_keys=suppressed_page_keys,
    )


def _resolve_service_guide_composition_group(
    page_contexts: list[dict[str, object]],
    *,
    composition_group: str,
) -> tuple[
    dict[str, list[dict[str, object]]],
    dict[str, object] | None,
    set[tuple[str, str]],
    bool,
]:
    spec = _SERVICE_GUIDE_COMPOSITION_SPECS[composition_group]
    primary_role = str(spec["primary_role"])
    allowed_roles = set(spec["allowed_roles"])
    service_target_roles = set(spec["service_target_roles"])

    role_contexts: dict[str, list[dict[str, object]]] = {}
    service_target_page_keys: set[tuple[str, str]] = set()
    invalid_service_target_page_keys: set[tuple[str, str]] = set()

    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        raw_page = dict(page_context["raw_page"])
        page_key = _page_identity(manifest)
        page_lineage = _page_lineage_fields(manifest=manifest, raw_page=raw_page)
        composition_role = _require_optional_text(page_lineage.get("compositionRole"))
        if composition_role is not None:
            role_contexts.setdefault(composition_role, []).append(page_context)

        target_matches = list(page_context["target_matches"])
        if _find_consumer_match(target_matches, "service_guide_candidate") is None:
            continue
        service_target_page_keys.add(page_key)
        if composition_role is None or composition_role not in allowed_roles:
            invalid_service_target_page_keys.add(page_key)
            continue
        if composition_role not in service_target_roles:
            invalid_service_target_page_keys.add(page_key)

    primary_contexts = role_contexts.get(primary_role, [])
    primary_context = primary_contexts[0] if len(primary_contexts) == 1 else None
    invalid_group = bool(invalid_service_target_page_keys) or len(primary_contexts) != 1
    return role_contexts, primary_context, service_target_page_keys, invalid_group


def _empty_service_guide_composition_overrides(
    page_keys: set[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, object]]:
    return {
        page_key: {
            "candidate_pages": [],
            "skip_consumer_families": ["service_guide_candidate"],
            "force_candidate_action": True,
        }
        for page_key in page_keys
    }


def _merge_service_guide_primary_with_suppressed_overrides(
    *,
    primary_page_key: tuple[str, str],
    primary_candidate_page: dict[str, object],
    suppressed_page_keys: set[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, object]]:
    overrides = _empty_service_guide_composition_overrides(suppressed_page_keys)
    overrides[primary_page_key] = {
        "candidate_pages": [primary_candidate_page],
        "skip_consumer_families": ["service_guide_candidate"],
        "force_candidate_action": True,
    }
    return overrides


def _build_email_service_candidate_page(
    *,
    policy_context: dict[str, object],
    entry_contexts: list[dict[str, object]],
    material_contexts: list[dict[str, object]],
    contact_contexts: list[dict[str, object]],
    target_lineage: dict[str, object],
) -> dict[str, object]:
    policy_manifest = dict(policy_context["manifest"])
    policy_blocks = list(policy_context["blocks"])
    title = str(policy_context["title"])
    normalized_canonical_url = _require_text(
        policy_manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(policy_manifest.get("rawVersionId"), "rawVersionId")
    selected_write_target = (
        _require_optional_text(
            target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
        )
        or ""
    )
    policy_lines = _main_content_lines(policy_blocks)
    entry_lines = _combined_main_content_lines(entry_contexts)
    material_lines = _combined_main_content_lines(material_contexts)
    contact_blocks = _combined_candidate_blocks(
        contact_contexts,
        consumer_family="contact_directory_candidate",
    )
    contact_lines = _block_lines(contact_blocks)
    process_steps = _extract_service_process_steps(policy_lines)
    materials = _extract_service_materials(material_lines)
    if not materials:
        materials = [
            line
            for line in material_lines
            if ("申请表" in line or "审批表" in line) and len(line.strip()) <= 64
        ]
        materials = _unique(materials)
    responsible_office = _unique(
        _extract_responsible_offices(policy_lines) + _extract_responsible_offices(contact_lines)
    )
    if not responsible_office and any("网络中心" in line for line in policy_lines):
        responsible_office = ["网络中心"]
    entry_points = _unique(_extract_service_entry_points([*policy_lines, *entry_lines]))
    contact_text_lines = _unique(contact_lines + policy_lines + entry_lines)
    field_source_urls = {
        "process_steps": [
            _require_text(
                dict(policy_context["manifest"]).get("normalizedCanonicalUrl"),
                "normalizedCanonicalUrl",
            )
        ]
        if process_steps
        else [],
        "materials": _composition_source_urls(material_contexts) if materials else [],
        "entry_points": _composition_source_urls(entry_contexts) if entry_points else [],
        "responsible_office": _composition_source_urls([policy_context, *contact_contexts])
        if responsible_office
        else [],
        "contacts": _composition_source_urls(contact_contexts) if contact_text_lines else [],
    }
    typed_candidate = {
        "service_name": _service_candidate_name(
            title=title,
            target_lineage=target_lineage,
        ),
        "process_steps": process_steps,
        "materials": materials,
        "responsible_office": responsible_office,
        "entry_points": entry_points,
        "contacts": {
            "phones": _unique(_PHONE_RE.findall("\n".join(contact_text_lines))),
            "emails": _unique(_EMAIL_RE.findall("\n".join(contact_text_lines))),
            "locations": _extract_locations(contact_text_lines),
            "office_hours": _unique(
                match.strip() for match in _OFFICE_HOURS_RE.findall("\n".join(contact_text_lines))
            ),
        },
        "supporting_source_urls": _composition_source_urls(
            [policy_context, *entry_contexts, *material_contexts, *contact_contexts]
        ),
        "field_source_urls": field_source_urls,
        "source_url": normalized_canonical_url,
        "source_title": title,
    }
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family="service_guide_candidate",
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": "service_guide_candidate",
        "materialization_policy": _require_optional_text(
            target_lineage.get("materializationPolicy")
            or target_lineage.get("materialization_policy")
        )
        or "",
        "target_corpus": "campus_services",
        "target_collection": "service_guide",
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": policy_manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": title,
        "matched_evidence": _target_lineage_matched_evidence(target_lineage),
        "selected_write_target": selected_write_target,
        "review_policy": _require_optional_text(
            target_lineage.get("reviewPolicy") or target_lineage.get("review_policy")
        ),
        "reason": "candidate_only consumer denominator match",
        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
        "typed_candidate": typed_candidate,
        "quality_gate": _quality_gate(
            suppressed=_selected_write_suppressed(title=title, lines=policy_lines),
            has_identity=bool(title.strip()),
            has_required_evidence=bool(process_steps),
            has_source=bool(normalized_canonical_url.strip()),
        ),
        "evidence_spans": _build_evidence_spans(
            _main_content_blocks(policy_blocks)
            + _combined_main_content_blocks(entry_contexts)
            + _combined_main_content_blocks(material_contexts)
            + contact_blocks
        ),
        "source_refs": _composition_source_refs(
            [policy_context, *entry_contexts, *material_contexts, *contact_contexts]
        ),
    }
    candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _build_information_disclosure_service_candidate_page(
    *,
    procedure_context: dict[str, object],
    material_contexts: list[dict[str, object]],
    contact_contexts: list[dict[str, object]],
    target_lineage: dict[str, object],
) -> dict[str, object]:
    procedure_manifest = dict(procedure_context["manifest"])
    procedure_blocks = list(procedure_context["blocks"])
    title = str(procedure_context["title"])
    normalized_canonical_url = _require_text(
        procedure_manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(procedure_manifest.get("rawVersionId"), "rawVersionId")
    selected_write_target = (
        _require_optional_text(
            target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
        )
        or ""
    )
    procedure_lines = _main_content_lines(procedure_blocks)
    material_lines = _combined_main_content_lines(material_contexts)
    contact_blocks = _combined_candidate_blocks(
        contact_contexts,
        consumer_family="contact_directory_candidate",
    )
    contact_lines = _block_lines(contact_blocks)
    process_steps = _extract_service_process_steps(procedure_lines)
    materials = _extract_service_materials(material_lines) or _extract_service_materials(
        procedure_lines
    )
    responsible_office = _unique(
        _extract_responsible_offices(procedure_lines) + _extract_responsible_offices(contact_lines)
    )
    entry_points = _unique(_extract_service_entry_points([*procedure_lines, *material_lines]))
    contact_text_lines = _unique(contact_lines + procedure_lines)
    field_source_urls = {
        "process_steps": [
            _require_text(
                dict(procedure_context["manifest"]).get("normalizedCanonicalUrl"),
                "normalizedCanonicalUrl",
            )
        ]
        if process_steps
        else [],
        "materials": _composition_source_urls(material_contexts) if materials else [],
        "entry_points": _composition_source_urls(material_contexts) if entry_points else [],
        "responsible_office": _composition_source_urls([procedure_context, *contact_contexts])
        if responsible_office
        else [],
        "contacts": _composition_source_urls(contact_contexts) if contact_text_lines else [],
    }
    typed_candidate = {
        "service_name": _service_candidate_name(
            title=title,
            target_lineage=target_lineage,
        ),
        "process_steps": process_steps,
        "materials": materials,
        "responsible_office": responsible_office,
        "entry_points": entry_points,
        "contacts": {
            "phones": _unique(_PHONE_RE.findall("\n".join(contact_text_lines))),
            "emails": _unique(_EMAIL_RE.findall("\n".join(contact_text_lines))),
            "locations": _extract_locations(contact_text_lines),
            "office_hours": _unique(
                match.strip() for match in _OFFICE_HOURS_RE.findall("\n".join(contact_text_lines))
            ),
        },
        "supporting_source_urls": _composition_source_urls(
            [procedure_context, *material_contexts, *contact_contexts]
        ),
        "field_source_urls": field_source_urls,
        "source_url": normalized_canonical_url,
        "source_title": title,
    }
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family="service_guide_candidate",
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": "service_guide_candidate",
        "materialization_policy": _require_optional_text(
            target_lineage.get("materializationPolicy")
            or target_lineage.get("materialization_policy")
        )
        or "",
        "target_corpus": "campus_services",
        "target_collection": "service_guide",
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": procedure_manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": title,
        "matched_evidence": _target_lineage_matched_evidence(target_lineage),
        "selected_write_target": selected_write_target,
        "review_policy": _require_optional_text(
            target_lineage.get("reviewPolicy") or target_lineage.get("review_policy")
        ),
        "reason": "candidate_only consumer denominator match",
        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
        "typed_candidate": typed_candidate,
        "quality_gate": _quality_gate(
            suppressed=_selected_write_suppressed(title=title, lines=procedure_lines),
            has_identity=bool(title.strip()),
            has_required_evidence=bool(process_steps),
            has_source=bool(normalized_canonical_url.strip()),
        ),
        "evidence_spans": _build_evidence_spans(
            _main_content_blocks(procedure_blocks)
            + _combined_main_content_blocks(material_contexts)
            + contact_blocks
        ),
        "source_refs": _composition_source_refs(
            [procedure_context, *material_contexts, *contact_contexts]
        ),
    }
    candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _combined_main_content_lines(page_contexts: list[dict[str, object]]) -> list[str]:
    return _block_lines(_combined_main_content_blocks(page_contexts))


def _composition_source_urls(page_contexts: list[dict[str, object]]) -> list[str]:
    return _unique(
        _require_text(
            dict(page_context["manifest"]).get("normalizedCanonicalUrl"), "normalizedCanonicalUrl"
        )
        for page_context in page_contexts
    )


def _composition_source_refs(page_contexts: list[dict[str, object]]) -> list[dict[str, object]]:
    refs: list[dict[str, object]] = []
    seen: set[str] = set()
    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        normalized_url = _require_text(
            manifest.get("normalizedCanonicalUrl"),
            "normalizedCanonicalUrl",
        )
        if normalized_url in seen:
            continue
        seen.add(normalized_url)
        refs.append(
            {
                "source_channel": "official_web",
                "raw_asset_id": _require_text(manifest.get("rawAssetId"), "rawAssetId"),
                "raw_version_id": _require_text(manifest.get("rawVersionId"), "rawVersionId"),
                "normalized_canonical_url": normalized_url,
            }
        )
    return refs


def _combined_main_content_blocks(
    page_contexts: list[dict[str, object]],
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for page_context in page_contexts:
        blocks.extend(_main_content_blocks(list(page_context["blocks"])))
    return blocks


def _combined_candidate_blocks(
    page_contexts: list[dict[str, object]],
    *,
    consumer_family: str,
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for page_context in page_contexts:
        blocks.extend(
            _candidate_content_blocks(
                blocks=list(page_context["blocks"]),
                consumer_family=consumer_family,
            )
        )
    return blocks


def _candidate_pages_from_override(
    composition_override: dict[str, object] | None,
) -> list[dict[str, object]]:
    if composition_override is None:
        return []
    raw_candidate_pages = composition_override.get("candidate_pages")
    if not isinstance(raw_candidate_pages, list):
        return []
    return [item for item in raw_candidate_pages if isinstance(item, dict)]


def _skipped_consumer_families(
    composition_override: dict[str, object] | None,
) -> set[str]:
    if composition_override is None:
        return set()
    raw_families = composition_override.get("skip_consumer_families")
    if not isinstance(raw_families, list):
        return set()
    return {
        str(item).strip() for item in raw_families if isinstance(item, str) and str(item).strip()
    }
