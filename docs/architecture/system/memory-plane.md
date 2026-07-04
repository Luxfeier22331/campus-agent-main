---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-09
updated: 2026-06-28
---
# Memory Plane Architecture

## 文档边界

本文冻结 `campus-agent` 的 Hindsight self-host Personal Memory Plane。当前个人记忆不再
使用 Qdrant collection、repo-owned LLM extraction prompt、personal memory embedding
profile 或 provider-backed memory extraction eval；Qdrant 只承载 institutional RAG。
完整目标姿态以 Hindsight 官方 `retain` / `recall` / `reflect` / operation / bank
语义为准，但通过 repo-owned execution-control boundary 消费，不把 Hindsight vendor
tools 直接暴露给模型。

## Positioning

Personal memory 是 per-user advisory context，用于 follow-up、偏好、常用地点 / 服务、
别名消歧、query framing 与回答措辞。它不是身份、授权、source truth、tool opening
或 fail-close truth，不能决定用户能使用哪些工具、能读取哪些 source，不能放宽 evidence
requirement，也不能授予 operator surface 权限。

长期 owner 固定为：

- `apps/execution-control` owns online memory recall execution and append command.
- Temporal orchestrates `context.memory_recall` and `memory.append`.
- Hindsight owns personal memory extraction, graph storage, dedupe / merge,
  retain / recall / reflect, async operation status and memory-bank lifecycle.
- `apps/app-api` owns user-facing manual profile-memory product API and PG projection.
- PostgreSQL `profile.memory_items` stores product projection and the Hindsight
  document id runtime reference; it is not online recall truth.

因此：

- online chat hot path 不再执行 `app-api -> PG profile.memory_items ->
  context.profile_memory` full injection。
- personal memory 与 institutional RAG 完全分离：personal memory 走 Hindsight runtime，
  institutional RAG 走 Qdrant / retrieval-core。
- execution-control 不维护个人记忆向量 schema、collection alias、embedding compatibility
  check、repo-owned extraction prompt 或 extraction threshold。
- Temporal 不是 memory database；Temporal 只编排 activity / workflow lifecycle。

## Hindsight Runtime

Hindsight runtime 以独立自托管服务部署，`campus-agent` 只通过官方 Go SDK 消费
Hindsight HTTP API。Hindsight API、Hindsight worker、PostgreSQL / pgvector 与
embedding / LLM provider 是 Hindsight deployment 内部组件，不是 `campus-agent`
业务代码或 `packages/contracts` 的集成边界。

Hindsight 官方 OpenAI Agents integration 当前是 Python-oriented happy path，
提供 `create_hindsight_tools()` 与 `memory_instructions()`。`campus-agent` 当前
model-facing runtime 是 TypeScript `@openai/agents`，且 memory secret、policy、
projection 与 audit boundary 固定在 `execution-control`，因此本仓库采用 Hindsight
官方 memory 语义与官方 Go SDK，而不是把 Hindsight Python tools 直接接入
`apps/agent-runtime`。

Hindsight runtime 的 execution-control internal env projection 为：

```text
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
```

`personal_memory.runtime`、`personal_memory.timeout_seconds`、
`personal_memory.recall_limit`、`personal_memory.recall_max_tokens` 与
`personal_memory.context_char_budget` 由 execution-control runtime profile 管理，不再通过
env 配置。`recall_max_tokens` 只传给 Hindsight recall `max_tokens`；
`context_char_budget` 只限制本仓库投给 agent / RAG 的本地 context block。

Hindsight API 使用 `HINDSIGHT_API_TENANT_EXTENSION` /
`HINDSIGHT_API_TENANT_API_KEY` 做 service-to-service auth；`PERSONAL_MEMORY_API_SECRET`
就是 execution-control 对 Hindsight API 的 bearer token。Hindsight LLM / embedding provider
的 key / base URL / model 由 app-api provider-config active profiles 统一治理；显式 sync
生成的本地 provider projection artifact 将 `hindsight_llm` 与 `hindsight_embedding`
投影为 Hindsight runtime env。
app-api 不代理 Hindsight 模型流量，也不直接调用 Hindsight API。

