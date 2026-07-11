---
doc_type: architecture
truth_scope: execution
owner_boundary: python-boundaries
status: active
created: 2026-04-26
updated: 2026-07-08
---
# Python Boundary

## 文档边界

本文冻结 Python side adapter boundary。它不改变 Temporal / Go
execution-control 的 ownership，只说明 Python 不再参与 online answer hot path，
以及后续只能保留在哪些非热路径场景。

## Runtime Boundary

Python 不再拥有 deterministic execution runtime truth。

- `apps/supervisor-agent-worker` 已从 active workspace 删除；旧实现只可通过 git
  history 追溯
- OpenAI Agents SDK in `apps/agent-runtime` owns the only online agent/tool
  loop；Go `apps/execution-control` 拥有 admission、Temporal lifecycle、memory
  activities、internal query、evidence/source validation、observability 与
  fail-close terminal projection
- Python worker 不消费 online Go canonical bridge envelope，也不作为 Temporal activity backend
- 新增 Python 只能用于明确隔离的 offline ingestion / eval / tooling；不得恢复旧
  online serving bridge
- Python 不拥有 online provider cancellation、token / estimated cost accounting、
  sanitized projection、workflow truth 或 semantic orchestration

## Knowledge Boundary

旧 Python knowledge runtime package 已从 active workspace 删除。当前
`knowledge_query` 由 primary agent 通过 OpenAI Agents SDK official `handoff()`
进入同一 SDK run 内的 Knowledge Agent：

- Knowledge Agent 负责 query framing、bounded evidence consumption、answer
  synthesis 与 evidence-backed structured output
- Knowledge Agent 只调用 internal `knowledge_search`
- execution-control 负责 scope/version admission、embedding/Qdrant/rerank、bounded
  evidence projection、terminal evidence validation 与 source generation

整个 SDK run 是单个 Temporal Agent Activity。Python 不作为该 activity 的 backend，
也不拥有独立 knowledge worker、provider-backed answer path 或 evidence validator。

## Retrieval Boundary

旧 Python `packages/retrieval-core` 已从 active workspace 删除。当前 online retrieval
归属到 Go-owned execution-control internal `knowledge_search` seam：

- Qdrant backend runtime adapter、embedding query cache、registry lookup、
  evidence shaping
- retrieval request validation、result construction、merge / dedupe
- retrieval runtime 不拥有 product tool admission，也不维护 query-enabled scope truth

LlamaIndex 不是架构层，也不得进入 contracts、execution-control、panel/eval canonical
truth。长期 online retrieval boundary 固定为 repo-owned DTO + Qdrant native adapter +
sanitized tool-call / evidence projection。

当前 active workspace 中，旧 Python ingestion package 已删除，不再通过 LlamaIndex
表达 embedding model、mock embedding 或 chunk node payload。ingestion chunk /
embedding seam 使用 repo-owned protocol / DTO；后续不得为了便利重新引入
LlamaIndex runtime coupling。

当前 rerank 事实限定为 Qdrant hybrid / RRF、heuristic ranking 与
serving-config-gated rerank interface；未发现线上 cross-encoder、torch、ONNX 或
sentence-transformers rerank 作为 current
serving truth。Rust 或其他语言重写必须以 step-level profiling 证明 CPU hotspot 为前提。

内部拆分规则：

- Go internal query service 保持 backend orchestration facade
- backend errors、embedding cache、registry lookup、evidence source shaping 继续按 owner
  分文件维护
- request projection、tool result、merge / trust filtering 属于 repo-owned
  retrieval runtime seam

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
connectivity. The retired `python_db_runtime` module and public
`build_*_from_env` registry / projection store builders are removed from the
active workspace. Python callers that still participate in migration tests must
receive stores, registries and ledgers through explicit dependency injection.
Pure URL validation / normalization helpers and SQL-shape unit tests may remain,
but active Postgres connection ownership belongs to the TS/Go database owner
surfaces. Python registry / projection connection entrypoints must fail closed
unless they are rebuilt as an explicitly admitted adapter boundary.

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
workspace. Curriculum course-map probe and docs-surface materialization consume
captured `CurriculumCourseMapRenderedSample` inputs only; later rendering must
be admitted as an explicit adapter runtime instead of reintroducing a default
native rendering dependency.

内部拆分规则：

- projection modules 不再同时承载 DTO、常量、validation 与 build/release orchestration
- 具体 projection 的 constants、models、validation、support helpers 分文件维护
- internal notice consumption projection 的 status models 与 multimodal
  consumption policy 分文件维护
- projection build/release 主文件只保留领域编排和 source-channel 映射

## Guardrails

- Repo governance scripts and common app scripts live in TypeScript. The
  top-level `scripts/` directory and app script directories for app-api,
  campus-web and operator-console-web must not add `.py`, `.mjs` or `.d.mts`
  implementations. Use `pnpm exec tsx` for these script entrypoints.
- Python tests remain valid only when they exercise admitted Python
  package/runtime islands: contracts models, ingestion contract package behavior
  and the isolated Ragas runner. Repo governance, CI/workflow contracts,
  Worker/app scripts, ingestion clean-target checks and other common tooling
  must be tested through TS checks or the owning package tests, not root-level
  Python unittest suites.
- Root `uv.workspace.members` is a narrow Python boundary allowlist:
  `packages/contracts`, `packages/ingestion-contracts`,
  `packages/ragas-runner`. TS / Worker / Rust owners must not add
  `pyproject.toml` workspace shells or re-enter `uv.lock`.
- 不把 Go runtime types、Qdrant / S3 / provider SDK types 写入 `packages/contracts`
- 不把 deterministic execution admission、evidence validation 或 source generation
  写回 Python
- 不把 ingestion source-truth / projection logic 拉入 Agent Activity
- 不把 retrieval backend private helpers 重新塞进 agent service
- 大模块出现增长时优先按 owner 拆文件，而不是在 facade 继续堆分支
- 不把 Python 继续保留在长期 online answer hot path 当作默认扩容策略
- 不用“provider stable”替代 provider adapter 的 latency、token、estimated cost、
  request ref、cancel / timeout outcome projection
- 不通过删除 Qdrant auth、弱化 data-plane boundary 或引入 fallback 来掩盖性能/诊断缺口
