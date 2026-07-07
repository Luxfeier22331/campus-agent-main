---
doc_type: architecture
truth_scope: execution
owner_boundary: python-boundaries
status: active
created: 2026-04-26
updated: 2026-07-05
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

当前 active workspace 中，旧 Python ingestion package 已删除，不再通过 LlamaIndex
表达 embedding model、mock embedding 或 chunk node payload。ingestion chunk /
embedding seam 使用 repo-owned protocol / DTO；后续不得为了便利重新引入
LlamaIndex runtime coupling。

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

旧 Python ingestion package 已删除。Python 不再作为 default data-plane package、
worker runtime 或 fallback executor 存在；仍需 Python 生态的 extraction 能力必须重新
admission 为 explicit TS handler 调用的 private adapter service 或窄 package，并返回
canonical artifacts / document units。Python 不拥有默认 materialization runtime、
source-truth / projection / registry ownership、task lifecycle、object-store /
Postgres / Qdrant client lifecycle 或 alias publish。Regulation semantic、
answer-role 与 answer-ready contract helper 不再保留独立 Python package；如未来需要，
必须按 collection-local TS handler、Rust kernel 或显式 adapter contract 重新
admission。

Python data-plane code no longer owns default relational database
connectivity. It may keep pure URL validation / normalization helpers and
SQL-shape unit tests, but active Postgres connection ownership belongs to the
TS/Go database owner surfaces. Python registry / projection connection
entrypoints must fail closed unless they are rebuilt as an explicitly admitted
adapter boundary.

Python data-plane code no longer owns default provider, tokenizer, chunk profile
or chunk preparation runtime. Collection runtime / chunk profile payloads are
parsed in TS `packages/ingest-core`; default `document_units_validate`,
`chunk_prepare` and `release_manifest_validate` execution enters
`apps/ingestion-control` and the Rust kernel bridge. The kernel may use a local
`tokenizer.json` / Hugging Face `tokenizers` only inside the deterministic
kernel boundary; Python must not reintroduce `transformers`, tokenizer cache,
semantic chunker, process pipeline or runtime network download. Online OCR /
MinerU adapter calls remain explicit adapter-island behavior, not a general
provider runtime.
Curriculum document-units generation, validation and chunk preparation are not
Python adapter-island work; do not restore `curriculum_chunk_units*` or
`curriculum_document_units*` modules.
Historical handbook / curriculum provider-response normalization and
source-truth validation modules have left the active workspace. Future
provider extraction must enter through an explicit adapter contract and return
canonical artifacts or document units; do not rebuild default provider-response
materialization inside the Python package.

Python no longer keeps concrete Qdrant or S3-compatible object-store client
lifecycle. Remaining Python references to Qdrant are profile DTO /
config-validation terms, not client ownership. New collection
lifecycle, Qdrant alias publish, index mutation, object-store runtime client
creation and audit closeout must stay in admitted TS/Go owners or an explicit
Python adapter boundary.

Python no longer owns generic ingestion artifact/model DTOs. The removed
surface includes artifact key builders, artifact filename constants, raw asset
records, document registry records, `DocumentImportInput`, generic
split-manifest loading and raw split-manifest materialization helpers. These
belong to TS `packages/ingest-core`, `apps/ingestion-control` handlers, Rust
kernels or a named source adapter. The remaining student-handbook manifest
helper is deliberately named `handbook_cleanup_manifest` and is scoped to
logical document-boundary validation, not reusable collection split-manifest
runtime, canonical markdown generation or document-units generation.
The remaining shared layout helper is deliberately named
`layout_cleanup_common`; it serves OCR / OOXML cleanup adapters only and must
not be rebuilt as `source_truth_common` or any source-truth owner.
File asset adapter metadata must use `FileAsset*` names; Python must not
reintroduce `RawAsset*` registry terminology.

PDF page counting / splitting may use a permissive lightweight parser for
local file kernel work. PDF page rendering probes are retired from the default
workspace; later rendering must be admitted as an explicit adapter runtime
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
