---
doc_type: requirements
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Requirements: Handbook Curriculum MinerU Cutover

## Goal

把 `student_rules` 与 `curriculum_plan` 的 canonical source truth、
rebuild/release/operator runbook 全部收口到 MinerU，
覆盖现有 Paddle 派生 truth，
并通过 source-truth hard gate 防止继续消费 provider debt。

## In Scope

- `student_rules` / `curriculum_plan` runtime profile 的 MinerU truth 对齐
- handbook source-truth hard gate 补齐并 fail-close
- handbook/curriculum 测试、runbook、reference 与 planning truth 对齐 MinerU v2
- shadow rebuild、docs refresh、release dry run、alias publish 的执行顺序
- rollback 所需的 source bucket / release manifest / alias evidence

## Non-goals

- 其他 collection 的 provider 切换
- 为这两条 collection 保留长期 Paddle 双轨
- 在 docs/chat 层用 patch 隐藏 canonical/source-truth 噪音
- 再造一条与现有 canonical truth 并行的临时世界观

## Success Criteria

1. `student_rules` 与 `curriculum_plan`
   的 runtime profile 都显式固定为 `mineru_api + vlm + mineru-vlm-adapted-v2`。
2. handbook 与 curriculum 都具备 source-truth hard gate，
   provider/source-truth 结构回归会 fail-close。
3. repo 的前向 runbook/reference 不再把这两条 collection 的默认 truth 写成 Paddle。
4. shadow rebuild、release dry run 与 alias publish
   都有明确的 repo-owned operator 入口。
5. cutover 后的 docs/live 抽检中，
   已知 Paddle 污染样例不再继续出现。

## Canonical Entry

- `.planning/workstreams/handbook-curriculum-mineru-cutover/README.md`
