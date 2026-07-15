---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0070
status: superseded
created: 2026-07-08
updated: 2026-07-08
supersedes: []
superseded_by: adr-0077-ingestion.md
---
# ADR-0070 Official Web Target-First Consumption

## Status

Superseded by ADR-0077 on 2026-07-13. Official-web now has capture and URL
freshness only; the compatibility task and target-workset lifecycle described
below were removed.

## Context

`official_web` already has a useful source-collector and ingestion-control
control-plane path: collector runs are admitted, artifacts are written to the
source bucket, terminal runs are projected, and operator state is visible.

The consumption model was less clear. Several docs and configs made it easy to
read the chain as if `source_truth_materialize` had already produced query-ready
documents, chunks, indexes and release aliases. In code, the current official-web
task only verifies source-truth refs and returns artifact refs. Separately,
`fresh_news` had serving/runtime configuration while the source target map still
declared notice/news as `inventory_only`.

Without a stronger boundary, the system would preserve a false middle state:
source capture exists, but the docs imply full RAG consumption.

## Decision

Adopt target-first official-web consumption.

Official-web source truth is only the upstream page truth. It does not open a
collection, query-serving scope, release gate, index or alias by itself.

The official-web consumption chain is accepted only when these steps exist for a
target:

1. source capture
2. crawl-run finalize
3. source-truth ref verification
4. target admission
5. document or structured projection materialization
6. document-units validation when document materialization is used
7. chunk preparation when query-serving is used
8. index build when query-serving is used
9. release manifest validation
10. release gate approval when required
11. current pointer or serving alias publish
12. operator projection

`source_truth_materialize` remains a compatibility task name in existing
registry/code, but architecture docs must describe its current official-web
semantics as source-truth verification/ref handoff until a real materializer is
implemented.

`official_web/fresh_news` remains reserved until source admission, freshness
gate, document/chunk/index/release and publish semantics are all implemented.
Its config files and runtime scope entries are not proof that the collection is
query-ready.

`projection-declarations.json` must not be treated as a broad crawl fan-out
owner. It may only guide page-family action after target admission.

## Alternatives Considered

### Keep the Current Names and Fill the Gaps Later

This keeps diffs small, but preserves the misleading idea that materialization
already happened. Rejected because it lets docs, config and operator surfaces
overpromise query readiness.

### Treat `official_web/*` as One General Web Corpus

This would be simpler on paper, but it mixes stable reference, news, regulations,
calendar and curriculum semantics. Rejected because downstream owners need
different freshness, review, release and serving policies.

### Move Official-Web Consumption Into App-API

This would put operator command and executor behavior in one service. Rejected
because app-api must not own source-truth replay, Temporal execution, document
materialization, index mutation or alias publish.

## Consequences

- Official-web docs must separate current source-truth verification from target
  materialization and serving publish.
- `fresh_news` must be described as reserved until the full chain exists.
- Target admission must be explicit and target-first; broad crawl evidence cannot
  silently become stable-reference documents.
- App-api remains an operator/projection surface, not an ingestion executor.
- Future implementation work should first add the missing
  source-truth-to-document/chunk/index/release steps for one target, rather than
  adding more profile-only surfaces.
