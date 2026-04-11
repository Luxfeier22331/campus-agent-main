---
created: 2026-04-11T11:53:30.000Z
title: 落地产品主链路 prompt stack 与 system prompt
area: planning
files:
  - docs/architecture/prompt-and-instruction-architecture.md
  - docs/architecture/execution-and-specialists-architecture.md
  - docs/plans/prompt-grounding-and-hallucination-hardening-plan.md
  - apps/supervisor-api
  - apps/app-api
  - packages/supervisor-core/src/campus_supervisor_core/prompts
  - packages/supervisor-core/src/campus_supervisor_core/prompt_execution.py
  - packages/rag-specialist/src/campus_rag_specialist/prompts
  - packages/rag-specialist/src/campus_rag_specialist/prompt_execution.py
  - packages/shared/src/campus_shared/prompt_runtime.py
---

## Problem

当前 repo 已经明确接受 `code-first orchestration + prompt-scoped reasoning`，也已经落地了 package-owned prompt registry、typed prompt packet、strict validation seam 与 claim-level grounding downgrade。

但产品主链路里的“system prompt”仍停留在架构设计层表述，还没有真正收口成统一的 runtime prompt stack。继续维持这种模糊状态会带来三类漂移：

1. product/runtime 容易把“system prompt”误实现成一份单块 mega prompt，而不是 `repo-global developer invariants -> package role prompt -> typed packets -> code finalization`
2. `apps/supervisor-api`、`apps/app-api` 或后续 provider runtime 容易各自拼 prompt，导致 trusted / untrusted zone 漂移
3. `prompt_version`、`template_sha256`、`model_provider`、`model_name` 等 metadata 无法形成稳定的 product-path truth

这项工作现在已经不再是“是否需要 prompt architecture”的讨论题，而是一个明确的 repo-level 落地任务。

## Solution

按以下顺序推进：

1. 冻结 product-path prompt stack：
   把 repo-global 那一层正式定义为稳定的 developer invariants；system prompt 只保留为产品沟通 shorthand。
2. 收口 runtime assembly：
   让 `apps/supervisor-api` / product runtime 统一消费 package-owned role prompt、typed trusted task packet 与 typed untrusted evidence packet，不允许把 user/evidence text 注入 developer zone。
3. 接入 provider-backed executor：
   在不触碰 deterministic protected paths 的前提下，为 supervisor terminal branches 与 rag clarify / no-answer / generic answer 接上 strict structured outputs。
4. 补齐 metadata sink：
   把 `prompt_id`、`prompt_version`、`template_sha256`、`model_provider`、`model_name` 端到端带入 observability / operator truth。
5. 加上验证：
   补齐 prompt stack assembly、trusted-vs-untrusted zoning、schema validation、metadata sink、grounding downgrade 与 prompt-family regression tests。

禁止事项：

- 不把 routing / authz / serving truth 倒灌回 prompt
- 不把 system prompt 演化成 monolithic mega prompt
- 不为了快速接 provider 而引入无 owner 的 prompt 拼装层
