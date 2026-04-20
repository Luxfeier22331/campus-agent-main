---
phase: "6"
name: "Contact Directory Lookup Admission"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 6 Summary

## What Closed

- 把 `contact_directory_lookup` 从悬空 follow-up 收口成 later-wave bounded tool truth：
  - 只承接部门电话、办公电话、邮箱、办公地点与联系人联系方式
  - 不承接流程、材料、制度解释或服务开放状态
- 冻结了联系方式查询的 canonical runtime owner：
  - `campus_services/contact_directory` 是 semantic-owner structured projection
  - handbook 电话页、official-web 联系方式页与 future directory page 只作为 provenance / source-family 上游
  - runtime query 不再允许退回 generic RAG chunk 或 raw source page
- 冻结了 `official_web/stable_reference` 与 structured contact runtime 的边界：
  - 机构介绍、办事说明、FAQ 等稳定说明内容继续留在 stable-reference / `rag-specialist`
  - 明确的 contact fact lookup 不再由 generic RAG 长期拥有
- 冻结了 `contact_directory_lookup` 的 clarification / fail-close truth：
  - alias ambiguity / multi-match -> `needs_clarification`
  - currentness 不可证、source 冲突或缺 canonical current contact -> fail-close / unavailable
  - 默认不接受 historical downgrade

## Fresh Evidence

- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/retrieval-serving-architecture.md docs/architecture/official-web-serving-and-news-retrieval-strategy.md docs/reference/runtime-serving-and-index-terms.md .planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/CONTEXT.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/RESEARCH.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/PLAN.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/SUMMARY.md`
- `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.test_workspace_layout`

## Handoff

- `Phase 6` 现已 completed。
- 下一阶段固定进入 `Phase 7: Service Process Lookup Admission`。
- `Phase 7` 只负责 later-wave 服务流程查询准入，不回头重开 `contact_directory_lookup` 的 truth owner / stable-reference boundary freeze。