`PERSONAL_MEMORY_BASE_URL` 默认由 deployment profile 投影为 internal service DNS，例如
Docker Compose 内的 `http://hindsight-api:8888`。`PERSONAL_MEMORY_API_SECRET` 与
`PERSONAL_MEMORY_OWNER_SALT` 由 local / staging lifecycle 首次生成并持久化到
ops-owned generated env file；开发者不需要手工填写这些内部值。只有部署到外部
Hindsight endpoint 或轮换 secret / salt 时才应显式覆盖。

local dev 的 self-host runtime secret 由
`infra/local/scripts/ensure-runtime-secrets.mjs` 生成到
`infra/local/.generated/runtime.env`。staging lifecycle 生成到 runtime dir 下的
`secrets/runtime.env`。这些文件属于对应环境 runtime，不进入 repo-tracked env。

`PERSONAL_MEMORY_OWNER_SALT` 用于把 `tenant_id + user_id` 派生为 scoped Hindsight
bank id，并把 scoped bank id + 产品侧 `conversation_id` 派生为 Hindsight
conversation document id。
local / staging / production 都必须持有稳定 salt。产品侧 user id / conversation id
不得直接作为 Hindsight runtime id；sanitized projection 只保留产品侧 `thread_id` /
`conversation_id`，不暴露 internal Hindsight bank id。

当前单校区产品 profile 的默认 product tenant 固定为 `tenant-main`，由 app-api
代码内约定写入 durable execution payload 与 internal personal-memory command；开发者不
需要为该 tenant 手工配置 env。后续若引入多租户，必须先提升为明确 product identity
contract，而不是让各调用点自行传空字符串或猜默认值。

retired env 必须 fail closed：

```text
ZEP_BASE_URL
ZEP_API_KEY
ZEP_PROJECT_SALT
ZEP_TIMEOUT_SECONDS
ZEP_RECALL_MAX_CHARS
ZEP_ASSISTANT_NAME
ZEP_USER_NAME
PERSONAL_MEMORY_COLLECTION
PERSONAL_MEMORY_TOP_K
PERSONAL_MEMORY_MAX_CHARS
PERSONAL_MEMORY_SCORE_THRESHOLD
```

retired provider-config roles：

```text
personal_memory_extraction
personal_memory_embedding
```

## Official Hindsight Semantics And Current Implementation

Hindsight 在本仓库中的目标 runtime surface 固定为：

- `retain`：把 completed turn、用户显式 profile memory 或后续批准的 profile
  change 写入 scoped memory bank，并由 Hindsight 执行 extraction、dedupe / merge
  与 graph update。
- `recall`：从 scoped bank 中检索 bounded memory facts。目标 recall type 覆盖
  `world`、`experience` 与 `observation`；输出只进入 sanitized bounded context。
- `reflect`：由 Hindsight 执行 memory-grounded reasoning / synthesis，可请求
  `based_on` facts。它是 internal memory workflow target，不是默认 user-facing final answer
  owner。
- operation status：async retain 的 `accepted` 只代表 Hindsight 接受后台处理；
  graph materialization 必须由 operation status 或后续 recall/reflect evidence 证明。
- operation lifecycle：list/status/cancel/retry 是 internal operator/runtime 能力；
  execution-control/internal 与 operator diagnostics 可保留 repo-owned operation
  ref、status、kind、count、hash/shape；student browser-facing response 与
  model-visible context 不得暴露 operation id/ref、runtime document ref、raw bank id、
  raw result metadata shape 或 Hindsight payload。
- memory bank：bank id 由 execution-control 从 product tenant/user 派生；browser、
  app-api projection 与 model context 均不得看到 raw Hindsight bank id。
- temporal semantics：completed-turn retain 必须携带用户 turn 发生时间；explicit
  profile retain 必须携带 profile update time；execution-control 生成的 recall 请求必须携带
  `query_timestamp`。Hindsight 返回的 recall / reflect fact 即使没有
  `occurred_start`、`occurred_end` 或 `mentioned_at` 也可以进入 bounded context，
  此时 `updated_at` 为空。
- memory bank bootstrap：每次 retain/recall/reflect/operation 查询或 profile item
  删除前，execution-control 必须用 Hindsight bank API 创建或更新 scoped bank，再通过
  bank config API 确认 Memory Defense 已启用 `sensitive_data -> redact`。config
  未生效时 fail closed，不执行后续 memory operation。`owner:disable` 不为删除目的创建 bank。

当前 execution-control 已接入：

