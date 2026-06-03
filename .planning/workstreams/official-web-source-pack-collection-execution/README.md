---
doc_type: index
status: completed
created: 2026-05-03
updated: 2026-05-06
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
- current slice: source-pack batch no-promotion seam, public regulation closeout expansion,
  offline composition and ingestion-owned selected-write admission proof are implemented and
  verified; academic calendar structured release evidence is recorded as a one-time curated
  projection follow-up
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

## Public Regulation Materialization Evidence

The successful source-pack replay has now been carried one step further into
public regulation materialization proof without reopening broad crawl or moving
release ownership into app-api.

- materialization summary:
  [official-web-regulation-materialization-summary.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-materialization-proof-20260506/official-web-regulation-materialization-summary.json)
- canonical/report detail:
  [materialization-report.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-materialization-proof-20260506/materialization-report.json)
- docs read-model manifest:
  [docs-read-model-manifest.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-materialization-proof-20260506/docs-read-model-manifest.json)

Accepted current result:

- `official-web-regulation-expansion.v1` currently materializes `8` public regulation documents
- scopes:
  - `regulations/institutional_rules = 7`
  - `regulations/student_rules = 1`
- docs reader assets were generated for all `8` materialized documents
- obvious non-rule fragments such as `引进高端人才需提交材料` are now fail-closed before
  regulation candidate materialization
- rejected or attachment-only source-pack preview regulation pages no longer fall back into
  ordinary `official_web/muc_public_pages` document projection; the current proof records
  `emitted_documents=0`

## Public Regulation Closeout Evidence

The expanded closeout batch now proves the full one-time public regulation closeout path:
explicit source-pack seed capture, same-host listing expansion, no-promotion live seam, and
regulation materialization into canonical docs-reader-ready assets.

- live seam evidence:
  [seam-report.json](/home/reptilian/code/campus-agent/var/official-web-source-pack-live-seam/owrun_source_pack_live_20260506T092515Z/seam-report.json)
- materialization summary:
  [official-web-regulation-materialization-summary.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-closeout-20260506/official-web-regulation-materialization-summary.json)
- canonical/report detail:
  [materialization-report.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-closeout-20260506/materialization-report.json)
- docs read-model manifest:
  [docs-read-model-manifest.json](/home/reptilian/code/campus-agent/.planning/workstreams/official-web-source-pack-collection-execution/evidence/public-regulation-closeout-20260506/docs-read-model-manifest.json)

Accepted closeout result:

- source-pack: `official-web-public-regulation-closeout.v1`
- retained source-truth pages: `40`
- consumer target family counts:
  - `regulation_candidate = 23`
  - `student_regulation_candidate = 17`
- materialized documents: `23`
- scope split:
  - `regulations/institutional_rules = 17`
  - `regulations/student_rules = 6`
- docs reader assets:
  - `document_count = 23`
  - `public_entry_count = 23`
- closeout captured both explicit regulation references and downstream-consumed listing expansions
  without reopening broad crawl
- post-fix refresh now includes:
  - `https://xxgk.muc.edu.cn/info/1005/1107.htm`
  - `中央民族大学信息公开实施细则`
- downstream consumption closeout is now explicit and repo-tracked:
  - one shared manifest:
    [public-regulation-consumption.v1.json](/home/reptilian/code/campus-agent/configs/ingestion/regulations/public-regulation-consumption.v1.json)
  - `23` docs are grouped for docs/read-model consumption into:
    - `student = 6`
    - `public_service = 10`
    - `staff_governance = 7`
  - `public-docs` real-docs and published-reader surfaces now consume the same grouping manifest
  - `regulations/institutional_rules` default RAG exposure now fail-closes to the `public_service`
    subset unless the query matches explicit staff-governance titles or governance signal terms
  - repo-tracked overlap/version ledger now distinguishes handbook overlap from `net_new` official-web
    regulation docs:
    [public-regulation-handbook-overlap-ledger.v1.json](/home/reptilian/code/campus-agent/configs/ingestion/regulations/public-regulation-handbook-overlap-ledger.v1.json)
  - next one-time source-pack expansion is split explicitly into:
    - HTML-direct `net_new` student/public regulations:
      [official-web-public-regulation-net-new-student-html.v1.json](/home/reptilian/code/campus-agent/configs/sources/official_web/muc_public/source-packs/official-web-public-regulation-net-new-student-html.v1.json)
    - download-reference follow-up pages waiting on shared file-asset admission:
      [official-web-public-regulation-net-new-download-followup.v1.json](/home/reptilian/code/campus-agent/configs/sources/official_web/muc_public/source-packs/official-web-public-regulation-net-new-download-followup.v1.json)
