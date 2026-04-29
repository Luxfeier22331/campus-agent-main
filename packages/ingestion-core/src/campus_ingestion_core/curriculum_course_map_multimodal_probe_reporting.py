from __future__ import annotations

from collections import defaultdict

from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
    DEFAULT_GOLD_PASS_RATE_THRESHOLD,
    DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD,
    DEFAULT_REPEATABILITY_THRESHOLD,
    CourseMapFinding,
    CurriculumCourseMapAdmissionSummary,
    CurriculumCourseMapGoldExpectation,
    CurriculumCourseMapGoldPageScore,
    CurriculumCourseMapGoldReport,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapProbeRun,
    CurriculumCourseMapRepeatabilityPageScore,
    CurriculumCourseMapRepeatabilityReport,
    _jaccard,
    _mean,
    _normalize_label,
    _recall,
)


def build_curriculum_course_map_repeatability_report(
    *,
    runs: tuple[CurriculumCourseMapProbeRun, ...],
    threshold: float,
) -> CurriculumCourseMapRepeatabilityReport:
    if not runs:
        raise ValueError("repeatability report requires at least one run")
    page_runs = _group_runs_by_page(runs)
    page_scores: list[CurriculumCourseMapRepeatabilityPageScore] = []
    for page_number, probes in sorted(page_runs.items()):
        if not probes:
            continue
        pair_title_scores: list[float] = []
        pair_node_scores: list[float] = []
        pair_edge_scores: list[float] = []
        count_scores: list[float] = []
        comparisons = 0
        for left_index in range(len(probes)):
            for right_index in range(left_index + 1, len(probes)):
                left = probes[left_index]
                right = probes[right_index]
                comparisons += 1
                max_maps = max(len(left.course_maps), len(right.course_maps))
                slot_title_scores: list[float] = []
                slot_node_scores: list[float] = []
                slot_edge_scores: list[float] = []
                for slot_index in range(max_maps):
                    left_finding = (
                        left.course_maps[slot_index] if slot_index < len(left.course_maps) else None
                    )
                    right_finding = (
                        right.course_maps[slot_index]
                        if slot_index < len(right.course_maps)
                        else None
                    )
                    left_surface = _slot_surface(left_finding)
                    right_surface = _slot_surface(right_finding)
                    slot_title_scores.append(
                        _jaccard(left_surface["titles"], right_surface["titles"])
                    )
                    slot_node_scores.append(_jaccard(left_surface["nodes"], right_surface["nodes"]))
                    slot_edge_scores.append(_jaccard(left_surface["edges"], right_surface["edges"]))
                pair_title_scores.append(_mean(slot_title_scores) if slot_title_scores else 1.0)
                pair_node_scores.append(_mean(slot_node_scores) if slot_node_scores else 1.0)
                pair_edge_scores.append(_mean(slot_edge_scores) if slot_edge_scores else 1.0)
                count_scores.append(1.0 if len(left.course_maps) == len(right.course_maps) else 0.0)
        title_jaccard = _mean(pair_title_scores) if pair_title_scores else 1.0
        node_jaccard = _mean(pair_node_scores) if pair_node_scores else 1.0
        edge_jaccard = _mean(pair_edge_scores) if pair_edge_scores else 1.0
        map_count_agreement = _mean(count_scores) if count_scores else 1.0
        overall_score = _mean([title_jaccard, node_jaccard, edge_jaccard, map_count_agreement])
        page_scores.append(
            CurriculumCourseMapRepeatabilityPageScore(
                page_number=page_number,
                document_id=probes[0].document_id,
                compared_run_pairs=comparisons,
                title_jaccard=round(title_jaccard, 4),
                node_jaccard=round(node_jaccard, 4),
                edge_jaccard=round(edge_jaccard, 4),
                map_count_agreement=round(map_count_agreement, 4),
                overall_score=round(overall_score, 4),
                passed=overall_score >= threshold,
            )
        )
    overall_score = _mean([score.overall_score for score in page_scores]) if page_scores else 0.0
    pass_rate = (
        sum(1 for score in page_scores if score.passed) / len(page_scores) if page_scores else 0.0
    )
    return CurriculumCourseMapRepeatabilityReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        threshold=threshold,
        page_scores=tuple(page_scores),
        pass_rate=round(pass_rate, 4),
        overall_score=round(overall_score, 4),
    )