- completed-turn async retain，并把 Hindsight operation id 投影为
  internal `operation_status_ref`。
- `MemoryOperationStatusActivity` 与
  `/internal/memory/personal/operations:status`，用于查询 async retain 后台状态；
  operation status 查询显式请求 `include_payload=false`。
- `/internal/memory/personal/operations:list`、`operations:cancel` 与
  `operations:retry`，用于 internal/operator lifecycle 管理；这些 endpoint 不属于
  student-facing API，也不进入 model-visible tool set。
- `MemoryReflectActivity` 与 `/internal/memory/personal/graph:reflect`，用于内部
  memory-grounded reflection，并只写 sanitized text / structured output / based_on
  facts。
- recall 覆盖 `world`、`experience` 与 `observation` target type。
- `personal_memory.recall_limit` 在 Hindsight recall selection 后继续做
  execution-control bounded projection 限制。
- bank bootstrap 与 Memory Defense redaction 默认执行，并通过 config 回读验证。
- app-api student run-step projection 会剥离 Hindsight operation/document/bank refs；
  operator/internal ops path 保留必要诊断字段。

Runtime acceptance rules:

- completed-turn append 本身只能声称 `accepted`，不能声称 materialized。
- Hindsight live E2E 必须实际验证 operation status 或后续 recall / reflect 证明
  materialization；cancel/retry 因分别依赖 pending/failed operation 状态，只作为
  internal API smoke/unit 覆盖，不作为默认 release gate 的稳定 live case。

## Online Recall Flow

目标 online path：

```text
user request
-> app-api creates execution run without PG memory full injection
-> execution-control starts ToolExecutionWorkflow
-> Temporal context.memory_recall activity when context.memory.enabled=true
-> Hindsight recall scoped to actor bank
-> bounded memory context
-> OpenAI Agents primary loop / planning / RAG / deterministic tools
-> sanitized run step projection
```

`memory.recall` 是 neutral execution step，不属于 RAG worker 的私有前置逻辑；
当前 online path 在 `context.memory.enabled=true` 时先执行 bounded recall，再把结果作为
advisory instruction context 传给 primary agent。primary agent 不拥有 Hindsight tool，也不
先决定是否直连 Hindsight。gate 缺失或为 false 时不会 recall；因此不是每个 product
identity / no-tool direct answer 都必然先做 memory recall。

`context.memory.enabled` 是 recall gate。gate 缺失或为 false 时
`context.memory_recall` 必须投影为 skipped，不调用 Hindsight，也不向 primary agent /
RAG graph 传入 `memory_context` 或 `memory_ref`。gate 为 true 时才构造 Hindsight recall
request。recall query 由 `user_goal` 加确定性排序后的 confirmed `session_slots` 组成。

recall request 必须包含：

```text
run_id
tenant_id
user_id
user_goal
requested_tool
query_timestamp
session_slots
```

`query_timestamp` 必须来自 app-api accepted user message 的
`context.conversation.current_user_message.created_at`，不能在 execution-control 内用当前时间猜测。

Hindsight recall 参数由 execution-control 固定治理：

```text
budget = mid
trace = false
tags = scope:private
tags_match = all_strict
types = experience, observation, world
max_tokens = personal_memory.recall_max_tokens
result_limit = personal_memory.recall_limit
```

每次 recall 前 execution-control 必须通过 Hindsight bank create/update 语义确保
scoped bank 具备 student-assistant retain mission、custom retain instructions、
custom extraction mode，并关闭 observations。observations / memory influence tracing
不作为 v1 产品链路能力。

recall result 只投影 sanitized context：

```text
schema_version = memory_recall_result_v1
memory_ref
selected_memory_count
selected_memory_chars
memory_context_items[]
payload_sha256
```

每个 context item 只包含：

```text
memory_id
memory_type
tool
compact_text
score
updated_at
```

RAG / synthesis 可以消费 bounded memory context 来影响 follow-up、applicability、query
framing、answer defaults 和 wording。它不得用 memory 打开未开放 tool / collection、
放宽 source trust、覆盖 fail-close、伪造 account / session truth，或替代 institutional
evidence。

## Reflect Flow

`memory.reflect` 是目标 internal workflow target，用于需要 Hindsight agentic memory
reasoning 的场景，例如跨多轮偏好归纳、profile patch 候选生成、memory-grounded
personalization 解释，或 eval / diagnostic 中需要 `based_on` facts 的验证。

