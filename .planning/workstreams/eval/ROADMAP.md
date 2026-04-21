---
doc_type: roadmap
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Roadmap: Eval

## Overview

这条 workstream 只负责 shared eval substrate、golden dataset governance 与 acceptance governance。
它不替代任何 domain truth owner，也不把 operator observability panel、retrieval feature 或 runtime tool 实现重新收回 eval 侧。

## Phases

- [ ] **Phase 1: Shared Eval Ownership And Contract Freeze** — 冻结 `packages/evals`、artifact contract、deterministic vs supplemental 分层、`app-api` eval ingress 与 operator publish 的 shared seam 边界。
- [ ] **Phase 2: Golden Dataset And Case Governance** — 收口 coverage matrix / denominator truth、retrieval qrels、workflow/status case、deterministic answer truth 与 synthetic candidate intake 的共享治理规则，明确 domain truth owner、regression_locked / release_gate / exploratory 边界与 drift handling。
- [ ] **Phase 3: Benchmark Runtime And Artifact Lifecycle** — 收口 `run / repair / accept` runtime contract、artifact layout、provider preflight / breaker / repair provenance 与 acceptance publish prerequisites。
- [ ] **Phase 4: Publish And Backflow Integration** — 固定 quality grade publish、trace/request correlation、operator-safe backflow contract 与 non-owner boundary，避免 grader/sink payload 反向成为 app truth。
- [ ] **Phase 5: CI And Release Gate Automation** — 为 repo shared eval lane 建立持续化 automation、release evidence expectations 与 failure-handling policy，结束“只有本地手动 accept 才能完成 closeout”的状态。
