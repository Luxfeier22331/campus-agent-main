---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Contract-First Schema Canonicalization

## Goal

Freeze the grouped service-guide procedure and focused answer contract before implementation.

## Inputs

- `.planning/workstreams/official-web-service-guide-consumption-quality-closeout/GAP-REVIEW.md`
- `docs/contracts/service-guide-lookup-contract.md`
- `docs/data/campus-services-service-guide-source-truth-schema.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `packages/contracts/src/campus_contracts/models_tools.py`
- `apps/supervisor-api/internal/structuredquery/service_guide_types.go`
- `packages/campus-services-agent/src/campus_services_agent/http_query_service.py`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `packages/evals/fixtures/provider_function_tools.v1.json`

## Tasks

1. Define the canonical grouped procedure shape:
   - stable group id
   - title
   - focus tags / intent hints
   - ordered steps
   - group-level and step-level source refs
   - compatibility mapping into `guide_sections`
2. Define focused result metadata:
   - selected section ids
   - omitted section ids and reasons
   - field status for source-provided / source-not-provided fields
   - field-level source URL/ref coverage
3. Update architecture and data contract docs so source-truth, candidate, projection, typed
   read-model and runtime answer shapes are distinct.
4. Update `packages/contracts` dataclasses and shared literals before touching runtime code.
5. Update Go structured query structs and TypeScript consumers or explicitly document
   non-consumer surfaces.
6. Add at least one cross-language golden fixture for a VPN-like service-guide record with direct,
   client and mobile procedure groups.
7. Check provider tool schema and eval denominator fixtures for drift.

## Acceptance Criteria

- Contract docs and code agree on grouped procedure and focused result fields.
- Python, Go and TypeScript contract/golden tests cover the same fixture or document why a surface
  is not a consumer.
- Existing flat `guide_sections` consumers have an explicit compatibility mapping.
- No implementation phase can add runtime behavior that bypasses this contract.

## Verification

```bash
pnpm docs:lint
pnpm web:typecheck:affected
uv run --all-packages ruff check packages/contracts packages/campus-services-agent
uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- final grouped procedure schema
- focused result metadata schema
- changed docs/contracts/files
- golden fixture path
- compatibility decisions
- verification evidence
