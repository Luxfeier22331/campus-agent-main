# Phase 14: 产品主链路 Prompt Stack 与 System Prompt Runtime 收口 - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Source:** current repo prompt/runtime code truth, accepted architecture docs, and official OpenAI guidance

<domain>
## Phase Boundary

Phase 14 closes a repo-level execution gap that now sits between landed prompt substrate and actual product-path runtime truth:

- repo 已经有 package-owned prompt registry、typed prompt packet、strict validation seam、`PromptTrace` contract、以及 promptified branches 的 grounding downgrade
- 但产品主链路仍没有真正的默认 prompt stack/runtime assembly
- 当前“system prompt”仍主要是架构术语，而不是已落地的 provider-backed runtime truth

### In Scope

- 冻结 repo-default product-path prompt stack
- 收口 `apps/supervisor-api` / product runtime 的 prompt assembly ownership
- 引入 provider-backed strict structured output executor，用于 supervisor terminal wording 与 rag prompt families
- 把 `prompt_id` / `prompt_version` / `template_sha256` / `model_provider` / `model_name` 贯穿到产品主链 observability-safe truth
- 为 trusted-vs-untrusted zoning、schema validation、prompt metadata、deterministic-path protection 增加 regression gate

### Out Of Scope

- 改写 supervisor-led topology
- 把 routing / authz / serving truth 倒灌回 prompt
- 让 `retrieval-core` 拥有 top-level prompt ownership
- 用 prompt generation 替换 curriculum / handbook 的 deterministic protected paths
- 引入 open-domain web fallback 或 general assistant posture

### Success Shape

- “system prompt” 在 repo 内只保留为沟通 shorthand；真实 runtime 形态固定为：
  - `repo-global developer invariants`
  - `package-owned role prompt`
  - `typed trusted task packet`
  - `typed untrusted evidence/user packet`
  - `strict structured output`
  - `code-side finalization`
- `apps/supervisor-api` 不再只是暴露 `AGNO_*` model 标识，而是显式拥有 prompt runtime assembly / execution admission seam
- supervisor / `rag-specialist` 的 prompt executor 不再只是测试注入点，而是 product-path capability
- `PromptTrace` 不再停留在 package-local diagnostics；其关键元数据进入 app-facing observability-safe truth
</domain>

<decisions>
## Implementation Decisions

### Locked by accepted architecture

- `code-first orchestration + prompt-scoped reasoning` 继续是固定真相。
- prompt 不能替代 `policy / scope / authz / serving filter / fail-close deny path`。
- runtime prompt ownership 固定在 `packages/supervisor-core` 与 `packages/rag-specialist`；`apps/supervisor-api` 只拥有 assembly/execution seam，不拥有长期 prompt truth。
- `repo-global developer invariants -> package-owned role prompt -> typed packets -> code-side finalization` 已在架构文档中冻结为最终形态。

### Locked by current code truth

