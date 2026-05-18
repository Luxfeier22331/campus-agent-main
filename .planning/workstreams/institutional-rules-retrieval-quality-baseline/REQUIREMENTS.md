---
doc_type: requirements
status: completed
workstream: institutional-rules-retrieval-quality-baseline
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Requirements: Institutional Rules Retrieval Quality Baseline

## Goal

为已 admission 的校级 `regulations/institutional_rules` 建立可重复验证的 retrieval 与
answer quality baseline，使后续 embedding / retrieval / prompt / answer contract 改动能用
golden dataset 发现回归。当前 repo-tracked fixture truth 覆盖 42 条校级 institutional rules；
原 30 条 release set 仍是已有 live retrieval 证据的边界。

## Scope

- 覆盖 42 条已 admission 校级 institutional rules，每条至少有 title/scope 或语义消费 case。
- 覆盖 realistic hard-negative：未纳入当前 institutional consumption 的制度名不得由相近制度正文误命中。
- 覆盖年度/届次 scoped-rule guard：年度实施办法不得随 selected school-level re-admission 进入默认 consumption。
- 覆盖 scoped-rule decoy：院级 `scoped_rules` 不得成为 institutional qrels truth 或默认消费来源。
- 覆盖 answer source identity：回答必须使用对应 institutional title/source URL，不能由
  scoped-rule promotion URL 满足。
- 固定 runtime no-hit guard，防止低分、低间隔、弱词匹配结果进入默认 answer path。

## Non-Goals

- 不重新打开 `regulation-rag-release-lane`。
- 不扩大到院级 `scoped_rules` 默认 consumption。
- 不把当前 golden qrels 当作完整业务问答集；它是 retrieval/source identity baseline。
- 不引入 provider judge 作为 canonical gate。

## Success Criteria

- `institutional_rules_golden_retrieval_qrels.v1.json` 覆盖 89 cases，其中 84 个 positive
  consumption cases、5 个 no-hit / hard-negative guards。
- 原 30 条 live retrieval evidence against alias `institutional_rules` 达到
  `hit@1=1.0`、`doc_hit@1=1.0`、`doc_hit@3=1.0`、`forbidden_hit_rate=0.0`。
- 5 个 no-hit / hard-negative guards 固定在 repo-tracked qrels truth；原 4 个已有 live
  retrieved-sources 为空的 evidence。
- `institutional_rules_answer_quality_cases.v1.json` 覆盖 42 条 admitted title；原 30 条
  live/observation-backed contract eval 为 30/30 passed。
- no-hit policy 单元测试覆盖 live-like title decoy，且不破坏 existing student_rules /
  curriculum no-hit behavior。