def build_curriculum_course_map_gold_report(
    *,
    runs: tuple[CurriculumCourseMapProbeRun, ...],
    gold_manifest: tuple[CurriculumCourseMapGoldExpectation, ...],
) -> CurriculumCourseMapGoldReport:
    if not runs:
        raise ValueError("gold report requires at least one run")
    page_runs = _group_runs_by_page(runs)
    page_scores: list[CurriculumCourseMapGoldPageScore] = []
    for expectation in gold_manifest:
        probes = page_runs.get(expectation.page_number) or ()
        if not probes:
            raise ValueError(f"gold page {expectation.page_number} is missing from probe runs")
        stable_titles: list[str] = []
        stable_nodes: set[str] = set()
        stable_edges: set[tuple[str, str]] = set()
        slot_presence = 0
        slot_passes = 0
        required_titles = 0
        matched_titles = 0
        expected_node_total = 0
        matched_node_total = 0
        expected_edge_total = 0
        matched_edge_total = 0
        for slot in expectation.expected_maps:
            stable_slot = _stable_slot_surface(probes=probes, map_index=slot.map_index)
            if stable_slot["present"]:
                slot_presence += 1
            if slot.title_required:
                required_titles += 1
                if (
                    slot.expected_title
                    and _normalize_label(slot.expected_title) in stable_slot["titles"]
                ):
                    matched_titles += 1
            expected_node_set = {_normalize_label(value) for value in slot.expected_node_labels}
            expected_edge_set = {
                (_normalize_label(left), _normalize_label(right))
                for left, right in slot.expected_edges
            }
            matched_node_total += len(expected_node_set & stable_slot["nodes"])
            expected_node_total += len(expected_node_set)
            matched_edge_total += len(expected_edge_set & stable_slot["edges"])
            expected_edge_total += len(expected_edge_set)
            slot_node_recall = _recall(expected=expected_node_set, actual=stable_slot["nodes"])
            slot_edge_recall = _recall(expected=expected_edge_set, actual=stable_slot["edges"])
            slot_title_pass = True
            if slot.title_required:
                slot_title_pass = (
                    bool(slot.expected_title)
                    and _normalize_label(slot.expected_title) in stable_slot["titles"]
                )
            if (
                slot_title_pass
                and slot_node_recall >= slot.min_node_recall
                and slot_edge_recall >= slot.min_edge_recall
            ):
                slot_passes += 1
            stable_titles.extend(sorted(stable_slot["titles"]))
            stable_nodes |= stable_slot["nodes"]
            stable_edges |= stable_slot["edges"]
        map_detection_recall = slot_presence / len(expectation.expected_maps)
        slot_pass_rate = slot_passes / len(expectation.expected_maps)
        title_recall = matched_titles / required_titles if required_titles else 1.0
        node_recall = matched_node_total / expected_node_total if expected_node_total else 1.0
        edge_recall = matched_edge_total / expected_edge_total if expected_edge_total else 1.0
        passed = (
            map_detection_recall >= expectation.min_map_detection_recall
            and slot_pass_rate >= expectation.min_slot_pass_rate
        )
        page_scores.append(
            CurriculumCourseMapGoldPageScore(
                page_number=expectation.page_number,
                document_id=expectation.document_id,
                map_detection_recall=round(map_detection_recall, 4),
                slot_pass_rate=round(slot_pass_rate, 4),
                title_recall=round(title_recall, 4),
                node_recall=round(node_recall, 4),
                edge_recall=round(edge_recall, 4),
                stable_titles=tuple(sorted(set(stable_titles))),
                stable_nodes=tuple(sorted(stable_nodes)),
                stable_edges=tuple(sorted(stable_edges)),
                passed=passed,
            )
        )
    pass_rate = (
        sum(1 for score in page_scores if score.passed) / len(page_scores) if page_scores else 0.0
    )
    return CurriculumCourseMapGoldReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        page_scores=tuple(page_scores),
        pass_rate=round(pass_rate, 4),
    )


