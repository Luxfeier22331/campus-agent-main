---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0058
status: accepted
created: 2026-06-16
updated: 2026-06-18
supersedes:
  - ADR-0057 Zep CE Self-Hosted Personal Memory Plane
  - ADR-0053 Qdrant-Native Personal Memory Index
---
# ADR-0058: Hindsight Self-Hosted Personal Memory Plane

## Context

Personal memory must support multi-user, multi-session conversational recall,
completed-turn append, explicit user-declared memory management, owner deletion
/ RTBF and cross-thread recall. The previous Qdrant-native plan forced this repo
to own extraction prompt/schema, embedding selection, dedupe/merge semantics and
collection lifecycle for a domain that is not institutional retrieval.

That split was wrong for the target product: Qdrant remains a strong fit for
institutional RAG, but personal memory needs a user graph memory system.

## Decision

Adopt self-hosted Hindsight as the only personal memory substrate.

- `apps/execution-control` owns Hindsight HTTP integration through the Hindsight
  Go client/runtime adapter.
- Temporal keeps `MemoryRecallActivity` and adds completed-turn
  `AppendConversationMemoryActivity`.
- app-api manual profile-memory product APIs call execution-control internal
  personal-memory commands; app-api does not call Hindsight, Postgres / pgvector
  or Qdrant directly.
- PG `profile.memory_items` stores user-facing projection plus internal
  `runtime_episode_uuid`; browser responses do not expose the runtime ref.
- Hindsight bank id and document id are execution-control-owned derived runtime
  ids: product `tenant_id`, `user_id` and `conversation_id` are inputs, not
  Hindsight object identifiers.
- The single-campus default product tenant is `tenant-main`. app-api writes this
  tenant into durable execution payload and internal personal-memory commands;
  empty tenant strings are not accepted as an implicit default.
- Hindsight bank id is derived as `hindsight_bank_` plus a SHA-256 digest of
  `PERSONAL_MEMORY_OWNER_SALT`, `tenant_id` and `user_id`.
- Completed-turn conversation document id is derived as `conversation:` plus a
  SHA-256 digest of `PERSONAL_MEMORY_OWNER_SALT`, Hindsight bank id and product
  `conversation_id`.
- Explicit profile memory document id is `profile:<memory_id>`.
- There is no Zep CE migration path in the current branch tip. Existing product
  projection can be rebuilt through app-api explicit profile-memory commands;
  online recall truth starts from Hindsight.
- Qdrant is no longer used for personal memory.
- `context.memory.enabled` gates both recall and append. Missing or false gates
  skip Hindsight calls and project skipped `memory.recall` / `memory.append`
  steps.
- Completed-turn append uses Hindsight async retain and returns `accepted` after
  Hindsight accepts the write request. It must not claim `completed` graph
  materialization.
- Completed-turn append only sends the user message as Hindsight extractable
  memory content by default. Assistant answers remain finalization projection,
  not graph-extraction input.
- Append failures are post-answer side-effect failures: finalization is not
  failed, but `memory.append` must be projected as failed and counted by
  bounded-label personal-memory metrics.
- Hindsight official OpenAI Agents direct tools and MCP server are not exposed to
  the primary agent. The repo uses Hindsight as the substrate behind
  execution-control and Temporal, then passes bounded memory instructions/context
  to the OpenAI Agents SDK loop.
- Memory activities have a dedicated Temporal activity policy: timeout is
  governed by `personal_memory.timeout_seconds` with a 90 second default,
  heartbeat timeout is 30 seconds, deterministic config/request/projection
  failures are non-retryable, and transient Hindsight transport failures use the
  bounded retry policy.

Retired:

- `personal_memory_v1`
- `personal_memory_extraction`
- `personal_memory_embedding`
- `PERSONAL_MEMORY_COLLECTION`
- `PERSONAL_MEMORY_TOP_K`
- `PERSONAL_MEMORY_MAX_CHARS`
- `PERSONAL_MEMORY_SCORE_THRESHOLD`
- `ZEP_BASE_URL`
- `ZEP_API_KEY`
- `ZEP_PROJECT_SALT`
- `ZEP_TIMEOUT_SECONDS`
- `ZEP_RECALL_MAX_CHARS`
- `ZEP_ASSISTANT_NAME`
- `ZEP_USER_NAME`
- `ZEP_CE_POSTGRES_PASSWORD`
- `ZEP_CE_NEO4J_PASSWORD`
- `ZEP_CE_OPENAI_BASE_URL`
- `ZEP_CE_OPENAI_API_KEY`
- `infra/local/.generated/zep-ce.env`
- `zep-memory-product-path`
- `memory_graph_llm`
- `UpdateInferredMemoryActivity`
- provider-backed personal memory extraction eval/profile

## Consequences

`execution-control` and `activity-core` require deployment env handles:

```text
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
```

`personal_memory.runtime`、`personal_memory.timeout_seconds`、
`personal_memory.recall_limit` 与 `personal_memory.recall_max_chars` 由
execution-control runtime profile 管理。

`activity-knowledge` does not require Hindsight config; it consumes bounded memory
context after recall.

Hindsight service internals, Postgres / pgvector and its LLM / embedding
providers are deployment internals. `campus-agent` code and contracts do not
integrate with those internals directly.
Hindsight bank ids, document ids, async operation ids, raw recall/retain payloads
and Hindsight API credentials must not appear in model-visible tools,
browser-facing responses, app-api product contracts or `packages/contracts`.

Hindsight LLM / embedding provider configuration is governed by app-api
provider-config active profiles and projected through the local
`provider_config_projection.v1` artifact into the Hindsight deployment env.
The accepted Hindsight provider-config roles are `hindsight_llm` and
`hindsight_embedding`; retired memory extraction provider roles stay retired.
app-api does not proxy Hindsight model traffic and does not call Hindsight API
directly.

Local development generates self-host runtime bundle secrets in
`infra/local/.generated/runtime.env`. This file is ignored by git and may
contain local runtime secrets. Staging / production must use their ops-owned
secret store or generated runtime secrets file; repo-local generated files are
not valid deployment inputs.

The repo-owned memory eval profile is `hindsight-memory-product-path`, which validates
append, recall, explicit profile upsert/disable, owner disable and user
isolation. It does not evaluate repo-owned extraction prompts because extraction
is delegated to Hindsight.

## Rejected Alternatives

- Keep Qdrant personal memory: rejected because it requires the repo to own graph
  memory semantics, extraction and dedupe that Hindsight already provides.
- Dual-write Qdrant and Hindsight: rejected because it creates two personal memory
  truths and hides consistency failures.
- Keep provider-backed extraction as a fallback: rejected because it preserves the
  retired contract and would let serving silently drift away from Hindsight behavior.
- Expose Hindsight MCP or `create_hindsight_tools()` directly to the primary
  agent: rejected because it bypasses execution-control admission, Temporal
  lifecycle, sanitized projection, RTBF and multi-student isolation boundaries.
