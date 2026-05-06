---
doc_type: index
status: active
created: 2026-05-03
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Source Pack Collection Execution

This native workstream owns the collection execution plan for the first tool-driven official-web
source pack.

It starts after `official-web-tool-driven-source-pack` freezes downstream demand and answers a
narrower execution question:

- how the approved source-pack manifest is validated
- how admitted URLs are captured once without reopening broad crawl
- how captured pages become `capture/`, `provider/` and `source-truth/` artifacts
- how ingestion replays those artifacts into structured candidates, stable references or blocked
  outcomes
- how release gates and eval prove that downstream tools can safely consume the results

## Current Status

- status: `completed`
- current phase: `Phase 7 closeout complete`
- current slice: source-pack batch no-promotion seam, offline composition and ingestion-owned
  selected-write admission proof are implemented and verified; academic calendar structured
  release evidence is recorded as a one-time curated projection follow-up
- active implementation: none
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- manifest contract: `./SOURCE-PACK-MANIFEST-CONTRACT.md`
- collection execution plan: `./COLLECTION-EXECUTION-PLAN.md`
- ingestion and release gates: `./INGESTION-REPLAY-AND-RELEASE-GATES.md`
- eval acceptance matrix: `./EVAL-ACCEPTANCE-MATRIX.md`

## Phase Plans

- Phase 0: `./phases/phase-00-boundary-and-upstream-handoff/PLAN.md`
- Phase 1: `./phases/phase-01-manifest-contract-and-validation/PLAN.md`
- Phase 2: `./phases/phase-02-first-slice-manifest-population/PLAN.md`
- Phase 3: `./phases/phase-03-one-time-capture-and-source-truth/PLAN.md`
- Phase 4: `./phases/phase-04-ingestion-replay-and-projection-fanout/PLAN.md`
- Phase 5: `./phases/phase-05-multi-page-composition-materialization/PLAN.md`
- Phase 6: `./phases/phase-06-eval-and-release-gates/PLAN.md`
- Phase 7: `./phases/phase-07-closeout-refresh-and-deferral/PLAN.md`

## Boundary Notes

- This workstream does not reopen broad crawl.
- This workstream does not replace `official-web-tool-driven-source-pack`; it consumes that
  workstream's demand matrix and source collection cases.
- This workstream does not make collector choose URLs from host or seed expansion.
- This workstream does not open `official_web/fresh_news` or `official_web/news_archive`.
- This workstream does not move selected-write or release task ownership into `apps/app-api`.
- This workstream does not make runtime tools fetch or compose official-web pages at query time.
- This workstream may add a repo-tracked source-pack manifest, manifest validator, one-time capture
  runbook, dry-run replay gate and eval denominator.

## Relationship To Existing Workstreams

- `official-web-tool-driven-source-pack` owns downstream demand and content-family selection.
- This workstream starts after that demand handoff; it owns manifest, capture, replay, release
  preview and eval implementation.
- `official-web-targeted-collection-refactor` completed the target-first collector execution shape.
- `official-web-target-inventory` completed target inventory and selected-write handoff.
- `official-web-service-info-denominator-realism` fixed source-faithful optional denominator
  semantics.
- This workstream turns the accepted source-pack demand into a deterministic collection execution
  path without restoring collector automation as the source of scope.

## Closeout Evidence

- live seam evidence:
  [seam-report.json](/home/reptilian/code/campus-agent/var/official-web-source-pack-live-seam/owrun_source_pack_live_20260505T122144Z/seam-report.json)
- closeout script:
  [official_web_source_pack_no_promotion.py](/home/reptilian/code/campus-agent/scripts/official_web_source_pack_no_promotion.py)
- replay / seam tests:
  [test_official_web_source_pack_no_promotion_script.py](/home/reptilian/code/campus-agent/tests/ingestion/test_official_web_source_pack_no_promotion_script.py)

Accepted closeout semantics:

- source-pack no-promotion seam must prove collector completion, source-truth lineage coverage,
  app-api staged execution, and ingestion-owned selected-write release task admission when the
  consumer review reaches `dry_run_ready` or `partial_dry_run_ready`
- current-truth mutation remains out of scope for this workstream; that belongs to the ingestion
  release lane

## Academic Calendar Evidence

Academic calendar facts are not handled by reopening official-web collection. They are covered by a
curated structured projection under `calendar/academic_calendar`.

- release evidence:
  [publish-report.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/academic-calendar-structured-release/publish-report.json)
- runtime smoke:
  [runtime-smoke-report.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/academic-calendar-structured-release/runtime-smoke-report.json)
- config:
  [README.md](/home/reptilian/code/campus-agent/configs/ingestion/calendar/academic_calendar/README.md)

Accepted semantics:

- one-time curated source truth feeds selected-write structured projection publish
- current runtime consumes `calendar/academic_calendar` for teaching week, holiday, and makeup-class
  facts
- official-web page/image refs remain evidence, not query-time web fetch or recurring collector
  scope

## Public Regulation Expansion

Additional public regulation expansion remains target-first and one-time:

- no broad official-web collector restart
- expansion batches should use explicit alternate source-pack ids
- public regulation routing is now split conservatively:
  - `regulation_candidate` -> `regulations/institutional_rules`
  - `student_regulation_candidate` -> `regulations/student_rules`
- `official-web-regulation-expansion.v1` is the repo-tracked student/public
  regulation expansion manifest for one-time listing-page requeue on
  `xxgk.muc.edu.cn`
