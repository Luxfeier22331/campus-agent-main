# Scoped Rules Target Chunk Acceptance

## Verdict

- quality posture: `ready_for_target_materialization`
- adjudicated notice count: `10`
- rebuilt inventory notice count: `10`
- materialized scoped-rule document count: `9`
- prepared document count: `9`
- short body chunk count: `29`
- failed document ids: `[]`

## Materialized Documents

- `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`354006` | short_body_chunk_count=`0` | issues=`-`
- `中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`353963` | short_body_chunk_count=`1` | issues=`-`
- `中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`186957` | short_body_chunk_count=`2` | issues=`-`
- `中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`196411` | short_body_chunk_count=`3` | issues=`-`
- `历史文化学院2021年硕博连读博士研究生 招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`187004` | short_body_chunk_count=`8` | issues=`-`
- `新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则` -> `annual_cycle_rule` | source_notice_ids=`351907` | short_body_chunk_count=`5` | issues=`-`
- `生命与环境科学学院关于2021年暑假期间实验室安全管理规定` -> `time_bound_operational_rule` | source_notice_ids=`191176,191177` | short_body_chunk_count=`1` | issues=`-`
- `药学院2021年硕博连读博士研究生招生实施细则` -> `annual_cycle_rule` | source_notice_ids=`186977` | short_body_chunk_count=`9` | issues=`-`
- `重要通知--中央民族大学丰台校区就医管理办法（暂行）` -> `time_bound_operational_rule` | source_notice_ids=`191705` | short_body_chunk_count=`0` | issues=`-`

## Boundary

- local-only rebuilt inventory + scoped_rules materialization + target chunk prep
- no Postgres writes
- no Qdrant access
- no embeddings
- no release manifests
- no alias publish

## Artifacts

- `.planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/rebuilt-source-truth-inventory.json`
- `.planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/scoped-rules-target-documents.json`
- `.planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/chunk-prep/chunk-prep-manifest.json`
- `.planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/chunk-prep/validation-summary.json`
- `.planning/quick/260411-uej-scoped-rules-local-only-chunk-prep/chunk-prep/document-reports.jsonl`
