---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-28
updated: 2026-07-10
---
# Runtime Serving And Index Terms

## Boundary

This document is a glossary for serving, retrieval and indexing terms that are
easy to confuse. It does not own architecture, retention policy, rollout state,
runbook procedure or collection-specific release rules.

Owner docs for non-glossary truth:

- Current topology: `docs/architecture/current.md`
- Target invariants: `docs/architecture/target.md`
- Tool routing: `docs/architecture/system/tool-routing.md`
- Retrieval serving: `docs/architecture/system/retrieval-serving.md`
- Data plane: `docs/architecture/system/data-plane.md`
- Tool execution/evidence contract: `docs/contracts/tool-execution.md`
- Qdrant retention decision: `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`

## Product And Reader Terms

### Reader Permalink

A stable student-facing document reader URL, for example
`/docs/:corpus/:collection/:docSlug`.

Reader permalinks do not contain `chunkId`, `sourceUnitKey` or object-storage
keys.

### Fragment Identifier

The `#<anchor>` portion of a URL. It points the browser to a section or block
inside the opened reader page.

### Highlight Query Parameter

The project-specific `?hl=<rootUnitId1>,<rootUnitId2>` URL parameter used to
request one-time body block highlighting.

## Scope Terms

### Corpus / Collection Scope

A retrieval/runtime boundary named as `corpus/collection`.

`source channel`, `corpus`, `collection`, `serving surface` and product intent
classification are different layers. A source channel can fan out to multiple
collections, and a product intent does not become a collection just because the
names look similar.

### Source-Triage Collection

A collection that owns replay, wrapper document, attachment outcome,
manual-review truth and provenance for a source channel.

Example: `campus_notices/internal_notice`.

### Semantic-Owner Collection

A collection that owns canonical, answerable document content for a knowledge
domain.

Examples include `regulations/*` and `curriculum/*`.

### Query-Enabled Scope

A `corpus/collection` that current serving policy allows into the query-serving
main path.

The active allowlist is owned by serving configs and current architecture docs,
not this glossary.

### Tool Read Model Scope

A structured read-model scope consumed by an admitted SDK function tool instead
of the Knowledge Agent's `knowledge_search` path.

Example: `campus_services/transport_schedule` for the current transport
schedule tool/status surface.

- 当前 query-enabled scope 是 `regulations/student_rules`、
  `regulations/institutional_rules` 与 `curriculum/curriculum_plan`
- `regulations/scoped_rules` 当前仍不属于默认 query-enabled scope，也不得进入默认
  RAG release candidate；它可以作为 `gated_asset` 进入 document-site read-model /
  docs reader release，由 `app-api` 做 reader admission
- `campus_services/transport_schedule` 当前是 campus-services 唯一
  `tool_read_model_serving` collection，只能通过 admitted
  `transport_schedule_lookup` 消费 current projection/read model，不进入 generic
  retrieval 默认 query scope
- `campus_services/service_status` 当前只保留 closed/internal status projection
  prework，不承担 model-visible structured product serving
- `calendar/academic_calendar` 当前是 offline data asset / preparation scope，不属于
  campus-services model-visible runtime tool
- 历史 `official_web/muc_public_pages` mixed bridge 已退出 active ingestion
  configs；当前 official-web active collection 只承认 `stable_reference` 与
  `fresh_news`

### Retrieval Qrels Asset

定义：

- deterministic retrieval truth denominator lives in
  `packages/eval-langfuse/assets/qrels/rag/<surface>/` qrels files. The old
  `packages/evals/fixtures/registry.v1.json` registry has been retired.

说明：

- qrels asset 以 `case_id`、query、scope、expected / forbidden source refs、authz /
  version request overrides 表达 retrieval gate truth
- 当前默认 query-enabled scope 必须都有 qrels asset：
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
- qrels asset 不等于 source truth、registry truth 或 release manifest；它是 eval / release
  gate 的 denominator

### Retrieval Eval Manifest

定义：

- qrels validation 用来 anchor document id / title 的 lightweight manifest

说明：

- 对有静态 split truth 的 collection，默认使用
  `configs/ingestion/<corpus>/<collection>/split-manifest.v1.json`
- 对 projection-derived 且没有静态 split manifest 的 scope，可使用同目录
  `retrieval-eval-manifest.v1.json`
- `retrieval-eval-manifest.v1.json` 只服务 deterministic qrels validation；不替代 registry
  scope、current pointer、release manifest 或 object-store artifact truth

### Retrieval Tuning Report

定义：

- per-collection deterministic tuning artifact。旧 Python retrieval tuning runner
  已退役；新 tuning report 生成器必须由 TS eval lane 或 owning runtime 提供。

说明：

- 输入是 qrels asset 与一个或多个 candidate run-results
- candidate profile 可覆盖 dense / sparse prefetch、RRF 参数与 no-hit threshold
- 输出包含 positive hit / recall / MRR、forbidden hit rate、no-hit success、version-locked
  recall 与 `recommended_serving_config_patch`
