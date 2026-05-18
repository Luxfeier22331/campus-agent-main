---
doc_type: plan
status: completed
workstream: institutional-rules-retrieval-quality-baseline
phase: phase-00-golden-dataset-v1
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 00 Golden Dataset v1

## Objective

建立 `regulations/institutional_rules` 的首版 golden retrieval 与 answer quality baseline，
覆盖 30 条已发布校级制度，并用 realistic no-hit/hard-negative guard 防止未发布制度或院级制度误入默认消费。

Note: this was the original Phase 00 execution scope. The tracked fixture truth
has since been refreshed to 42 admitted校级 institutional rules after selected
school-level re-admission; see `../SUMMARY.md` and workstream `STATE.md` for
current counts.

## Tasks

- 新增 64-case `institutional_rules_golden_retrieval_qrels.v1.json`。
- 扩展 institutional answer quality fixture 到 30-case full-title coverage。
- 为 institutional runtime profile 启用 no-hit guard 阈值。
- 为 no-hit policy 增加 live-like hard-negative regression tests。
- 修复 institutional title-intent no-hit policy，避免正文偶然引用被当成制度标题命中。
- 生成 oracle、live retrieval 和 answer quality evidence。

## Acceptance

- Retrieval fixture validation passes.
- Live retrieval reaches 64/64 qrels success and forbidden hit rate 0.
- Four no-hit / hard-negative guards return no retrieved sources.
- Answer quality contract passes 30/30.
- Focused unit tests pass.
