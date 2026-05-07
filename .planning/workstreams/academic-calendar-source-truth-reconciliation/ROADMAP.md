---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Roadmap: Academic Calendar Source Truth Reconciliation

## Overview

Execution order:

```text
evidence audit -> schema/precedence -> source artifacts -> projection
-> resolver -> planner/eval -> release/smoke -> docs/closeout
```

This workstream extends `academic_calendar_lookup` correctness by fixing the
data-plane truth that feeds it.

## Phases

- [x] **Phase 0: Evidence Audit And Boundary Freeze**
  - Inventory current calendar records around `2026-04-25` to `2026-05-09`
  - Extract authoritative text from notices `355589` and `355682`
  - Confirm whether `春季社会实践周` source notice is captured and whether it
    should be source evidence or only referenced by `355682`
  - Record exact conflict: curated `2026-05-09` vs notice `正常公休`
  - Freeze non-goals: no runtime raw notice scan, no official `春假` event name,
    no standalone calendar agent
  - Produce `phases/phase-0-evidence-audit-and-boundary-freeze/SUMMARY.md`

- [x] **Phase 1: Calendar Fact Schema And Precedence Contract**
  - Extend projection model for source family/provenance and precedence
  - Add record families for `course_suspension`, `normal_rest_day` and
    `workday_makeup`
  - Define alias record semantics for colloquial labels such as `春假`
  - Define conflict taxonomy and release-blocking rules
  - Update contract tests and projection validation tests first

- [x] **Phase 2: Notice-derived Calendar Arrangement Source Artifacts**
  - Add curated source artifact(s) for selected authenticated notice calendar
    arrangements
  - Include source refs, notice ids, official title, affected audiences,
    date ranges and arrangement types
  - Avoid hand-coded runtime exceptions
  - Update `source-truth.v1.json` to admit the selected notice-derived source
    truth

- [x] **Phase 3: Reconciled Projection Builder And Doctor**
  - Merge baseline calendar and notice-derived arrangement facts
  - Apply precedence rules deterministically
  - Emit conflict report and release validation summary
  - Correct `2026-05-09` via notice override
  - Add doctor checks for missing source refs, overlapping conflicts and alias
    targets

- [x] **Phase 4: Structured Query Runtime Reconciliation**
  - Update Go resolver to prefer reconciled day-status facts over baseline
    teaching-week facts for day-status questions
  - Return composite `春假` answer with official wording and separated ranges
  - Preserve existing date-week and term-window behavior
  - Add focused runtime tests for the six target questions

- [x] **Phase 5: Planner, Adapter And Eval Denominator**
  - Update planner/intent cues so colloquial `春假` fact questions route to
    `academic_calendar_lookup`
  - Keep `找春假通知原文` routed to notice lookup
  - Update campus-services adapter answer wording
  - Add public-chat/product-path fixture coverage without requiring real
    staging smoke in this workstream

- [x] **Phase 6: Release, Smoke And Documentation Closeout**
  - Build and validate reconciled projection
  - Publish current projection/read model when local PG/object-store env is
    available
  - Run focused Go/Python tests and docs lint
  - Update calendar README and architecture docs
  - Update `STATE.md`, `GAP-LEDGER.md` and registry status

## Verification Plan

Focused commands:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_academic_calendar_projection \
  tests.ingestion.official_web_projection_academic_calendar_suite \
  tests.test_publish_academic_calendar_projection -q

cd apps/supervisor-api
go test -count=1 ./internal/structuredquery ./internal/structuredplanning

uv run --all-packages python -m unittest \
  tests.agent.campus_services_academic_calendar_suite \
  tests.contracts.contract_models_services_and_notice_suite \
  tests.evals.public_chat_entry_e2e_suite -q

pnpm docs:lint
uv run --all-packages ruff check packages/ingestion-core packages/campus-services-agent tests
uv run --all-packages ruff format packages/ingestion-core packages/campus-services-agent tests --check
```

Data-plane smoke:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-07T00:00:00+08:00
```

If `CAMPUS_SHARED_POSTGRES_URL` is available, add:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-07T00:00:00+08:00 \
  --database-url "$CAMPUS_SHARED_POSTGRES_URL" \
  --promote-current
```

## Exit Criteria

- Prior `2026-05-09` conflict is detected and resolved by source precedence
- Colloquial `春假` resolves to source-backed official composite arrangement
- Runtime does not query raw notice/source assets at query time
- Regression tests cover routing, projection, resolver and answer wording
- Planning/docs reflect reconciled source truth as the forward architecture
