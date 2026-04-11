# Quick Task 260411-rho Plan

## Goal

修正 `institutional_regulations` promotion adjudication 的粗粒度规则，并把 Cohort A 的 `10` 条 manual-review notice 固化成可解释、可执行的 taxonomy。

## Steps

1. 读取当前 promotion 实现、Cohort A rerun 结果与相关 planning truth。
2. 结合官方资料，明确：
   - `document age` 不是 standalone exclusion signal
   - `暂行/试行` 不是自动 manual signal
   - 真正的排除条件应回到 annual-cycle / temporary-operational semantics
3. 更新：
   - promotion routing scaffold
   - 实施文档 / planning truth
   - promotion 代码与 tests
4. 重跑 targeted tests 与 Cohort A acceptance harness。
5. 生成 machine-readable adjudication artifact 与 quick-task closeout 文档。

## Non-Goals

- 不写 Postgres
- 不写 Qdrant
- 不做 embeddings
- 不发 release / alias