目标 flow：

```text
admitted internal memory-reflect request
-> Temporal MemoryReflectActivity
-> Hindsight reflect scoped to actor bank
-> sanitized reflection text / structured output
-> sanitized based_on memory refs when requested
-> run step or eval observation projection
```

固定规则：

- `memory.reflect` 不替代 `agent.primary` final answer owner；它只产出 bounded memory
  reasoning result。
- `reflect` trace / tool-call log / raw Hindsight payload 只能作为 debug input，不得进入
  canonical projection。
- `based_on` facts 可以进入 sanitized refs / hashes / compact fact snippets；不得保留
  raw chunks、raw transcript 或 private unrestricted notes。
- 如果未来让模型显式请求 memory reasoning，必须先通过 repo-owned typed tool /
  workflow admission 暴露，不能直接把 Hindsight vendor tool 注入 model-visible tool
  set。

## Productization Landing Rule

后续 memory / personalization productization 的落地顺序固定为：

1. `execution-control` / Temporal 拥有 online `memory.recall` step。
2. Hindsight runtime 承接 personal memory retrieval / extraction / graph
   storage；PG profile memory 只保留为 manual product projection /
   migration source。
3. `app-api` chat hot path 不读取 PG profile memory 并全量注入
   `context.profile_memory`。
4. planning / RAG / deterministic tools 只消费 bounded Hindsight personal
   memory recall packet；不得读取 raw memory、raw transcript、raw auth material
   或产品层数据库对象。
5. personalization 可以影响 follow-up、applicability、retrieval planning、ranking /
   disambiguation、clarification 与 answer wording；不得伪造 source truth、tool
   opening truth、account / session truth 或 fail-close override。

这些规则只定义恢复 productization 时的执行入口和验收口径，不表达 memory
productization rollout state。

## Write / Update Flow

### Completed Turn Append

completed run 后置写入走 Temporal `AppendConversationMemoryActivity`：

```text
finalization.write completed
-> memory.append
-> read sanitized execution payload and final answer projection
-> derive scoped Hindsight bank/document id from tenant + user + conversation
-> Hindsight retain completed turn document
-> sanitized memory.append step projection
```

`context.memory.enabled` 是自动写入 gate。gate 缺失或为 false 时必须跳过 append；不得通过
PG profile memory item 全量注入来推断 gate。

completed-turn append 对 Hindsight 使用 async retain，因此成功语义是 `accepted`，不是
`completed`。append 属于 final answer 后置 side-effect；Hindsight/config/request 失败不反向
失败最终回答，但必须写入 `memory.append` failed step projection 并进入 metrics。
auto append 默认只把用户消息作为 Hindsight extractable memory content；assistant answer
只作为 finalization projection，不进入 Hindsight graph extraction。显式 profile memory
仍由用户产品命令写入。

completed-turn retain item 必须带 `timestamp =
context.conversation.current_user_message.created_at`。显式 profile memory retain item
必须带 `timestamp = updated_at`。Hindsight async retain response 必须返回 operation id；
缺失 operation id 视为 append failure，不得把未追踪的 async side effect 标记为 accepted。
实现必须记录 async retain 返回的 operation ref，并通过单独 operation-status
activity、operation-status internal endpoint 或后续 recall / reflect evidence 证明后台
处理结果。operation ref 是 internal/operator runtime evidence，不是 browser-facing memory
id。

append projection 只记录：

```text
schema_version = memory_conversation_append_result_v1
status
thread_id
appended_message_count
operation_id
operation_status_ref
runtime_document_ref
payload_sha256
skip_reasons
failure_kind
```

不得在 projection、Temporal activity result 或 eval artifact 中保存 raw transcript、
provider raw response、tool raw payload、Hindsight raw payload 或 unrestricted notes。
Hindsight bank id、conversation document id、profile document id 与 async
operation id 属于 internal runtime ref，不得进入 browser-facing run-step/profile-memory
response 或 model-visible context；student-facing sanitized projection 只允许保留 product
`thread_id`、hash、count、status 和 bounded compact text。operator/internal diagnostics
可以保留 repo-owned operation/document refs，但不得携带 raw Hindsight payload。

