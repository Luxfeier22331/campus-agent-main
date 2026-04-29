---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
phase: Phase 8
workstream: authenticated-notice-service-status-consumption
---
# Phase 8 Summary: Broader Live Family Coverage

<!-- markdownlint-disable MD013 -->

## Outcome

Phase 8 expanded the Phase 7 single live facility loop to real authenticated
notice export samples across IT platform, library, service-counter and
additional facility/service-counter status families.

The selected export bundle contains six real notice ids:

- `247726` — campus card / network fee / electricity recharge shutdown
- `352345` — library National Day / Mid-Autumn holiday arrangement
- `354502` — logistics service hall and facility holiday service adjustment
- `354575` — campus hospital holiday duty arrangement
- `354674` — information portal maintenance outage
- `354845` — Fengtai campus hospital dermatology clinic opening

All six now reach `campus_services/service_status_candidate` admission and have
typed materialization disposition evidence. No regulation, schedule,
service-guide, contact-directory or generic notice-query item is counted as a
service-status success.

## Disposition

| Notice | Family | Disposition | Evidence |
| --- | --- | --- | --- |
| `247726` | IT platform | Materialized as historical campus-card recharge shutdown | `evidence/phase-08-broader-live-family-coverage/service-status-preview-20251230/` |
| `352345` | Library | Materialized as historical limited library service | `evidence/phase-08-broader-live-family-coverage/service-status-preview-20251002/` |
| `354502` | Service counter | Materialized as historical comprehensive service hall limited service | `evidence/phase-08-broader-live-family-coverage/service-status-preview-20260211/` |
| `354575` | Service counter | Materialized as historical campus hospital holiday duty limited service | `evidence/phase-08-broader-live-family-coverage/service-status-preview-20260211/` |
| `354674` | IT platform | Materialized as historical information portal outage | `evidence/phase-08-broader-live-family-coverage/service-status-preview-20260211/` |
| `354845` | Service counter | Materialized as open-ended current-preview hospital dermatology clinic service | `evidence/phase-08-broader-live-family-coverage/service-status-preview-current-20260428/` |

## Implementation Notes

- Routing taxonomy now admits campus-card recharge shutdown and campus hospital
  service-status notices as `service_status_candidate`.
- The service-status materializer now handles:
  - full-to-yearless datetime ranges, such as `2026年2月11日20:00—2月12日07:00`;
  - cross-year recharge shutdown windows;
  - library holiday date-only windows;
  - logistics service hall sections without borrowing unrelated facility times;
  - campus hospital holiday duty windows;
  - open-ended new clinic service counters.
- Status-note extraction now strips leading Markdown document titles and avoids
  falling back to full canonical Markdown when the usable status sentence is a
  Markdown heading or a later body segment.
- Stale Phase 8 preview directories were removed. The retained evidence uses
  explicit time anchors: current `2026-04-28`, historical `2026-02-11`,
  `2025-10-02`, and `2025-12-30`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_list_internal_notice_service_status_candidates_worker \
  tests.ingestion.test_authenticated_notice_routing_sampling \
  -q
```

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/notice_derived_service_status_materialization.py \
  tests/ingestion/test_notice_derived_service_status_materialization.py \
  tests/ingestion/test_authenticated_notice_routing_sampling.py
```

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/notice_derived_service_status_materialization.py \
  tests/ingestion/test_notice_derived_service_status_materialization.py \
  tests/ingestion/test_authenticated_notice_routing_sampling.py
```

## Closeout

Phase 8 is implemented. The workstream should remain active until the user makes
an explicit archive decision; no automatic archive is implied by this summary.
