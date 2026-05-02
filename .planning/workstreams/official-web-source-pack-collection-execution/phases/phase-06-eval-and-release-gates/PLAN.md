---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Eval And Release Gates

## Goal

Prove the source pack can be consumed safely by downstream tools and retrieval surfaces before
release.

## Tasks

- Add eval cases for each owner surface.
- Add fail-close cases for excluded content and transactional requests.
- Add source-grounding checks for source refs and unsupported fact suppression.
- Add no-promotion release preview check.
- Add runtime smoke only after no-promotion preview passes.
- Record release readiness per manifest row.

## Acceptance Criteria

- Tool routing selects the expected owner surface for representative questions.
- Answers cite source refs.
- Missing source facts are not invented.
- Excluded questions fail closed.
- Release preview is deterministic from the same source-truth bundle.
- Selected-write and stable-reference releases are blocked until replay and eval pass.

## Verification

```bash
uv run --all-packages python -m unittest discover -s tests/evals -t .
pnpm web:test
```
