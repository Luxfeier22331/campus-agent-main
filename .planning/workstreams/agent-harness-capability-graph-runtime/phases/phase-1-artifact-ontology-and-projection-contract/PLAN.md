---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Artifact Ontology And Projection Contract

## Goal

Define the first stable artifact vocabulary that the harness can resolve and validate.

## Tasks

1. Create `ARTIFACT-ONTOLOGY.md`.
1. Create `configs/runtime/workflow-artifacts.v1.json` as machine-readable artifact ontology.
1. Define artifact kind records for:
   - `NoticeContext`
   - `NoticeChangeSet`
   - `ScheduleBaseline`
   - `ServiceStatusFacts`
   - `ServiceGuideFacts`
   - `ContactDirectoryFacts`
   - `AcademicCalendarFacts`
   - `PlaceContext`
   - `EvidenceBundle`
   - `GroundingVerdict`
1. For each artifact record, define:
   - owner agent/tool
   - visibility
   - source ref posture
   - freshness posture
   - answer eligibility
   - grounding requirement
   - forbidden raw payload fields
1. Decide whether artifact metadata lives in existing workflow projection config or a new private
   runtime config.
1. Add fixture/contract tests for artifact kind names and raw leakage guard.

## Exit Criteria

- Artifact naming and semantics are stable.
- Phase 2 can extend registry without inventing artifact semantics.

## Verification

```bash
pnpm docs:lint
uv run --all-packages python -m unittest tests.supervisor.workflow_artifact_registry_suite -q
uv run --all-packages ruff check tests/supervisor/workflow_artifact_registry_suite.py
uv run --all-packages ruff format tests/supervisor/workflow_artifact_registry_suite.py --check
uv run --all-packages python -m unittest tests.contracts.contract_models_workflow_projection_refs_suite -q
cd apps/supervisor-api && go test ./internal/execution
```

## Completion Evidence

- `configs/runtime/workflow-artifacts.v1.json`
- `ARTIFACT-ONTOLOGY.md`
- `tests/supervisor/workflow_artifact_registry_suite.py`
