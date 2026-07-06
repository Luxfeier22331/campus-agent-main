---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0058
status: accepted
created: 2026-06-16
updated: 2026-06-29
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

The official Hindsight model is broader than a recall store: it provides retain,
recall, reflect, async operation handling and memory-bank lifecycle. The current
repo integration must adopt those semantics without moving policy, projection or
secret ownership into the model-facing agent runtime.

## Decision

Adopt self-hosted Hindsight as the only personal memory runtime substrate.

- `apps/execution-control` owns Hindsight HTTP integration through the Hindsight
  Go client/runtime adapter.
- Hindsight owns `retain`, `recall`, `reflect`, async operation status and memory
  bank lifecycle semantics for personal memory.
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
- Every scoped bank must be explicitly bootstrapped through the Hindsight bank
  API before retain / recall / reflect / operation inspection / profile item
  delete. The execution-control adapter must configure bank-level Memory Defense
  with `sensitive_data` redaction, read config back, and fail closed if the
  expected config is not active.
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
- Recall uses `query_timestamp` from app-api's accepted user message
  `context.conversation.current_user_message.created_at`. Completed-turn retain
  uses that same user-message timestamp, and explicit profile retain uses the
  profile command `updated_at`.
- Hindsight bank create/update is executed before recall, completed-turn retain
  and explicit profile retain so the scoped bank has the student-assistant retain
  mission, custom retain instructions, custom extraction mode and observations
  disabled.
- Completed-turn append uses Hindsight async retain and returns `accepted` after
  Hindsight accepts the write request. It must not claim `completed` graph
  materialization until operation status or later recall / reflect evidence proves
  it.
- Async retain must return an operation id. The id is internal runtime metadata
  only; execution-control may query it through an internal worker-auth operation
  status endpoint with Hindsight `include_payload=false`.
- Completed-turn append only sends the user message as Hindsight extractable
  memory content by default. Assistant answers remain finalization projection,
  not graph-extraction input.
- `memory.reflect` is accepted as an internal workflow target for
  memory-grounded reasoning and `based_on` facts; it is not the default
  user-facing final-answer owner.
- Hindsight operation lifecycle is accepted as an internal/operator function:
  status/list/cancel/retry stay behind execution-control, return sanitized
  operation refs, and do not expose raw bank ids, raw result metadata or vendor
  payloads to browser/model-facing surfaces.
- Hindsight surface policy is audience-aware:
  - `execution-control internal` may hold Hindsight bank/document/operation ids
    and repo-owned projection refs needed for lifecycle control.
  - `operator/internal ops` may receive repo-owned operation refs and bounded
    status/kind/count/hash/shape diagnostics.
  - `student browser-facing` responses must strip Hindsight bank ids, document
    ids, operation ids, operation refs, runtime document refs, result metadata
    shape and vendor payload references.
  - `model-visible` tools/context must not include Hindsight MCP, direct
    Hindsight tools, raw Hindsight ids or raw payloads.
- Hindsight retain / recall requests must follow official temporal semantics:
  completed-turn and explicit profile retain items include a timestamp for when
  the memory content occurred or was updated, and recall includes
  `query_timestamp` when execution-control generates the request. Recall /
  reflect facts without `occurred_*` / `mentioned_at` remain valid bounded
  memory facts; the projection may leave `updated_at` empty instead of dropping
  the fact.
- Hindsight async operation status must request status metadata without raw task
  payload by setting `include_payload=false`.
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
`personal_memory.recall_limit`、`personal_memory.recall_max_tokens` 与
`personal_memory.context_char_budget` 由 execution-control runtime profile 管理。
`recall_max_tokens` is the Hindsight recall token budget; `context_char_budget`
is the local bounded context block budget.

`activity-knowledge` does not require Hindsight config; it consumes bounded memory
context after recall.

Hindsight service internals, Postgres / pgvector and its LLM / embedding
providers are deployment internals. `campus-agent` code and contracts do not
integrate with those internals directly.
Hindsight bank ids, document ids, async operation ids, raw recall/retain payloads
and Hindsight API credentials must not appear in model-visible tools,
browser-facing responses, app-api product contracts or `packages/contracts`.
Internal operation refs such as `projection://runs/.../memory/operations/...`
and document refs such as `projection://runs/.../memory/documents/...` are
internal/operator diagnostics only; app-api student run-step reads must remove
them from browser-facing projections while preserving public status/count/hash
fields.
The internal operation-status path must not request or return Hindsight task
payloads.

Hindsight LLM / embedding provider configuration is governed by app-api
provider-config active profiles and projected through the local
`provider_config_projection.v1` artifact into the Hindsight deployment env.
The accepted Hindsight provider-config roles are `hindsight_llm` and
`hindsight_embedding`; retired memory extraction provider roles stay retired.
app-api does not proxy Hindsight model traffic and does not call Hindsight API
directly.

Local development must provide self-host runtime secrets through explicit local
env or a developer-owned local platform Secret. Staging / production must use
the selected Kubernetes Secret backend. Repo-local generated runtime env files
are retired and are not valid deployment inputs.

The repo-owned memory evidence taxonomy / score profile is
`hindsight-memory-product-path`, which names append, append operation status /
materialization proof, recall, observation type coverage, reflect with
`based_on` facts, operation list sanitized projection, explicit profile
upsert/disable, owner disable and user isolation. It does not evaluate
repo-owned extraction prompts because extraction is delegated to Hindsight.
The live staging runtime gate is
`pnpm --dir apps/app-api hindsight:memory:e2e:staging`; the retired Python
`scripts.eval_gate accept` path must not be used as the Hindsight live gate.

Current implementation includes bank bootstrap, bank-level Memory Defense
redaction verification, sanitized `Reflect`, async operation status/list/action
projection, timestamped retain, timestamped recall, `observation` recall
coverage, untimed fact projection, execution-control bounded `recall_limit`
projection and a live self-hosted Hindsight staging smoke runner. The live
runner proves async retain materialization via operation status or later recall
/ reflect evidence, plus profile upsert / disable and owner isolation.
Operation cancel/retry are covered as internal API smoke/unit behavior because
live success depends on Hindsight having a pending or failed operation at that
moment.

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
  The current `apps/agent-runtime` surface is TypeScript `@openai/agents`, while
  memory policy, bank scoping, service secret handling and sanitized projection
  are owned by `execution-control`; official Hindsight semantics are adopted
  through the Go SDK and repo-owned typed boundary instead.
