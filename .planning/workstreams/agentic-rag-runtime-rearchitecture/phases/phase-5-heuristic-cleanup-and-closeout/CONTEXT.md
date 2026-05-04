---
doc_type: context
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 5 Context

## Why This Phase Exists

如果前面几阶段都落地了，`title_lookup`、condition/detail/fact shape 这类旧 heuristic
就不该再继续占据主语义决策位。Phase 5 负责收口和 closeout。
closeout 不是自然语言结束语，而是要有明确 promotion / reopen 规则。

## Repo Facts

- `agent_answer_shape.py` 现在仍在参与 answer shape 决策。
- `agent.py` 仍可能通过 shape-driven selection 强化旧路径。
- workstream 需要留下明确 reopen rule，而不是永远保留技术债借口。
  最低 reopen 触发条件包括：`title_lookup` 再次决定 answer success、stage-level
  observability 退化为 opaque prompt output、或 multi-step / evidence / grounding 边界再次
  混淆。

## Output Of This Phase

- legacy heuristic 降权或移除
- docs / state / reopen rule closeout
- 必要时同步 architecture docs
- 明确 promotion / reopen 判定
