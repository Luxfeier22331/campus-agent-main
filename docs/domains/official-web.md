---
doc_type: index
truth_scope: data
owner_boundary: domains/official-web
status: active
created: 2026-04-12
updated: 2026-04-20
---
# Official Web Domain

## Boundary

This domain hub is a cross-document navigation entry for `official_web`.
It does not own current status, historical evidence, source schema, HTTP
contract, runbook procedure or release proof.

Current merged truth remains in `../architecture/current.md`.
Documentation ownership rules remain in `../documentation-architecture.md`.

## Architecture

- `../architecture/domains/official-web/architecture.md`
- `../architecture/domains/official-web/freshness-and-incremental-crawling.md`
- `../architecture/domains/official-web/serving-and-news-retrieval-strategy.md`

## Contracts And Data

- `../contracts/app-api-official-web-http.md`
- `../contracts/app-api-official-web-run-lifecycle.md`
- `../data/app-api-official-web-schema.md`
- `../data/official-web-source-truth-schema.md`

## Decisions

- `../decisions/adr-0018-app-api-official-web-control-plane-ownership.md`

## Runbooks

- `../runbooks/official-web-dynamic-shell-discovery.md`
- `../runbooks/ingestion-control-clean-target-runbook.md`
- historical Python ingestion worker runbook bodies have left branch tip. Use
  git history when a specific old collector smoke or projection replay fragment
  must be recovered.

## Reference And Policy

- `../reference/official-web-eval.md`
- `../policies/official-web-crawl-policy.md`
- `../policies/official-web-cleaning-and-chunking-policy.md`

## Archive

- `../reference/archive/official-web/README.md`
