---
doc_type: operator-report
status: generated
created: 2026-04-28T12:50:00+08:00
---

# Schedule Batch Preview Gate

- Run id: `schedule-batch-preview-gate-20260428T125000`
- Remote write status: `not_written_pg_or_object_storage`
- Candidate count: `39`

## Bucket Counts

| Bucket | Count |
| --- | ---: |
| `auto_stage_candidate` | 13 |
| `manual_review` | 3 |
| `guide_adjacent_split` | 14 |
| `operational_only` | 4 |
| `already_staged` | 4 |
| `restage_needed` | 1 |
| `blocked` | 0 |

## Items

<!-- markdownlint-disable MD013 -->

| Notice id | Bucket | Candidate kind | State | Reasons |
| --- | --- | --- | --- | --- |
| `355881` | `already_staged` | `schedule_or_overlay_candidate` | staged selected release | guide_adjacent_fields_present, low_confidence_ocr, already_staged_selected_release |
| `355867` | `restage_needed` | `schedule_or_overlay_candidate` | staged selected release | explicit_restage_required |
| `355512` | `already_staged` | `schedule_or_overlay_candidate` | staged selected release | already_staged_selected_release |
| `355122` | `already_staged` | `schedule_or_overlay_candidate` | staged selected release | already_staged_selected_release |
| `354889` | `already_staged` | `schedule_or_overlay_candidate` | staged selected release | already_staged_selected_release |
| `354777` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, mixed_schedule_and_guide_ocr |
| `354578` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `354533` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `354505` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `354271` | `operational_only` | `schedule_or_overlay_candidate` | pending independent evaluation | open_ended_suspension_notice |
| `354270` | `manual_review` | `schedule_review_candidate` | pending independent evaluation | schedule_review_candidate |
| `353903` | `operational_only` | `operational_notice_candidate` | pending independent evaluation | operational_notice_candidate |
| `353901` | `manual_review` | `schedule_review_candidate` | pending independent evaluation | schedule_review_candidate |
| `352325` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, low_confidence_ocr, mixed_schedule_and_guide_ocr, router_visual_or_guide_image |
| `352218` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `351862` | `operational_only` | `operational_notice_candidate` | pending independent evaluation | operational_notice_candidate |
| `351696` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, mixed_schedule_and_guide_ocr |
| `351030` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `350030` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `349494` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `348880` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `348483` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `348457` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, low_confidence_ocr, mixed_schedule_and_guide_ocr, router_visual_or_guide_image |
| `348272` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, mixed_schedule_and_guide_ocr |
| `248186` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present, mixed_schedule_and_guide_ocr |
| `247970` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `247734` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `245395` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `245272` | `manual_review` | `schedule_or_overlay_candidate` | pending independent evaluation | non_image_attachment_requires_pdf_processing |
| `245271` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `244214` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `237479` | `operational_only` | `operational_notice_candidate` | pending independent evaluation | operational_notice_candidate |
| `233383` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `228282` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `203935` | `auto_stage_candidate` | `schedule_or_overlay_candidate` | pending independent evaluation | passes_no_write_preview_gate |
| `202713` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `196321` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `192180` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |
| `192087` | `guide_adjacent_split` | `schedule_or_overlay_candidate` | pending independent evaluation | guide_adjacent_fields_present |

<!-- markdownlint-enable MD013 -->
