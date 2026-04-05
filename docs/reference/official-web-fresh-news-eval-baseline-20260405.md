---
doc_type: reference
status: active
created: 2026-04-05
updated: 2026-04-05
---

# official_web fresh_news Seed Eval Baseline Evidence (2026-04-05)

## Scope

This note records the first repo-tracked retrieval/live-gate baseline for the
current `official_web/fresh_news` seed set.

It is evidence for:

- repo-tracked `fresh_news` split manifest and retrieval qrels truth
- deterministic `fresh_news` seed live-gate wiring
- one real local physical collection for the current `8`-document seed set

It is not evidence for:

- opening `official_web/fresh_news` as a default query-serving surface
- freshness-sensitive routing / time-window policy closure
- `news_archive` readiness

## Repo-Tracked Baseline

- split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json`
- deterministic live gate:
  `packages/evals/src/campus_evals/scenarios.py` ->
  `official_web_fresh_news_release_gate_cases()`
- live benchmark entry:
  `uv run --all-packages python -m campus_evals.official_web_live_benchmark ... --official-web-scope fresh_news`

Baseline content:

- `8` retrieval qrels cases for the current fresh-news handoff seed set
- `8` deterministic live-gate cases for exact-title asks only

## Local Import And Release

Input replay:

- `/tmp/official-web-qc-20260401-batch-d-clean-subset`
- `/tmp/official-web-qc-20260401-batch-d-clean-subset-projection-fresh-news-20260405-v1`

Observed routing/import truth:

- routed `fresh_news` replay output included the `8` expected seed documents
- three cross-host duplicate pages were skipped during import
  - `official_web:muc_public:article_detail:bcf72fd4fa16eca1d69a8e5d0704821411f07510`
  - `official_web:muc_public:article_detail:3596a212f9e51424945bb380ac178e89ab445ba6`
  - `official_web:muc_public:article_detail:595612debb1755badffb0032a21c7df317afbd11`
- effective imported seed truth remained `8` documents

Execution note:

- the shared Postgres registry pooler was saturated during CLI import
- local validation therefore reused the existing injected-registry path:
  real MinIO + real Qdrant, but in-memory registry instances for this one local
  validation run
- this preserves the local chain validation goal without claiming that shared
  registry current truth was updated

Release result:

- release id: `r20260404_222909`
- physical collection:
  `official_web_fresh_news__r20260404_222909`
- validation status: `passed`
- document count: `8`
- point count: `27`
- published at: `null`

## Retrieval Live Benchmark

Executed:

```bash
uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json \
  --output /tmp/official-web-fresh-news-live-retrieval-20260405.json \
  --format json \
  --force-enable-retrieval \
  --qdrant-collection-name official_web_fresh_news__r20260404_222909
```

Observed summary:

- `total_cases=8`
- `hit_at_1=1.0`
- `hit_at_3=1.0`
- `recall_at_5=1.0`
- `doc_hit_at_1=1.0`
- `doc_recall_at_5=1.0`
- `forbidden_hit_rate=0.0`

Artifact:

- `/tmp/official-web-fresh-news-live-retrieval-20260405.json`

## Deterministic Live Gate

Executed:

```bash
uv run --all-packages python -m campus_evals.official_web_live_benchmark run \
  --reruns 1 \
  --official-web-scope fresh_news \
  --qdrant-collection-name official_web_fresh_news__r20260404_222909 \
  --output-dir /tmp/official-web-fresh-news-live-gate-20260405
```

Observed summary:

- `benchmark_type=official_web_fresh_news_live_gate`
- `total_cases=8`
- `completed=8`
- `deterministic mean_pass_rate=1.0`
- `gate verdict=pass`

Artifacts:

- `/tmp/official-web-fresh-news-live-gate-20260405/summary.json`
- `/tmp/official-web-fresh-news-live-gate-20260405/gate-report.json`
- `/tmp/official-web-fresh-news-live-gate-20260405/SUMMARY.md`

## Conclusion

Current truth after this execution:

- `official_web/fresh_news` now has a repo-tracked seed eval baseline
- the current `8`-document handoff seed set can be imported into one local
  physical collection without retaining cross-host duplicate documents
- retrieval and deterministic answer-path validation both passed for the seed
  set
- runtime truth remains `offline_preparation`; freshness-sensitive serving and
  `news_archive` split are still separate follow-up work
