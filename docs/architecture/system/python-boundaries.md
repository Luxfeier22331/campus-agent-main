---
doc_type: architecture
truth_scope: execution
owner_boundary: python-boundaries
status: active
created: 2026-04-26
updated: 2026-06-30
---
# Python Boundary

## 文档边界

本文冻结 Python side retired / adapter boundary。它不改变 Temporal / Go
execution-control 的 ownership，只说明 Python 不再参与 online answer hot path，
以及后续只能保留在哪些非热路径场景。

## Runtime Boundary

Python 不再拥有 deterministic execution runtime truth。

- `apps/supervisor-agent-worker` 已从 active workspace 删除；旧实现只可通过 git
  history 追溯
- Go `apps/execution-control` 拥有 admission、routing frame、tool read model、
  lifecycle、observability、Temporal memory + RAG graph、provider usage/cost projection、
  final response shaping 与 fail-close terminal envelope
- Python worker 不消费 online Go canonical bridge envelope，也不作为 Temporal activity backend
- 新增 Python 只能用于明确隔离的 offline ingestion / eval / tooling；不得恢复旧
  online serving bridge
- Python 不拥有 online RAG provider cancellation、token / estimated cost accounting、
  sanitized step projection、workflow step truth 或 top-level semantic orchestration

## Knowledge / RAG Boundary

旧 Python knowledge runtime package 已从 active workspace 删除。当前
`knowledge_query` 语义由 Go-owned `apps/execution-control` RAG Temporal
graph 承接：

- query framing、scope-specific semantic planning、bounded synthesis packet assembly、
  grounding validation
- online RAG provider-backed synthesis 已迁入 Go `SynthesizeRAGAnswerActivity`
- retrieval evidence 到 `ToolResponse` 的 contract 化

这些语义职责必须表现为 Temporal-visible typed steps 与 repo-owned DTO，而不是一个
不可观测的 Python bridge 黑盒。当前 RAG online path step graph 包括 `rag.plan`、
`retrieval.indexed_lookup`、`retrieval.expand_or_rescue`、`evidence.selection`、
`synthesis`、`grounding.verify` 与 `finalization.write`。
其中 online `grounding.verify` 当前语义是 evidence-integrity verification，不消费
Python claim-level validator。

## Retrieval Boundary

旧 Python `packages/retrieval-core` 已从 active workspace 删除。当前 online retrieval
kernel 收口到 Go-owned execution-control / repo-owned internal retrieval seam：

- Qdrant backend runtime adapter、embedding query cache、registry lookup、
  evidence shaping
- retrieval request projection、step validation、step result construction、
  merge / dedupe
- retrieval runtime 不拥有 product tool admission，也不维护 query-enabled scope truth

LlamaIndex 不是架构层，也不得进入 contracts、execution-control、panel/eval canonical
truth。长期 online retrieval boundary 收口为 repo-owned DTO + Qdrant native adapter +
sanitized query activity projection。

当前 active workspace 中，`packages/ingestion-core` 不再通过 LlamaIndex 表达 embedding
model、mock embedding 或 chunk node payload。ingestion chunk / embedding seam 使用
repo-owned protocol / DTO；后续不得为了便利重新引入 LlamaIndex runtime coupling。

当前 rerank 事实限定为 Qdrant hybrid / RRF、heuristic ranking 与 profile-gated rerank
interface；未发现线上 cross-encoder、torch、ONNX 或 sentence-transformers rerank 作为 current
serving truth。Rust 或其他语言重写必须以 step-level profiling 证明 CPU hotspot 为前提。

内部拆分规则：

- Go retrieval activity / query service 保持 backend orchestration facade
- backend errors、embedding cache、registry lookup、evidence source shaping 继续按 owner
  分文件维护
- request projection、step execution result、replan validation、merge / trust
  filtering 属于 repo-owned retrieval runtime seam

## Data-Plane Boundary

`packages/ingestion-core` 继续拥有 ingestion / projection / materialization data plane。

Python data-plane code no longer owns default relational database
connectivity. It may keep pure URL validation / normalization helpers and
SQL-shape unit tests, but active Postgres connection ownership belongs to the
TS/Go database owner surfaces. Python registry / projection connection
entrypoints must fail closed unless they are rebuilt as an explicitly admitted
adapter boundary.

Python data-plane code is also being removed from default provider and tokenizer
runtime ownership. Qwen3 chunk budgeting now uses the local `tokenizer.json`
through Hugging Face `tokenizers`; it must not import `transformers` or perform
runtime network download. Online OCR / MinerU adapter calls use the existing
`httpx` dependency and remain adapter-island behavior, not a general provider
runtime.

Python Qdrant and S3-compatible object-store clients remain temporary data-plane
migration residues where active ingestion tests still cover legacy index /
artifact operations. They are not target ownership. New collection lifecycle,
Qdrant alias publish, index mutation, object-store runtime client creation and
audit closeout must move to admitted TS/Go owners or an explicit Python adapter
boundary before those Python dependencies can be removed.

PDF page counting / splitting may use a permissive lightweight parser for
local file kernel work. PDF page rendering probes are retired from the default
workspace; future rendering must be admitted as an explicit adapter runtime
instead of reintroducing a default native rendering dependency.

内部拆分规则：

- projection modules 不再同时承载 DTO、常量、validation 与 build/release orchestration
- 具体 projection 的 constants、models、validation、support helpers 分文件维护
- internal notice consumption projection 的 status models 与 multimodal
  consumption policy 分文件维护
- projection build/release 主文件只保留领域编排和 source-channel 映射

## Guardrails

- 不把 Go runtime types、Qdrant / S3 / provider SDK types 写入 `packages/contracts`
- 不把 deterministic Execution Agent Layer admission、routing、structured payload
  planning 写回 Python
- 不把 ingestion source-truth / projection logic 拉入 knowledge runtime
- 不把 retrieval backend private helpers 重新塞进 agent service
- 大模块出现增长时优先按 owner 拆文件，而不是在 facade 继续堆分支
- 不把 Python 继续保留在长期 online answer hot path 当作默认扩容策略
- 不用“provider stable”替代 provider adapter 的 latency、token、estimated cost、
  request ref、cancel / timeout outcome projection
- 不通过删除 Qdrant auth、弱化 data-plane boundary 或引入 fallback 来掩盖性能/诊断缺口
