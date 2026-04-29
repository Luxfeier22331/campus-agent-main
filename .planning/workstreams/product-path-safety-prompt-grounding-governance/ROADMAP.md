---
doc_type: roadmap
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Roadmap: Product-path Safety Prompt Grounding Governance

## Overview

这条 workstream 固定为单线推进：
`semantic gate -> prompt runtime ownership -> grounded generation -> eval / observability artifact refresh -> source-trust runtimeization -> remote-content hardening -> safety traceability -> abuse controls`。

## Phases

- [x] **Phase A: Semantic Outcome Truth** — 稳住 `policy_refusal / out_of_scope / unsupported_by_evidence / freshness_fail_close` 的语义结果真相。
- [x] **Phase B: Prompt Runtime Ownership** — 稳住 prompt metadata sink 与 typed runtime state。
- [x] **Phase C: Grounding / Adequacy Gate Refresh** — 稳住 retrieval adequacy / grounding runtime 的持续 gate。
- [x] **Phase D: Live Artifact And Observability Refresh** — 已基于当前 supplemental provider 刷新 live artifact、eval 与 operator observability evidence。
- [x] **Phase E: Planning Closeout** — 已以 latest passing artifact 与 release-gate evidence 收口 planning truth，`ragas.faithfulness` soft gate 已恢复为 `pass`。
- [x] **Phase F: Source-Trust Tier Runtimeization** — 已把 `source-trust tier` 收口到 contracts / evidence / grounding / app-api observability / eval parser / release gate，并为 `request_observability_fact` 落盘 `source_trust_summary_json` migration。
- [x] **Phase G: Remote-content Injection Hardening** — 已冻结 remote-content suspicion labels、sanitized prompt-visible summary、generation fail-close、app-api observability projection 与 `request_observability_fact.remote_content_suspicion_summary_json` migration。
- [x] **Phase H: End-user Safety Traceability** — 已冻结 `principal/session -> HMAC-SHA256` canonical `safety_identifier` derivation，把同一匿名标识投影到 provider request traceability、`request_execution` / `request_observability_fact` persistence、telemetry tags / runtime events，并为 runtime tables 落盘 `safety_identifier` migration。
- [x] **Phase I: Abuse Controls And Security Ops Loop** — 已冻结 `safety_identifier` keyed throttle、operator `alerts[]` safety derivation、incident backfill hint 与 runtime `safety_identifier` query indexes。

## Future Seeds

- `SEED-001` `Conditional Moderation Lane`：只有在 public scope 扩到 open-ended input，或 repo-tracked incident 证明 `Phase F-I` abuse controls 不足时才重新拿出来规划。
- `SEED-002` `Conditional HITL Approval Recovery`：只有在产品重新引入 state-changing / externally side-effectful action execution 时才重新拿出来规划。