operation id 可保存在 execution-control run metadata 的 `temporal_memory.append_operation`
中，用于 worker/internal 诊断。`/internal/memory/personal/operations:status` 只接受 worker
auth，按 tenant/user 派生 bank id，并以 Hindsight operations API 查询状态且 `include_payload=false`；
该 endpoint 不返回 Hindsight task payload、raw retain payload 或 transcript。

Memory activities 使用独立 Temporal activity policy：`StartToCloseTimeout` 来自
`personal_memory.timeout_seconds`，默认 90 秒；`HeartbeatTimeout` 为 30 秒；外部 Hindsight
I/O 前后必须 heartbeat。配置缺失、请求 invalid、projection invalid 等 deterministic
fail-close 类错误标记为 non-retryable；网络、429、5xx 等瞬时错误按 bounded retry 处理。

execution-control `/metrics` 暴露 personal memory 的 bounded-label 指标：

```text
campus_execution_control_personal_memory_operations_total{operation,outcome,failure_kind}
campus_execution_control_personal_memory_operation_duration_ms{operation}
campus_execution_control_personal_memory_selected_items_count{operation}
campus_execution_control_personal_memory_selected_chars_count{operation}
```

这些指标不得包含 user id、tenant id、run id、conversation id、memory id 或 raw text。

`/internal/memory/personal/turns:append`、`/internal/memory/personal/graph:recall`、
`/internal/memory/personal/operations:status`、`operations:list`、`operations:cancel`、
`operations:retry` 与 `/internal/memory/personal/graph:reflect` 只服务 internal
worker / runtime smoke。它们用于 Hindsight live gate 和 operator diagnostics 验证
append、operation status/list、recall、reflect 和 user isolation，不是 browser-facing
API，也不替代 Temporal production workflow。`operations:cancel` / `operations:retry`
的 live 成功依赖 Hindsight 当前是否存在 pending / failed operation，因此默认不作为
release gate 的稳定 materialization validation。

### Explicit Profile Memory

用户显式 profile memory 仍是 app-api 产品面，但 app-api 不知道 Hindsight API、Qdrant 或
embedding。

```text
POST /api/me/profile-memory/items
-> app-api validates product command
-> execution-control /internal/memory/personal/items:upsert
-> Hindsight retain profile document
-> execution-control returns episode_uuid
-> app-api stores episode_uuid in PG projection
```

删除 item：

```text
DELETE /api/me/profile-memory/items/:id
-> app-api loads runtime_episode_uuid from PG projection
-> execution-control /internal/memory/personal/items:disable
-> Hindsight document delete
-> app-api marks PG projection disabled
```

Owner disable / RTBF：

```text
profile memory owner disable
-> execution-control /internal/memory/personal/owner:disable
-> Hindsight bank delete
-> app-api projection follows product retention policy
```

`episode_uuid` 是 runtime/internal ref。当前 Hindsight profile memory 使用
`profile:<memory_id>` document id 作为该 ref。它可以存在 PG projection 和 internal
command payload；
不得暴露给 browser-facing profile-memory item response。

## Runtime Acceptance Boundary

repo-owned memory evidence taxonomy / score profile 是
`hindsight-memory-product-path`，不是 `personal-memory-extraction`。该 profile
用于 Langfuse-bound sanitized score publishing 与 historical eval map naming。

live runtime gate、deployment smoke command、required environment 和 coverage list 归
`docs/runbooks/execution-smoke.md`。本文只冻结 memory runtime 边界和 sanitized
projection 规则，不拥有可执行验收步骤。

agent runtime eval projection 只可从 `memory.recall` / `memory.reflect` step result
派生 sanitized memory summary，例如 recall / reflect status、selected count、selected chars
和 based-on fact count。它不得输出 Hindsight bank id、operation id/ref、runtime document
ref、memory id、raw memory text、raw reflection text 或 compact text。Langfuse-bound
memory evidence 当前通过 trace evidence verification 与 Ragas score lanes 承接；不得恢复
retired profile score report builder，也不能为缺失 request correlation 的 case 猜 trace id。

## Data-Plane Boundary

Hindsight posture：

- personal memory graph storage / extraction / dedupe / merge / retain /
  recall / reflect / operation lifecycle 由 Hindsight 承担。
- execution-control 通过官方 Go SDK 消费 Hindsight HTTP API，不把 Hindsight SDK 类型泄漏进
  `packages/contracts`。
