# Scoped Rules Local Chunk Acceptance

## Outcome

- scoped-rule candidates: `10`
- materialized documents: `9`
- prepared documents: `9`
- total chunks: `305`
- hard gate passed: `True`
- short body chunks: `29`

## Operator Rule

- Use an isolated snapshot root for local-only scoped_rules acceptance; do not write target-side acceptance artifacts back into the long-lived historical local-smoke object-store root.

## Document Reports

| target_document_id | document_nature | source_notice_ids | chunk_count | short_body_chunk_count | passed |
| --- | --- | --- | --- | --- | --- |
| `institutional_regulation:muc:中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则:f6de643d9cbd` | `annual_cycle_rule` | `354006` | `51` | `0` | `True` |
| `institutional_regulation:muc:中央民族大学新闻与传播学院-2026年-英才计划-硕博连读研究生招生实施细则:442ba7a0a51a` | `annual_cycle_rule` | `353963` | `71` | `1` | `True` |
| `institutional_regulation:muc:中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则:c2bb58be7f1f` | `annual_cycle_rule` | `186957` | `31` | `2` | `True` |
| `institutional_regulation:muc:中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则:c6461da4a5b3` | `annual_cycle_rule` | `196411` | `37` | `3` | `True` |
| `institutional_regulation:muc:历史文化学院2021年硕博连读博士研究生-招生实施细则:83f2e47c27a8` | `annual_cycle_rule` | `187004` | `35` | `8` | `True` |
| `institutional_regulation:muc:新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则:2a08a3e2dd06` | `annual_cycle_rule` | `351907` | `24` | `5` | `True` |
| `institutional_regulation:muc:生命与环境科学学院关于2021年暑假期间实验室安全管理规定:69d28bcc8b09` | `time_bound_operational_rule` | `191176,191177` | `9` | `1` | `True` |
| `institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3` | `annual_cycle_rule` | `186977` | `37` | `9` | `True` |
| `institutional_regulation:muc:重要通知-中央民族大学丰台校区就医管理办法-暂行:cf6822a20947` | `time_bound_operational_rule` | `191705` | `10` | `0` | `True` |
