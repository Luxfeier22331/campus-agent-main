---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Roadmap: Product-path Safety Prompt Grounding Governance

## Overview

这条 workstream 固定为单线推进：
`semantic gate -> prompt runtime ownership -> grounded generation -> eval / observability artifact refresh -> source-trust runtimeization -> remote-content hardening -> safety traceability -> abuse controls -> conditional moderation / HITL governance`。

## Phases

- [x] **Phase A: Semantic Outcome Truth** — 稳住 `policy_refusal / out_of_scope / unsupported_by_evidence / freshness_fail_close` 的语义结果真相。
- [x] **Phase B: Prompt Runtime Ownership** — 稳住 prompt metadata sink 与 typed runtime state。
- [x] **Phase C: Grounding / Adequacy Gate Refresh** — 稳住 retrieval adequacy / grounding runtime 的持续 gate。
- [x] **Phase D: Live Artifact And Observability Refresh** — 已基于当前 supplemental provider 刷新 live artifact、eval 与 operator observability evidence。
- [x] **Phase E: Planning Closeout** — 已以 latest passing artifact 与 release-gate evidence 收口 planning truth，`ragas.faithfulness` soft gate 已恢复为 `pass`。
- [x] **Phase F: Source-Trust Tier Runtimeization** — 已把 `source-trust tier` 收口到 contracts / evidence / grounding / app-api observability / eval parser / release gate，并为 `request_observability_fact` 落盘 `source_trust_summary_json` migration。
- [ ] **Phase G: Remote-content Injection Hardening** — 依赖 `Phase F` 的 tier contract；为 `official_web` 与后续 live/authenticated source surfaces 增加 remote-content sanitization、prompt-injection suspicion 标注与 regression gate。
- [ ] **Phase H: End-user Safety Traceability** — 依赖 `Phase F` 的 contract projection；为终端用户在线问答补 canonical `safety_identifier`，并把 provider-side traceability 与 app-owned observability 对齐。
- [ ] **Phase I: Abuse Controls And Security Ops Loop** — 依赖 `Phase H` 的 identifier truth；补 app-api owned 的 public/product-path 最小滥用控制、异常信号、operator alerts 与 incident backfill hooks。
- [ ] **Phase J: Conditional Moderation Lane** — requires repo-tracked trigger artifact plus `STATE.md` `Conditional Trigger Registry` admission；仅当 public open-ended 流量或 incident 证据要求时，引入 app-level moderation precheck/annotation，但不得替代 code-owned `policy / scope / grounding` gate。
- [ ] **Phase K: Conditional HITL Approval Recovery** — requires repo-tracked trigger artifact plus `STATE.md` `Conditional Trigger Registry` admission；仅当产品重新引入高风险 action execution 时，把 `approval_required` 从 terminal semantic outcome 升级为可恢复的人审执行闭环。