- staging / local compose 默认使用内网 `http://hindsight-api:8888`；只有外接
  Hindsight endpoint 时才需要覆盖 URL，外部 endpoint 必须使用 HTTPS。
- `PERSONAL_MEMORY_API_SECRET` 只注入需要 personal memory 的 execution-control
  runtime role：`execution-control` 与 `activity-core`。local / staging lifecycle
  负责生成并持久化该值。
- `PERSONAL_MEMORY_BASE_URL`、`PERSONAL_MEMORY_API_SECRET` 与
  `PERSONAL_MEMORY_OWNER_SALT` 是 deployment projection，不是开发者手工配置项；
  `runtime`、timeout、recall token budget 与 context char budget 由
  execution-control runtime profile 管理。
- Hindsight LLM / embedding provider env 来自本地 provider projection artifact 中的
  `hindsight_llm` 与 `hindsight_embedding`；不得从 root `LLM_*` / `EMBEDDING_*`
  serving fallback 隐式继承，也不得在热路径回读 app-api。
- Hindsight 官方 OpenAI Agents integration 提供 direct tools / memory instructions，MCP
  server 也可以让模型直接读写 memory。`campus-agent` 只采纳 bounded memory
  instructions 形态，不采纳 direct Hindsight tools / MCP exposure：Hindsight API
  credential、bank id、document id、retain / recall tool surface 与 raw payload 不进入
  model-visible tool catalog、browser response、app-api 或 `packages/contracts`。
  如果 Hindsight deployment 暴露 MCP endpoint，它必须停留在 service 内网 / ops-only
  debug boundary，不得被 app-api、campus-web、agent-runtime 或 OpenAI Agents SDK 注册为工具。
- `activity-agent` / `activity-knowledge` 不要求 Hindsight 配置；它们消费的是
  bounded memory context，不拥有 memory substrate。

Qdrant posture：

- Qdrant 只承载 institutional RAG / retrieval data plane。
- Qdrant personal memory collection、`personal_memory_v1`、personal memory
  embedding role 和 Qdrant personal memory schema install/check 已退休。

## Not This

Memory Plane 不是：

- Qdrant-backed personal memory collection。
- repo-owned memory extraction prompt / threshold / provider compare harness。
- Temporal-backed memory database。
- compliance-style full audit system。
- hidden agent self-editing memory。
- app-api 每次 chat 读取 PG profile memory 并全量注入。
- 把个人 memory 写进 institutional Qdrant index。

## Guardrails

- Do not reintroduce PG all-memory injection into chat submit.
- Do not make app-api call Hindsight API or private vector store directly.
- Do not expose Hindsight MCP or direct Hindsight tools in the primary agent
  model-visible tool catalog.
- Do not reintroduce `personal_memory_extraction` or `personal_memory_embedding`.
- Do not let RAG / provider adapters write long-term memory inline during answer
  synthesis.
- Do not store raw transcript as personal memory compact text.
- Do not use memory as authorization truth, tool-opening truth, source truth,
  or fail-close override.
- Do not require panel/eval memory influence tracing as v1 acceptance.
- Do not claim async retain materialization until operation status or later
  recall / reflect evidence proves it.
- Do not expose Hindsight Memory Defense config, raw bank id, raw operation
  metadata, operation/document refs or vendor payload through browser/model-facing
  projection.

## Official References

- Hindsight OpenAI Agents integration:
  <https://hindsight.vectorize.io/sdks/integrations/openai-agents>
- Hindsight retain / recall / reflect / operations / memory banks:
  <https://hindsight.vectorize.io/developer/api/retain>,
  <https://hindsight.vectorize.io/developer/api/recall>,
  <https://hindsight.vectorize.io/developer/api/reflect>,
  <https://hindsight.vectorize.io/developer/api/operations>,
  <https://hindsight.vectorize.io/developer/api/memory-banks>
- Hindsight Memory Defense:
  <https://hindsight.vectorize.io/developer/memory-defense>
- Temporal Go workflow / activity boundary:
  <https://docs.temporal.io/develop/go/workflows/basics>,
  <https://docs.temporal.io/develop/go/activities/basics>
- OpenAI Agents SDK and tool wiring:
  <https://developers.openai.com/api/docs/guides/agents>,
  <https://developers.openai.com/api/docs/guides/tools#usage-in-the-agents-sdk>
