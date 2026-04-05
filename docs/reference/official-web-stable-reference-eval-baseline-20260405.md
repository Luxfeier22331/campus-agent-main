---
doc_type: reference
status: active
created: 2026-04-05
updated: 2026-04-05
---

# official_web stable_reference Eval Baseline Evidence (2026-04-05)

## Scope

This note records the first repo-tracked retrieval/live-gate baseline for
`official_web/stable_reference` after the bootstrap release
`r20260404_204033`.

It is evidence for:

- repo-tracked `stable_reference` split manifest and retrieval qrels truth
- deterministic `stable_reference` answer-path live gate wiring
- real local validation against physical collection
  `official_web_stable_reference__r20260404_204033`

It is not evidence for:

- the later scope-alias publish operation itself
- merged-truth acceptance of `official_web/stable_reference` as default query-serving surface
- `fresh_news` / `news_archive` readiness

## Repo-Tracked Baseline

- split manifest:
  `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json`
- deterministic live gate:
  `packages/evals/src/campus_evals/scenarios.py` ->
  `official_web_stable_reference_release_gate_cases()`
- live benchmark entry:
  `uv run --all-packages python -m campus_evals.official_web_live_benchmark ... --official-web-scope stable_reference`

Baseline content:

- `9` retrieval qrels cases for stable reference pages only
- `11` deterministic live-gate cases:
  - `9` completed stable reference pages
  - `2` fail-close cases for freshness-sensitive / unanchored asks

## Retrieval Live Benchmark

Executed:

```bash
uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json \
  --output /tmp/official-web-stable-reference-live-retrieval-20260405.json \
  --force-enable-retrieval \
  --qdrant-collection-name official_web_stable_reference__r20260404_204033 \
  --format json
```

Observed summary:

- `total_cases=9`
- `hit_at_1=1.0`
- `hit_at_3=1.0`
- `recall_at_5=1.0`
- `precision_at_5=0.8703703703703703`
- `mrr_at_5=1.0`
- `forbidden_hit_rate=0.0`

Artifact:

- `/tmp/official-web-stable-reference-live-retrieval-20260405-fix1.json`

## Deterministic Live Gate

Executed:

```bash
uv run --all-packages python -m campus_evals.official_web_live_benchmark run \
  --reruns 1 \
  --official-web-scope stable_reference \
  --qdrant-collection-name official_web_stable_reference__r20260404_204033 \
  --output-dir /tmp/official-web-stable-reference-live-gate-20260405
```

Observed summary:

- `benchmark_type=official_web_stable_reference_live_gate`
- `total_cases=11`
- `completed=9`
- `no_answer=2`
- `deterministic mean_pass_rate=1.0`
- `gate verdict=pass`

Artifacts:

- `/tmp/official-web-stable-reference-live-gate-20260405-fix1/summary.json`
- `/tmp/official-web-stable-reference-live-gate-20260405-fix1/gate-report.json`
- `/tmp/official-web-stable-reference-live-gate-20260405-fix1/SUMMARY.md`

## Conclusion

Current truth after this execution:

- `official_web/stable_reference` now has a repo-tracked split-scope eval baseline
- real local validation against the unpublished physical collection succeeded on
  deterministic answer-path quality
- retrieval ordering between `学校概况` and `学校简介` has been tightened enough to
  remove the previous trailing-rank forbidden hit in the stable-reference
  retrieval baseline
- a later 2026-04-05 scope-alias publish step promoted the validated physical
  collection to `official_web_stable_reference`, after which the same retrieval
  and live-gate commands also passed on the alias path
