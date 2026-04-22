from __future__ import annotations

from dataclasses import asdict

from campus_ingestion_core.curriculum_budget_evaluation_shared import (
    CurriculumBudgetEvaluationReport,
    CurriculumBudgetProfileSpec,
)


def render_budget_eval_report(*, report: CurriculumBudgetEvaluationReport) -> str:
    lines = [
        "# Curriculum Budget Evaluation",
        "",
        f"- generated_at: `{report.generated_at}`",
        f"- document_count: `{report.document_count}`",
        f"- candidate_count: `{report.candidate_count}`",
        "",
        "## Candidate Summary",
        "",
        "| candidate | docs | chunks | oversize | missing_top_parent | missing_any_heading | probe_hit@1 | probe_hit@3 | final_p95 | final_max |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for candidate in report.candidates:
        aggregate = candidate.aggregate
        lines.append(
            "| "
            + " | ".join(
                [
                    candidate.name,
                    str(aggregate.document_count),
                    str(aggregate.total_chunks),
                    str(aggregate.oversize_chunk_count),
                    str(aggregate.missing_top_parent_count),
                    str(aggregate.missing_any_structural_heading_count),
                    f"{aggregate.probe_summary.complete_hit_at_1_count}/{aggregate.probe_summary.total_cases}",
                    f"{aggregate.probe_summary.complete_hit_at_3_count}/{aggregate.probe_summary.total_cases}",
                    str(aggregate.final_tokens.p95),
                    str(aggregate.final_tokens.max),
                ]
            )
            + " |"
        )
    for candidate in report.candidates:
        lines.extend(
            [
                "",
                f"## {candidate.name}",
                "",
                f"- default_profile: `{_format_profile(candidate.default_profile)}`",
                f"- table_profile: `{_format_profile(candidate.table_profile) if candidate.table_profile is not None else 'inherit-default'}`",
                f"- total_chunks: `{candidate.aggregate.total_chunks}`",
                f"- oversize_chunk_count: `{candidate.aggregate.oversize_chunk_count}`",
                f"- missing_top_parent_count: `{candidate.aggregate.missing_top_parent_count}`",
                f"- missing_any_structural_heading_count: `{candidate.aggregate.missing_any_structural_heading_count}`",
                f"- cue_only_chunk_count: `{candidate.aggregate.cue_only_chunk_count}`",
                f"- orphan_heading_only_count: `{candidate.aggregate.orphan_heading_only_count}`",
                f"- probe_summary: `{asdict(candidate.aggregate.probe_summary)}`",
                f"- final_tokens: `{asdict(candidate.aggregate.final_tokens)}`",
                "",
                "### Tier Breakdown",
                "",
            ]
        )
        for tier, aggregate in candidate.tier_aggregates.items():
            lines.append(
                f"- {tier}: docs={aggregate.document_count}, chunks={aggregate.total_chunks}, "
                f"oversize={aggregate.oversize_chunk_count}, missing_top_parent={aggregate.missing_top_parent_count}, "
                f"missing_any_heading={aggregate.missing_any_structural_heading_count}, "
                f"probe_hit@1={aggregate.probe_summary.complete_hit_at_1_count}/{aggregate.probe_summary.total_cases}, "
                f"probe_hit@3={aggregate.probe_summary.complete_hit_at_3_count}/{aggregate.probe_summary.total_cases}, "
                f"final_p95={aggregate.final_tokens.p95}, final_max={aggregate.final_tokens.max}"
            )
        lines.extend(["", "### Documents", ""])
        for document in candidate.documents:
            lines.append(
                f"- [{document.tier}] {document.title}: chunks={document.total_chunks}, oversize={document.oversize_chunk_count}, "
                f"missing_top_parent={document.missing_top_parent_count}, missing_any_heading={document.missing_any_structural_heading_count}, "
                f"cue_only={document.cue_only_chunk_count}, orphan_heading_only={document.orphan_heading_only_count}, "
                f"probe_hit@1={document.probe_summary.complete_hit_at_1_count}/{document.probe_summary.total_cases}, "
                f"probe_hit@3={document.probe_summary.complete_hit_at_3_count}/{document.probe_summary.total_cases}, final_max={document.final_tokens.max}"
            )
            for example in document.issue_examples[:3]:
                lines.append(
                    f"  - chunk {example.chunk_order} ({example.unit_type}) {','.join(example.issue_types)} "
                    f"[{example.final_token_count}/{example.budget_max}] {example.preview}"
                )
            if document.probe_results:
                lines.append("  - Probe Summary:")
                for probe_result in document.probe_results:
                    lines.append(
                        f"    - {probe_result.case_id}: top={probe_result.top_chunk_order or '-'} "
                        f"unit={probe_result.top_unit_type or '-'} "
                        f"complete_hit@1={probe_result.complete_hit_at_1} "
                        f"complete_hit@3={probe_result.complete_hit_at_3} "
                        f"preview={probe_result.top_preview}"
                    )
    return "\n".join(lines).rstrip() + "\n"


def _format_profile(profile: CurriculumBudgetProfileSpec | None) -> str:
    if profile is None:
        return "None"
    return f"{profile.chunk_size}/{profile.max_chunk_size}/{profile.chunk_overlap}/{profile.min_chunk_size}"


__all__ = ["render_budget_eval_report"]