- 只有 candidate 通过 deterministic gate 时才允许产生 recommendation
- tuning report 不自动改写 `serving-config.json`，也不自动扩大 query-enabled scope

## Routing Terms

### Tool Domain

The top-level tool/domain or workflow signal recognized before agent-owned
execution. It is used for admission, routing, guardrails and clarification.

Tool domain is not the same as `corpus/collection`, and it does not have to map
one-to-one to a wire `selected_tool` value.

### Tool Wire Fields

Existing wire/projection fields such as `tool`, `requested_tool` and
`selected_tool`.

These names describe current wire/projection fields. They should not become
product taxonomy or new conceptual naming. A caller-provided `requested_tool`
is a hint or internal forced route in current contracts; it is not the normal
target-state owner of primary-agent tool selection.

### Runtime Visible Tool Set

The model-visible tools admitted for one execution run.

`execution-control` derives this set from the runtime tool registry and workflow
state before primary-agent selection. `app-api` does not maintain a parallel
surface allowlist. A trusted internal forced hint is validated separately and
does not publish retrieval scopes.

### Knowledge Tool Scope

A model-facing scope id used after a request has entered the knowledge tool
path. Execution-control maps it to internal retrieval ownership; callers do not
send `corpus/collection`.

Knowledge tool scope comes from the SDK `knowledge_query` handoff arguments or
a trusted eval/debug hint. In both cases, execution-control resolves admission
from serving policy, release/current alias truth and visibility projection.

### Agent Clarification

Clarification produced by the active SDK agent for missing parameters,
ambiguity or constraints.

## Retrieval Terms

### Knowledge Handoff

The official OpenAI Agents SDK `handoff()` from the primary agent to the
Knowledge Agent in the same SDK run.

### Knowledge Search

The internal-only SDK function tool available to the Knowledge Agent. It calls
execution-control for admitted indexed evidence and is not model-visible to the
primary agent.

### Search Call

One bounded `knowledge_search` invocation with run identity, scope, version and
query. Multiple SDK calls remain part of one Agent Activity.

### Candidate Set

The internal results produced by indexed lookup before bounded evidence shaping.

Candidate sets are execution truth; they are not automatically supporting
evidence.

### Bounded Evidence

The safe evidence subset returned to the Knowledge Agent. Answer claims and
final sources must use these evidence refs, not raw candidate traces.

### Resolved Version

The execution-control projection of admitted `current`, `historical`, `as_of`
or `compare` version semantics before indexed lookup.

### Execution Metadata

Sanitized search, resolved-version, rerank, evidence and result summaries
emitted for observability, audit and grading.

### Knowledge Search Observation

The sanitized scope/version, latency, evidence-count and result summary emitted
by execution-control for one internal search call.

### OTel Bridge

Runtime integration that converts retrieval observations into
OpenTelemetry-compatible logs, events, metrics or traces.

## Index Terms

### Serving Alias

A release-managed stable Qdrant collection alias exposed to runtime queries.

The alias is not a specific physical collection.

### Collection Prefix

The stable prefix used to generate versioned physical collection names for a
`corpus/collection`.

### Physical Collection

The versioned Qdrant collection written by one index release. It is an offline
release artifact, not the runtime-stable interface.

### Physical Collection Retention Role

The role assigned to a physical collection for retention evaluation, such as
`current`, `previous`, `migration_baseline` or `archive_candidate`.

Deletion policy is owned by ADR-0019 and relevant operator runbooks.

### Chunk Preparation

The offline `split -> cleanup -> chunk -> validation` work that happens after
document truth and before index release.

It does not embed, write Qdrant or publish a serving alias.

### Chunk Preparation Manifest

A small trace artifact for a chunk preparation run. It proves which inputs,
profile and fingerprints were validated before release.

It is a release-gate input, not an online index substitute.

### Index Release

A full `embedding -> indexing -> alias publish` action. It produces a new
physical collection and publishes the serving alias only after validation.

### Release Manifest

A small trace artifact for an index release. It records provider/model,
dimension, document-unit hash and chunk fingerprint hash for audit and rollback.

It does not store chunk dumps.

### Qdrant Native Snapshot Bundle

A self-hosted Qdrant collection snapshot recovery bundle. It is recovery
material, not online chunk truth or a serving seed store.

### Historical Object-Store Snapshot Backup Bundle

An older object-store-backed Qdrant backup shape retained only as historical
cleanup context. It is not the current backup path.

### Source Truth

The canonical rebuild boundary after provider-private responses and before
document projection.

Source truth feeds document build, chunking and replay. Chunk dumps are not
source truth.

## Common Confusions

- Serving alias is not a physical collection.
- `corpus/collection` and model-facing `scope` are not tool routing proxies.
- Routing clarification is not agent clarification.
- Chunk preparation manifest is not index release manifest.
- Release manifest is not a chunk store.
- Snapshot backup bundle is not an online query store.
