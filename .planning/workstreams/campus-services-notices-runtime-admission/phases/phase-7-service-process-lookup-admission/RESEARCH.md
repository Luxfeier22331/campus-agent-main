---
phase: "7"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 7 Research

## Purpose

为 `service_process_lookup` 的 later-wave admission 建立事实基础：

- repo 当前对 `service_catalog` taxonomy、runtime profile、offline-preparation bounded slice 与 stable-reference / handbook boundary 的已冻结 truth
- OpenAI 当前官方文档对 bounded tools、strict structured outputs、specialized agent/tool shape 与 eval-before-rollout 的主线建议

## Official References Consulted

- OpenAI docs, `Using tools`
  - https://developers.openai.com/api/docs/guides/tools
- OpenAI docs, `Structured output`
  - https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI docs, `Agent evals`
  - https://platform.openai.com/docs/guides/agent-evals
- OpenAI docs, `Evaluation best practices`
  - https://platform.openai.com/docs/guides/evaluation-best-practices
- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf

## Repo Pattern Readings

- `docs/decisions/adr-0005-campus-services-taxonomy.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `configs/ingestion/campus_services/service_catalog/README.md`
- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/architecture/prompt-and-instruction-architecture.md`

## Standard Stack

- bounded tool surface still wins over generic overload
  - 官方 tools guide 继续支持显式 tool surface，而不是让单一 generic answer path 隐式承担所有语义。
  - 这支持把 process lookup 做成 later-wave bounded tool，而不是继续让 `rag-specialist` 混合承接所有服务流程问题。
- strict structured outputs still matter
  - 官方 structured outputs guide 继续强调 schema-first strictness。
  - 这支持 `service_process_lookup` 先冻结 process projection / output shape，再谈 runtime opening。
- specialization remains the preferred agent pattern
  - practical guide 继续支持 manager + specialized agent/tool。
  - 这支持 `campus-services-agent` later-wave family 继续吸收 structured service process，而不是把 service status、contact、process 和 generic RAG 混成一个无边界通道。
- eval before rollout remains explicit
  - 官方 eval docs 仍把 rollout 前 eval 当作显式主线。
  - 这支持本 phase 先冻结 admission truth，而不是把 `service_catalog` 的现有 offline artifacts 误写成 ready-to-open runtime lane。

## Architecture Patterns

- `service_catalog` is a semantic-owner collection, but not a current runtime surface
  - repo 已接受 `service_catalog` 作为 `campus_services` semantic-owner collection。
  - 但 runtime profile 仍是 `offline_preparation`，所以本 phase 只能冻结 candidate truth，不能假装已经打开 query-serving。
- bounded flow graph exists, but only for a narrow slice
  - repo 当前已验证 handbook-derived `service_navigation_document` hybrid materialization，可产出 `flow-graph.json`、`canonical.md`、`document-units.jsonl`。
  - 这证明 structured process truth 的方向成立，但也说明当前 coverage 仍不足以把所有流程问题都迁出 `rag-specialist`。
- service process and policy text are related but not identical
  - `student_rules` / `official_web/stable_reference` 仍承接制度条款、说明性文本与办事说明正文。
  - 如果 future `service_process_lookup` 被 admission，它应优先承接“有明确服务边界、步骤、材料、入口、受众”的 process facts，而不是把所有制度条款都结构化搬走。
- contact remains a neighboring but separate truth owner
  - `service_process_lookup` 可以返回 related contact refs，但 canonical contact truth 仍应由 `contact_directory_lookup` / `campus_services/contact_directory` 拥有。

## Conclusions For Phase 7

1. `service_process_lookup` 应作为 later-wave bounded tool 冻结，而不是继续悬在 `rag-specialist` 与 `service_catalog` 之间。
2. truth owner 应是 `campus_services/service_catalog` 的 structured process projection，不是 generic RAG chunk 或 raw flow page。
3. 只有“服务边界明确且具备足够 normalized truth 的步骤 / 材料 / 入口问题”才可前向迁入 structured runtime；一般制度说明、规则解释仍继续留在 `rag-specialist`。
