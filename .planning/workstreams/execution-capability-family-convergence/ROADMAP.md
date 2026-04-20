---
doc_type: roadmap
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Roadmap: Execution Capability Family Convergence

## Overview

这条 workstream 负责 repo 级 execution capability family 的长期命名收敛。
它不替代任何 domain workstream，而是为 `supervisor` 之下所有稳定 capability family 提供统一 naming / label / contract vocabulary。

## Phases

- [x] **Phase 1: Agent Family Terminology Freeze** — 已冻结 `supervisor` 及下游 stable family 的前向命名规则；明确 current merged truth 仍保留 legacy `*-specialist` package naming，但长期 family label 默认采用 `<domain>-agent`，并把 `rag-specialist -> rag-agent` 作为首条收口对象。
- [x] **Phase 2: Current-Truth Contract Label Migration** — 已把 `selected_target` / `selectedTarget` 收口为 current runtime target 语义，并为 panel target filter / display label 建立显式 mapping；未提前进入 prompt/eval/observability wording convergence。
- [ ] **Phase 3: Prompt Eval And Observability Label Convergence** — 收口 prompt docs、eval labels、trace / observability label 与 operator-facing wording，避免继续混用 `specialist` / `agent`。
- [ ] **Phase 4: Package And Runtime Rename Decision** — 冻结 package dir / import path / runtime object label 是否真的迁移，以及如果迁移时应采用的单次收口边界；避免半迁移状态长期存在。
