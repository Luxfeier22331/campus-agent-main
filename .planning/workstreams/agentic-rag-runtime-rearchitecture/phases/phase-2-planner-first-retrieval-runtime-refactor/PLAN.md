---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 2 Plan

## Objective

把 `rag-agent` 的主链路改成显式 planner-first runtime：先形成 typed retrieval plan，
再执行 retrieval，再做 evidence selection，再做 synthesis。
本 phase 不重新定义 typed seam placement；它只实现 Phase 1 冻结后的 seam。

## Tasks

1. 引入显式 planner stage
   - 明确输入、输出和 fail-close
   - 把 scope / mode resolution 与 retrieval plan 分开

2. 重构 orchestration
   - `service.py` 不再直接承载隐式单轮策略
   - retrieval stage、evidence stage、synthesis stage 显式化

3. 收口旧式 answer success 逻辑
   - 让 title/shape 命中不再等于成功回答
   - no-answer / low-confidence / unsupported-by-evidence 分流明确

4. 稳定 typed boundary
   - planner 输出与 executor 输入之间形成稳定 seam
   - 不把 planner 状态藏进 prompt 文本
   - 不允许 `service.py` 再用同一个 opaque blob 同时扮演 plan、retrieval response 和
     answer state

5. 验证主链路行为
   - planner 可以解释为什么走某条 plan
   - fail-close 保持稳定
   - 明确 no-answer / unsupported / low-confidence 的分流，不靠 title 命中掩盖

## Constraints

- 不扩大 query-enabled scope
- 不把 structured runtime query 重吸回 planner
- 不改变 retrieval-core owner 分层
- 不破坏 current serving surface

## Verification

- targeted rag-agent tests
- focused diff inspection
- `git diff --check`
- tests or review notes proving planner output cannot be inferred only from final answer text

## Exit Criteria

- 主链路可读为 explicit plan -> retrieval -> evidence -> synthesis
- 旧式隐式策略不再主导 answer semantics
- planner / executor boundary 可以在代码审查中被单独指出
