---
doc_type: roadmap
status: completed
created: 2026-04-22
updated: 2026-05-10
---

# Roadmap: Eval

## Overview

这条 workstream 只负责 shared eval substrate、golden dataset governance 与 acceptance governance。
它不替代任何 domain truth owner，也不把 operator observability panel、retrieval feature 或 runtime tool 实现重新收回 eval 侧。
此外，`golden dataset` 的正式 accepted case 扩编依赖采集内容补全；在此之前，`eval`
仍应先推进不依赖完整 corpus coverage 的 case governance scaffold，让后续 domain 数据补齐后能按同一套
admission / review / denominator / artifact 规则进入 eval。
2026-04-29 follow-up review 后，后续 phase 明确扩展到 workflow trace runtime gate、observed
regression intake、public chat 产品路径、campus-services / notice tool eval、多模态/OCR 质量、
restricted/authz/privacy、agentic retrieval plan 与 eval operations governance。Phase 6 已在
Phase 5A scaffold 基础上独立完成；Phase 8-13 已完成 deterministic eval seams；`Phase 5B`
current-corpus golden expansion 已按当前已入库文档收口。认证态 source 补采不再作为 eval
blocker，而是登记到 backlog seed，待 source/domain workstream 恢复后再晋升对应 accepted truth。
当前没有独立编号的 Phase 14；总数 14 来自 Phase 5A/5B 拆分。

2026-05-04 RAG-only eval 收口后，当前 RAG 消费面固定为 `regulations/student_rules`、
`regulations/institutional_rules`、`curriculum/curriculum_plan` 与
`official_web/stable_reference`；`official_web/fresh_news` 不进入 RAG eval denominator。
`institutional_rules` 已通过 `institutional-rules-release-baseline` 作为 domain-specific
baseline 接入 coverage/audit。当前 report 区分 `minimum_gate_passed`、`maturity_passed`、
answer-quality contract 与 known-gap contract。current-corpus 已标记为可审计补全；缺失
canonical 文档的 query 继续留在 `known_gap`，不能进入 accepted qrels / answer truth，直到后续
source/backlog workstream 提供 canonical source。

## Phases

- [x] **Phase 1: Shared Eval Ownership And Contract Freeze** — 冻结 `packages/evals`、artifact contract、deterministic vs supplemental 分层、`app-api` eval ingress 与 operator publish 的 shared seam 边界。
- [x] **Phase 2: Benchmark Runtime And Artifact Lifecycle** — 收口 `run / repair / accept` runtime contract、artifact layout、provider preflight / breaker / repair provenance 与 acceptance publish prerequisites。
- [x] **Phase 3: Publish And Backflow Integration** — 固定 quality grade publish、trace/request correlation、operator-safe backflow contract 与 non-owner boundary，避免 grader/sink payload 反向成为 app truth。
- [x] **Phase 4: CI And Release Gate Automation** — 为 repo shared eval lane 建立持续化 automation、release evidence expectations 与 failure-handling policy，结束“只有本地手动 accept 才能完成 closeout”的状态。
- [x] **Phase 5A: Case Governance Scaffold** — 不等待完整语料，先冻结 case lifecycle、denominator registry scaffold、workflow trace artifact model、candidate intake manifest、review decision 与 drift/admission discipline。
- [x] **Phase 5B: Golden Dataset Expansion And Domain Case Governance** — current-corpus 层已补齐 accepted case、retrieval qrels、workflow/status case、deterministic answer truth 与 known-gap/no-hit contract；authenticated canonical source 缺口已移交 backlog seed，后续补采完成后再由 source/domain workstream 晋升缺失 canonical 文档相关 truth。
- [x] **Phase 6: Workflow Trace Runtime Gate And Artifact Adoption** — 将 Go direct branch、Python delegate、structured tools、guardrail 与 fail-close terminal outcome 都投影进 repo-owned workflow trace artifact，并形成 deterministic release gate。
- [x] **Phase 7: Observed Regression Intake And Review Workflow** — 打通 operator badcase、negative feedback、incident backfill 到 eval-owned pending review / dedupe / admission / accepted case 的闭环。
- [x] **Phase 8: Public Chat Product Path E2E Eval** — 覆盖 `public-chat-web -> app-api -> supervisor-api -> structured runtime / agent -> response -> operator backflow` 的真实产品路径 acceptance。
- [x] **Phase 9: Campus Services And Notice Tool Eval Expansion** — 为 `service_status_lookup`、`transport_schedule_lookup`、`service_guide_lookup`、`contact_directory_lookup`、`campus_notice_discover/get` 建立 tool-family denominator、fixtures 与 release profiles。
- [x] **Phase 10: Multimodal / OCR / Document Quality Eval** — 为 notice 图片正文、OCR/MinerU、表格抽取、视觉理解与 document canonicalization 建立 repo-tracked quality fixtures 与 gates。
- [x] **Phase 11: Authorization / Privacy / Restricted Surface Eval** — 覆盖 restricted notice/docs 的 entitlement fail-close、authz projection、artifact redaction 与敏感 payload 最小化回归。
- [x] **Phase 12: Agentic Retrieval Plan / Freshness Eval** — 在 classic qrels 外评估 query decomposition、step-plan、freshness branch、live branch fail-close 与 supporting evidence selection。
- [x] **Phase 13: Eval Operations Governance** — 收口 provider preflight、预算、retry、flake/quarantine、artifact retention、scheduled gates 与 case-set version drift。
