---
doc_type: architecture
status: active
created: 2026-04-26
updated: 2026-04-26
---
# Python Capability Boundaries

## 文档边界

本文冻结 Python side remaining-core 的内部治理边界。它不改变 Go / Python
runtime ownership，只说明 Python 继续保留的 semantic capability 如何拆分。

## Runtime Boundary

Python 不再拥有 deterministic execution runtime truth。

- `apps/supervisor-agent-worker` 只负责 private bridge parsing、prompt runtime assembly
  与 agent delegate dispatch
- Go `apps/execution-gateway` 继续拥有 admission、routing frame、structured runtime、
  lifecycle、observability、final response shaping 与 fail-close terminal envelope
- Python worker 只消费 Go canonical bridge envelope 与 Go preplanned `AgentRequest`

## Agent Boundary

`packages/rag-agent` 保留 knowledge-family semantic agent 能力：

- query framing、scope-specific semantic planning、answer synthesis、grounding validation
- prompt packet assembly 与 provider-backed semantic execution
- retrieval evidence 到 `AgentResponse` 的 contract 化

内部拆分规则：

- `service.py` 保持 agent service facade，不继续吸收 scope planning 大块逻辑
- scope-specific logic 分到 `service_scope_*`
- direct answer composition 分到 `agent_answering_*`
- grounding validation 的 result、trust policy、support policy、
  source-trust summary 分文件维护

## Retrieval Boundary

`packages/retrieval-core` 保留 online retrieval kernel：

- Qdrant backend runtime adapter、embedding query cache、registry lookup、
  evidence shaping
- retrieval request projection、step validation、step result construction、
  merge / dedupe
- retrieval-core 不拥有 product capability admission，也不维护 query-enabled scope truth

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
