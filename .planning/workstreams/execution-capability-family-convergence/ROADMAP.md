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
- [x] **Phase 3: Prompt Eval And Observability Label Convergence** — 已把 prompt-facing persona wording、eval runtime target vs capability family split、observability raw target vs derived label rule 收口干净；未重开 contract semantics，也未提前进入 package/runtime rename。
- [x] **Phase 4: Package And Runtime Rename Decision** — 已冻结 one-shot full rename 为唯一前向方向，并把 package dir / distribution / module import / raw runtime target / helper naming / docs / tests / planning truth 的单波次迁移边界写实；不接受 no-rename、partial rename 或 compatibility shim。
- [ ] **Phase 5: One-Shot Full Rename Execution** — 执行 `rag-specialist` / `navigation-specialist` 到 `*-agent` 的单波次迁移，收口 package/import/runtime target/docs/tests/planning truth，并用 targeted verification 证明 cutover 后不存在 active canonical truth 的双命名残留。
