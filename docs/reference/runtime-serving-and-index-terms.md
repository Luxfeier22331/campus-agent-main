---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-28
updated: 2026-06-29
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
- Retrieval plan contract: `docs/contracts/retrieval-plan.md`
- Retrieval activity data model: `docs/data/retrieval-activity.md`
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

A structured read-model scope consumed by an admitted typed tool instead of the
generic RAG retrieval path.

Example: `campus_services/transport_schedule` for the current transport
schedule tool/status surface.

- 当前 query-enabled scope 是 `regulations/student_rules`、
  `regulations/institutional_rules`、`curriculum/curriculum_plan` 与
  `official_web/stable_reference`
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
  - `official_web/stable_reference`
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

The top-level capability or workflow signal recognized before agent-owned
execution. It is used for admission, routing, guardrails and clarification.

Tool domain is not the same as `corpus/collection`, and it does not have to map
one-to-one to a wire `selected_tool` value.

### Tool Wire Fields

Existing wire/projection fields such as `tool`, `requested_tool` and
`selected_tool`.

These names describe current wire/projection fields. They should not become
product taxonomy or new conceptual naming.

### Surface Tool Allowlist

The set of tool domains a product surface currently admits.

This gate happens before knowledge scope resolution.

### Knowledge Tool Scope

A scope hint or resolved scope used after a request has entered the knowledge
tool path. It may map to `corpus/collection`, but it is not a top-level product
intent classifier.

### Routing Clarification

Clarification raised before agent-owned execution to decide admission, tool
route or handoff path.

It solves “which admitted path should this request enter”, not “which collection
should the user manually pick”.

### Agent Clarification

Clarification raised after route selection for domain-specific missing
parameters, ambiguity or constraints.

## Retrieval Terms

### Retrieval Plan

A typed plan for planner-first retrieval execution. Contract details live in
`docs/contracts/retrieval-plan.md`.

### Retrieval Step

A single executable unit inside a retrieval plan. It at least identifies step
type, target scope, query/filter shape and budget.

### Planner Budget

The enforced limit for retrieval planning and execution, such as step count,
latency or live-branch allowance. Budget exhaustion should fail closed.

### Query Activity

A step-level retrieval execution trace summary. Data shape lives in
`docs/data/retrieval-activity.md`.

### Candidate Set

The results produced by retrieval steps before answer-facing evidence selection.

Candidate sets are execution truth; they are not automatically supporting
evidence.

### Supporting Evidence

The bounded evidence subset allowed to support the final answer. Citation,
grounding and answer shaping are based on supporting evidence, not raw candidate
traces.

### Freshness Gate

Admission logic for freshness-sensitive queries such as “today”, “latest” or
“recent”.

If local freshness is insufficient, the request must use an admitted live branch
or fail closed.

### Live Evidence

Evidence from an admitted live source channel during a retrieval execution.

Live evidence is not general web fallback, does not write canonical index truth
and must be identified as live-assisted runtime evidence.

### Execution Metadata

Sanitized plan, step, merge, rerank and freshness-branch summaries emitted
during retrieval execution for observability, audit and grading.

### Retrieval Observation Sink

The runtime callback boundary for emitting sanitized retrieval observations.
Sink failures and fail-closed behavior are owned by the retrieval/runtime
architecture docs, not this glossary.

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
- `corpus/collection` and `requestedScope` are not tool routing proxies.
- Routing clarification is not agent clarification.
- Chunk preparation manifest is not index release manifest.
- Release manifest is not a chunk store.
- Snapshot backup bundle is not an online query store.
