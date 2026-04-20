---
phase: "6"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 6 Research

## Purpose

为 `contact_directory_lookup` 的 later-wave admission 建立事实基础：

- repo 当前对 `contact_directory` taxonomy、runtime profile、source family 与 stable-reference boundary 的已冻结 truth
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
- `configs/ingestion/campus_services/contact_directory/runtime-profile.json`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/policies/official-web-cleaning-and-chunking-policy.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/SUMMARY.md`

## Standard Stack

- bounded tool surface remains preferable
  - 官方 tools guide 继续支持显式 tool surface 与 `tool_choice`/subset-style control，而不是把所有潜在动作混成一个模糊 mega-tool。
  - 对本 phase 来说，这支持把联系方式查询收口成独立 bounded tool，而不是继续留在 generic RAG 模糊语义里。
- strict structured outputs still matter
  - 官方 structured outputs guide 继续强调 strict schema-first output。
  - 这支持 `contact_directory_lookup` 先冻结 projection/output shape，再决定后续 runtime opening。
- specialization beats overloading
  - practical guide 继续支持 manager + specialized tool/worker 的形态。
  - 这支持把 contact facts 留在 `campus-services-agent` later-wave tool，而不是让 `rag-specialist` 同时扛流程说明、联系方式和动态状态。
- eval before rollout remains explicit
  - 官方 `agent evals` / `evaluation best practices` 仍把 eval 当成 rollout 前置，而不是上线后再补。
  - 这支持本 phase 先冻结 contract / truth owner / fail-close，再为后续 gate evidence 留明确接口。

## Architecture Patterns

- `contact_directory` is already a semantic-owner collection
  - repo 已接受 `contact_directory` 作为 `campus_services` 的长期 collection。
  - 但当前 posture 仍是 `offline_preparation`，所以本 phase 不能把已有 taxonomy 误读成“已经开放产品查询”。
- stable-reference and contact-directory are related but not identical
  - `official_web/stable_reference` 可承接公开说明页、机构介绍、联系方式页面。
  - 但如果后续决定把联系方式问题提升成 structured runtime，runtime truth 仍应收口到 `campus_services/contact_directory` projection，而不是让 `official_web` RAG surface 充当 canonical directory tool。
- directory page semantics are entity-group oriented
  - repo cleaning policy 已把联系方式页面的最小语义单元冻结为 “一个人 / 一个办公室 / 一个联系方式实体组”。
  - 这支持 `contact_directory_lookup` 输出应围绕 resolved contact entity / entity group，而不是返回整页名单 chunk。
- handbook-derived contacts are projection input, not final runtime answer surface
  - handbook 电话页已被显式迁出 handbook split truth，改走 `campus_services/contact_directory` projection path。
  - 这支持本 phase 把 provenance 与 source-family 说清，但不让 handbook raw page 直接成为 runtime query seam。

## Conclusions For Phase 6

1. `contact_directory_lookup` 应作为 later-wave bounded tool 冻结，而不是继续悬挂在 generic RAG / stable-reference 之间。
2. truth owner 应是 `campus_services/contact_directory` 的 structured projection；`official_web` / handbook 只作为 source family / provenance 输入。
3. 本 phase 应优先冻结 query class、projection field set、clarification / fail-close 语义与 provenance contract，而不是提前宣布这条 lane ready to open。
