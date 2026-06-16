---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0056
status: accepted
created: 2026-06-16
updated: 2026-06-16
supersedes:
  - adr-0053-qdrant-native-personal-memory-index
---
# ADR-0056: Zep CE Self-Hosted Personal Memory Plane

## Context

Personal memory must support multi-user, multi-session conversational recall,
completed-turn append, explicit user-declared memory management, owner deletion
/ RTBF and cross-thread recall. The previous Qdrant-native plan forced this repo
to own extraction prompt/schema, embedding selection, dedupe/merge semantics and
collection lifecycle for a domain that is not institutional retrieval.

That split was wrong for the target product: Qdrant remains a strong fit for
institutional RAG, but personal memory needs a user graph memory system.

## Decision

Adopt self-hosted Zep CE as the only personal memory substrate.

- `apps/execution-control` owns Zep CE `/api/v2` HTTP integration.
- Temporal keeps `MemoryRecallActivity` and adds completed-turn
  `AppendConversationMemoryActivity`.
- app-api manual profile-memory product APIs call execution-control internal Zep
  commands; app-api does not call Zep CE API, Graphiti, Neo4j or Qdrant
  directly.
- PG `profile.memory_items` stores user-facing projection plus internal
  `runtime_episode_uuid`; browser responses do not expose the runtime ref.
- Zep user id and thread id are execution-control-owned derived runtime ids:
  product `tenant_id`, `user_id` and `conversation_id` are inputs, not Zep object
  identifiers.
- Qdrant is no longer used for personal memory.

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
- `UpdateInferredMemoryActivity`
- provider-backed personal memory extraction eval/profile

## Consequences

`execution-control` and `activity-context` require:

```text
PERSONAL_MEMORY_RUNTIME=zep_ce
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
PERSONAL_MEMORY_TIMEOUT_SECONDS
PERSONAL_MEMORY_RECALL_LIMIT
PERSONAL_MEMORY_RECALL_MAX_CHARS
```

`activity-knowledge` does not require Zep config; it consumes bounded memory
context after recall.

Graphiti, Neo4j and Postgres / pgvector are Zep CE runtime bundle internals. They
are deployed by local / staging infrastructure as part of Zep CE, but
`campus-agent` code and contracts do not integrate with them directly.

Graphiti's LLM model surface is still governed through app-api provider-config:
the accepted prompt role is `memory_graph_llm`. Graphiti calls the app-api
internal OpenAI-compatible proxy with `APP_API_INTERNAL_SHARED_SECRET`; the proxy
reads the active profile and forwards to the real provider with the stored
provider key. Zep-specific provider env is not product truth.

Local development generates Zep CE bundle secrets in
`infra/local/.generated/zep-ce.env`. This file is ignored by git and may contain
Postgres / Neo4j local secrets. It must not contain provider API keys. Staging /
production must use their ops-owned secret store; repo-local generated files are
not valid deployment inputs.

The repo-owned memory eval profile is `zep-memory-product-path`, which validates
append, recall, explicit profile upsert/disable, owner disable and user
isolation. It does not evaluate repo-owned extraction prompts because extraction
is delegated to Zep.

## Rejected Alternatives

- Keep Qdrant personal memory: rejected because it requires the repo to own graph
  memory semantics, extraction and dedupe that Zep already provides.
- Dual-write Qdrant and Zep: rejected because it creates two personal memory
  truths and hides consistency failures.
- Keep provider-backed extraction as a fallback: rejected because it preserves the
  retired contract and would let serving silently drift away from Zep behavior.