def build_curriculum_course_map_admission_summary(
    *,
    repeatability: CurriculumCourseMapRepeatabilityReport,
    gold: CurriculumCourseMapGoldReport,
) -> CurriculumCourseMapAdmissionSummary:
    reasons: list[str] = []
    if repeatability.pass_rate >= DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD:
        reasons.append("repeatability gate reached bounded admission threshold")
    else:
        reasons.append("repeatability gate is still below bounded admission threshold")
    if gold.pass_rate >= DEFAULT_GOLD_PASS_RATE_THRESHOLD:
        reasons.append("gold coverage is strong enough for a bounded follow-up")
    else:
        reasons.append("gold coverage is still too weak for bounded admission")
    if (
        repeatability.pass_rate >= DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD
        and gold.pass_rate >= DEFAULT_GOLD_PASS_RATE_THRESHOLD
    ):
        recommendation = "bounded_candidate_for_follow_up"
    elif repeatability.overall_score >= DEFAULT_REPEATABILITY_THRESHOLD:
        recommendation = "bounded_probe_only"
    else:
        recommendation = "not_admitted_keep_fail_close"
    return CurriculumCourseMapAdmissionSummary(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        recommendation=recommendation,
        repeatability_pass_rate=repeatability.pass_rate,
        gold_pass_rate=gold.pass_rate,
        repeatability_overall_score=repeatability.overall_score,
        reasons=tuple(reasons),
    )


def _group_runs_by_page(
    runs: tuple[CurriculumCourseMapProbeRun, ...],
) -> dict[int, tuple[CurriculumCourseMapPageProbe, ...]]:
    grouped: dict[int, list[CurriculumCourseMapPageProbe]] = defaultdict(list)
    for run in runs:
        for page in run.pages:
            grouped[page.page_number].append(page)
    return {page_number: tuple(items) for page_number, items in grouped.items()}


def _slot_surface(finding: CourseMapFinding | None) -> dict[str, set[object]]:
    if finding is None:
        return {"titles": set(), "nodes": set(), "edges": set()}
    titles = {_normalize_label(finding.map_title)} if (finding.map_title or "").strip() else set()
    nodes = {_normalize_label(node.node_label) for node in finding.nodes if node.node_label.strip()}
    edges = {
        (_normalize_label(edge.source_label), _normalize_label(edge.target_label))
        for edge in finding.edges
        if edge.source_label.strip() and edge.target_label.strip()
    }
    return {"titles": titles, "nodes": nodes, "edges": edges}


def _stable_slot_surface(
    *,
    probes: tuple[CurriculumCourseMapPageProbe, ...],
    map_index: int,
) -> dict[str, object]:
    present_surfaces: list[dict[str, set[object]]] = []
    for probe in probes:
        if map_index > len(probe.course_maps):
            return {"present": False, "titles": set(), "nodes": set(), "edges": set()}
        present_surfaces.append(_slot_surface(probe.course_maps[map_index - 1]))
    titles = set(present_surfaces[0]["titles"])
    nodes = set(present_surfaces[0]["nodes"])
    edges = set(present_surfaces[0]["edges"])
    for surface in present_surfaces[1:]:
        titles &= set(surface["titles"])
        nodes &= set(surface["nodes"])
        edges &= set(surface["edges"])
    return {"present": True, "titles": titles, "nodes": nodes, "edges": edges}


__all__ = [
    "_group_runs_by_page",
    "_slot_surface",
    "_stable_slot_surface",
    "build_curriculum_course_map_admission_summary",
    "build_curriculum_course_map_gold_report",
    "build_curriculum_course_map_repeatability_report",
]
