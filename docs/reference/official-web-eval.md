---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-06-27
updated: 2026-06-27
---
# Official Web Eval

## Boundary

This document records the current eval baselines for `official_web` serving
surfaces. It owns denominator and metric snapshots only.

It does not prove runtime opening. Serving and opening policy stays in
`docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`.

## Stable Reference

Repo-tracked baseline inputs:

- split manifest:
  `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/rag/official_web_stable_reference/retrieval_qrels.json`
- deterministic release-gate cases:
  `packages/evals/src/campus_evals/scenarios.py`

Current denominator:

- `4` retrieval qrels cases:
  - `3` positive stable-reference page cases
  - `1` no-hit case
- `5` deterministic live-gate cases:
  - `3` completed stable-reference pages
  - `2` expected fail-close cases

Accepted snapshot:

- alias: `official_web_stable_reference`
- retrieval `total_cases = 4`
- deterministic release gate `total_cases = 5`
- deterministic release gate `completed = 3`
- deterministic release gate `no_answer = 2`

The `no_answer` cases are expected fail-close behavior, not missing coverage.

## Fresh News

Repo-tracked baseline inputs:

- split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/rag/official_web_fresh_news/retrieval_qrels.json`
- deterministic seed cases:
  `packages/evals/src/campus_evals/scenarios.py`

Current denominator:

- `8` retrieval qrels cases for the fresh-news handoff seed set
- `8` deterministic exact-title seed cases for future news opening work

Accepted snapshot:

- effective seed documents: `8`
- cross-host duplicate skips: `3`
- validated physical collection: `official_web_fresh_news__r20260404_222909`
- retrieval `total_cases = 8`
- retrieval `hit_at_1 = 1.0`
- retrieval `hit_at_3 = 1.0`
- retrieval `recall_at_5 = 1.0`
- retrieval `doc_hit_at_1 = 1.0`
- retrieval `doc_recall_at_5 = 1.0`
- retrieval `forbidden_hit_rate = 0.0`

This baseline covers exact-title seed validation only. It does not cover
freshness-sensitive asks such as `今天`, `最新`, or `最近`.

## Maintenance

Update this document only when one of these changes:

- split manifest denominator
- qrels denominator
- live-gate case denominator
- accepted baseline verdict

One-off `.tmp` artifacts, rerun logs, and runtime workaround notes do not belong
in this active baseline.
