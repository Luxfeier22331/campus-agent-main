---
doc_type: architecture
status: active
created: 2026-04-26
updated: 2026-06-08
---
# Python Capability Boundaries

## 文档边界

本文冻结 Python side retired / offline boundary。它不改变 Temporal / Go
execution-control 的 ownership，只说明 Python 不再参与 online answer hot path，以及后续只能保留在哪些
非热路径场景。

## Runtime Boundary

Python 不再拥有 deterministic execution runtime truth。

- `apps/supervisor-agent-worker` 不参与当前 online answer serving
- Go `apps/execution-control` 拥有 admission、routing frame、structured runtime、
  lifecycle、observability、Temporal seven-step RAG graph、provider usage/cost projection、
  final response shaping 与 fail-close terminal envelope
- Python worker 不消费 online Go canonical bridge envelope，也不作为 Temporal activity backend
- Python 只允许保留 offline ingestion / eval / tooling 或 historical bridge reference
- Python 不拥有 online RAG provider cancellation、token / estimated cost accounting、
  sanitized step projection、workflow step truth 或 top-level semantic orchestration

## Agent Boundary

`packages/rag-agent` 当前保留 knowledge-family semantic agent 能力：

- query framing、scope-specific semantic planning、bounded synthesis packet assembly、
  grounding validation
- online RAG provider-backed synthesis 已迁入 Go `SynthesizeRAGAnswerActivity`；
  Python `OpenAIAgentsRagRuntime` 仅保留 non-serving / test artifact，不是默认 online
  runtime
- retrieval evidence 到 `AgentResponse` 的 contract 化

这些语义职责必须表现为 Temporal-visible typed steps 与 repo-owned DTO，而不是一个
不可观测的 Python bridge 黑盒。当前 RAG online path step graph 包括 `rag.plan`、
`retrieval.indexed_lookup`、`retrieval.expand_or_rescue`、`evidence.selection`、
`synthesis`、`grounding.verify` 与 `finalization.write`。

内部拆分规则：

- `service.py` 保持 agent service facade，不继续吸收 scope planning 大块逻辑
- scope-specific logic 分到 `service_scope_*`
- direct answer composition 分到 `agent_answering_*`
- grounding validation 的 result、trust policy、support policy、
  source-trust summary 分文件维护

## Retrieval Boundary

`packages/retrieval-core` 当前保留 online retrieval kernel：

- Qdrant backend runtime adapter、embedding query cache、registry lookup、
  evidence shaping
- retrieval request projection、step validation、step result construction、
  merge / dedupe
- retrieval-core 不拥有 product capability admission，也不维护 query-enabled scope truth

当前 retrieval implementation 可以在内部依赖 LlamaIndex adapter/helper，但 LlamaIndex 不是
架构层，也不得进入 contracts、execution-control、panel/eval canonical truth。长期 online retrieval
boundary 收口为 repo-owned DTO + Qdrant native adapter + sanitized query activity projection。

当前 rerank 事实限定为 Qdrant hybrid / RRF、heuristic ranking 与 profile-gated rerank
interface；未发现线上 cross-encoder、torch、ONNX 或 sentence-transformers rerank 作为 current
serving truth。Rust 或其他语言重写必须以 step-level profiling 证明 CPU hotspot 为前提。

内部拆分规则：

- `backend_qdrant.py` 保持 backend orchestration facade
- backend errors、embedding cache、registry lookup、evidence source shaping 分文件维护
- `service.py` 保持 retrieval service facade
- request projection 属于 `service_requests.py`
- step execution result、replan validation、merge / trust filtering 属于 `service_execution.py`

## Data-Plane Boundary

`packages/ingestion-core` 继续拥有 ingestion / projection / materialization data plane。

内部拆分规则：

- projection modules 不再同时承载 DTO、常量、validation 与 build/release orchestration
- service guide projection 的 constants、models、validation、support helpers 分文件维护
- internal notice consumption projection 的 status models 与 multimodal
  consumption policy 分文件维护
- projection build/release 主文件只保留领域编排和 source-channel 映射

## Guardrails

- 不把 Go runtime types、Qdrant / S3 / provider SDK types 写入 `packages/contracts`
- 不把 deterministic supervisor admission、routing、structured payload planning 写回 Python
- 不把 ingestion source-truth / projection logic 拉入 `packages/rag-agent`
- 不把 retrieval backend private helpers 重新塞进 agent service
- 大模块出现增长时优先按 owner 拆文件，而不是在 facade 继续堆分支
- 不把 Python 继续保留在长期 online answer hot path 当作默认扩容策略
- 不用“provider stable”替代 provider adapter 的 latency、token、estimated cost、
  request ref、cancel / timeout outcome projection
- 不通过删除 Qdrant auth、弱化 data-plane boundary 或引入 fallback 来掩盖性能/诊断缺口
