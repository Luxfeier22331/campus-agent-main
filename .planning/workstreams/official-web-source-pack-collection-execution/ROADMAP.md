---
doc_type: roadmap
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Source Pack Collection Execution

## Overview

This workstream turns the tool-driven official-web source pack into an executable, verifiable
collection chain.

It deliberately separates:

- demand selection, owned by `official-web-tool-driven-source-pack`
- collection execution, owned by this workstream
- offline selected-write / release state machine, owned by ingestion
- runtime answering, owned by released tool projections and retrieval surfaces

## Phase Status

- [x] **Phase 0: Boundary And Upstream Handoff** - Create the workstream, freeze its relationship to
  source-pack demand, and record the execution boundary.
- [x] **Phase 1: Manifest Contract And Validation** - Define the source-pack manifest schema,
  validation rules and drift checks against existing target-source-map / consumer denominator.
- [x] **Phase 2: First-Slice Manifest Population** - Populate the initial manifest from accepted
  demand rows and collection cases, with explicit release targets and expected facts per URL.
- [x] **Phase 3: One-Time Capture And Source Truth** - Execute a no-broad-crawl capture path for
  manifest URLs and verify canonical `capture/`, `provider/` and `source-truth/` artifacts.
- [x] **Phase 4: Ingestion Replay And Projection Fan-Out** - Replay source truth into service guide,
  contact directory, stable-reference, regulation or blocked/deferred outcomes.
- [x] **Phase 5: Multi-Page Composition Materialization** - Materialize composition groups such as
  information disclosure offline, preserving per-field source references.
- [x] **Phase 6: Eval And Release Gates** - Add release-preview and runtime/eval acceptance gates for
  tool selection, answer shape, source citation and fail-close behavior.
- [x] **Phase 7: Closeout, Refresh And Deferral** - Record captured inventory, unresolved blockers,
  future manifest refresh rules and collector automation deferral criteria.

## Implementation Dependency

1. Phase 0 confirms this workstream does not own source selection policy.
2. Phase 1 must complete before any manifest row is used for capture.
3. Phase 2 may only include URLs tied to downstream demand rows.
4. Phase 3 may only capture validated manifest URLs.
5. Phase 4 may only consume source-truth artifacts, not live source pages.
6. Phase 5 must complete before runtime treats multi-page topics as one answerable service guide.
7. Phase 6 must pass before selected-write or stable-reference outputs are considered release-ready.
8. Phase 7 closes only after future refresh and collector automation are explicitly bounded.

## Phase Promotion Rule

- Do not promote a phase unless the previous phase has a `SUMMARY.md` or equivalent closeout note.
- Do not collect a URL without manifest validation.
- Do not treat a captured source page as current truth before ingestion replay and release gate.
- Do not promote optional missing fields to blockers if the source does not provide them.
- Do not use human review as the normal path; machine gates should produce ready, blocked,
  deferred or inventory-only states.
- Do not write selected structured projections from collector output.

## Close Rule

Close this workstream only after:

- source-pack manifest contract and initial manifest are tracked
- one-time capture evidence exists for all ready manifest rows
- source-truth artifacts validate against the canonical official-web source-truth schema
- ingestion replay emits expected typed candidates / stable documents / blocked outcomes
- information-disclosure composition is offline and source-linked
- no-promotion preview demonstrates release writes before any current-truth mutation and, when a
  candidate batch is `dry_run_ready` or `partial_dry_run_ready`, ingestion-owned selected-write
  release task admission is proven for ready records
- eval proves downstream tool/surface consumption for representative campus user questions
- future refresh remains manifest-driven and automation deferral is explicit

## Implementation Status

The code path for this roadmap is now in tree:

- manifest validation and planning live in `apps/official-web-collector`
- source-pack lineage is carried into collector page artifacts and source-truth bundle pages
- ingestion replay performs offline `information_disclosure` composition
- batch no-promotion seam exists as `scripts/official_web_source_pack_no_promotion.py`

Closeout evidence is in tree:

- real source-pack no-promotion seam completed and can be resumed/rebuilt from artifacts
- seam assertions now require ingestion-owned selected-write release task admission when review is
  `dry_run_ready` or `partial_dry_run_ready`

The next work is not more source-pack collection design. It belongs to the ingestion release lane.