- `packages/supervisor-core/src/campus_supervisor_core/prompts/` 已有：
  - `supervisor_clarify_v1`
  - `supervisor_approval_required_v1`
  - `supervisor_out_of_scope_v1`
  - `supervisor_reject_v1`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/` 已有：
  - `rag_answer_v1`
  - `rag_clarify_v1`
  - `rag_no_answer_v1`
  - `rag_unsupported_v1`
- `packages/shared/src/campus_shared/prompt_runtime.py` 已能校验 packet/trace contract，但当前没有 product-path provider executor 去稳定产生这些 trace。
- `apps/supervisor-api/src/campus_supervisor_api/app.py` 和 `settings.py` 目前仍只暴露 `runtime_provider`、`AGNO_SUPERVISOR_MODEL`、`AGNO_SPECIALIST_MODEL` 等粗粒度 runtime 字段，没有 prompt runtime config / assembly seam。
- `apps/app-api/src/modules/request-observability.ts` 目前能投影 `modelProvider` / `modelName`，但没有把 `promptTrace` 里的 `prompt_id / prompt_version / template_sha256` 写入 request observability fact。

### Locked by external guidance

- instruction hierarchy 与 trusted-vs-untrusted separation 必须是 runtime assembly 的硬规则，而不是模板注释。
- 对 agent / tool / RAG 产品，untrusted content 应置于低优先级消息区，不能混入 developer instruction zone。
- structured outputs 应由 strict schema 保证，而不是靠 prompt-only “请输出 JSON”。
- structured output runtime 还必须显式处理 `refusal` / `content_filter` / incomplete 这类非-schema success path，不能把“拿到响应”误判为“拿到合法结构化输出”。
- 生产 runtime 需要支持 pinned model snapshot，并把 exact model identity 作为可观测元数据，而不是只记录抽象 provider family。
- 对重复出现的 developer invariants / role prompt，runtime assembly 应维持“前置且稳定”的顺序，这既符合 instruction hierarchy，也符合官方 prompt caching 建议。
- agent safety 与 eval best practices 都要求 layered defenses：instruction hierarchy、permission/tool limits、monitoring、representative evals、human review 组合存在。

### Ownership

- `packages/supervisor-core`
  - owns supervisor role prompt family、typed task packet、terminal wording execution contract
- `packages/rag-specialist`
  - owns answer / clarify / no-answer / unsupported prompt family and execution contract
- `packages/shared`
  - owns prompt runtime validation primitives and shared assembly-safe helpers
- `apps/supervisor-api`
  - owns provider binding, prompt assembly, execution admission, runtime config
- `apps/app-api`
  - owns observability-safe prompt metadata projection only

### The agent's discretion

- provider binding 是先落在 `apps/supervisor-api` 单点，还是抽成 `packages/shared` 下的 provider-agnostic runtime helper
- repo-global developer invariants 采用单文件模板还是 typed builder
- structured output runtime 采用 provider-native schema 还是 shared adapter，再进入 package executor
- 是否显式支持 “repo-owned prompt registry id/version -> provider prompt id/version” 的镜像映射；当前 repo 至少必须保留 code-owned `prompt_id / prompt_version`
- observability-safe prompt metadata 先进入 `SupervisorObservability.prompt_trace` mirror 还是直接进入 app-side projection store schema
</decisions>

<canonical_refs>
## Canonical References

**Repo truth**

- `AGENTS.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/plans/prompt-grounding-and-hallucination-hardening-plan.md`
- `apps/supervisor-api/src/campus_supervisor_api/app.py`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
- `apps/supervisor-api/src/campus_supervisor_api/settings.py`
- `apps/app-api/src/modules/request-observability.ts`
- `packages/shared/src/campus_shared/prompt_runtime.py`
- `packages/supervisor-core/src/campus_supervisor_core/prompt_packets.py`
- `packages/supervisor-core/src/campus_supervisor_core/prompt_execution.py`
- `packages/supervisor-core/src/campus_supervisor_core/prompts/registry.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompt_packets.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompt_execution.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/registry.py`
- `packages/contracts/src/campus_contracts/models.py`

**External guidance**

- `https://model-spec.openai.com/2025-09-12.html`
- `https://developers.openai.com/api/docs/guides/agent-builder-safety`
- `https://developers.openai.com/api/docs/guides/structured-outputs`
- `https://developers.openai.com/api/docs/guides/prompt-engineering`
- `https://developers.openai.com/api/docs/guides/evals`
</canonical_refs>

<specifics>
## Specific Repo Gaps

- `prompt_executor` today is mostly an injected interface used by package logic and tests; it is not the default runtime path from `apps/supervisor-api`.
- repo-global invariants are documented, but there is no single runtime-owned assembly boundary that guarantees:
  - developer instructions stay thin and trusted
  - user/evidence text stays untrusted
  - provider output is schema-validated before package acceptance
- `PromptTrace` exists in shared contracts, but product observability still lacks prompt metadata truth at request-fact level.
- deterministic-first paths are already protected in `rag-specialist`, so Phase 14 must preserve that posture rather than broadening prompt usage blindly.

## Proposed Phase Breakdown

1. `14-01`
   Freeze runtime prompt stack, assembly boundary, and trusted-vs-untrusted zoning.
2. `14-02`
   Land provider-backed strict prompt executors and metadata capture.
3. `14-03`
   Add regression/eval/observability verification and deterministic-path protection coverage.
</specifics>

<deferred>
## Deferred Ideas

- multi-provider prompt runtime marketplace
- generic cross-product prompt CMS
- prompt A/B experimentation framework
- prompt editing UI or operator-side prompt override
</deferred>

---

*Phase: 14-prompt-stack-system-prompt-runtime*
*Context gathered: 2026-04-11*
