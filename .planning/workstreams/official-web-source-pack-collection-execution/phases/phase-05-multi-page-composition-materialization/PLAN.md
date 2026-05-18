---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Multi-Page Composition Materialization

## Goal

Materialize multi-page topics offline so runtime tools do not stitch source pages at query time.

## Tasks

- Define composition roles for `information_disclosure`:
  - policy source
  - procedure source
  - material source
  - contact source
- Build composed service-guide projection with field-level source refs.
- Keep policy/rule answers separate from service procedure answers.
- Keep contact directory output separate from service guide output.
- Add negative tests proving missing component pages produce blocked/deferred composition, not
  partial unsupported answers.

## Acceptance Criteria

- Information disclosure application guide can cite process, form and contact component sources.
- Disclosure scope answers cite the policy source, not the service guide projection.
- Runtime service guide lookup consumes a composed projection, not live page HTML.
- Missing optional component fields do not block if source does not provide them.

## Verification

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t .
uv run --all-packages python -m unittest discover -s tests/evals -t .
```
