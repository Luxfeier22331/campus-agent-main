---
doc_type: design
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# SDK Primitive Mapping: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Mapping Rule

OpenAI Agents SDK is the Python provider-facing semantic runtime substrate. Repo-owned contracts
remain the canonical policy and projection truth.

## Repo Mode To SDK Primitive

### Go `single_step`

Repo truth:

- Go admits target agent, allowed tools, budget and fail-close policy.
- Bridge carries `AgentRequest`.

SDK primitive:

- Python builds one SDK `Agent`.
- Python compiles Go-admitted ToolSpec tools into SDK `FunctionTool`.
- Python calls SDK `Runner`.

Not SDK-owned:

- target selection
- allowed tool selection
- source-trust
- final public `SupervisorResponse`

### Go Manager-Style `multi_step`

Repo truth:

- Go admits ordered `WorkflowPlan`.
- Go owns step order, allowed agents/tools, projection requirements and finalization.

SDK primitive:

- Python may use sequential SDK `Runner` calls for admitted steps.
- Python may expose a specialist as agents-as-tools only when Go plan keeps manager answer
  ownership and admits that specialist call.

Not SDK-owned:

- cross-agent route order
- step budget
- projection requirement
- final answer ownership

### Ownership-Transfer Handoff

Repo truth:

- Go plan must explicitly admit specialist ownership transfer.

SDK primitive:

- SDK handoff is allowed only for the admitted ownership-transfer segment.

Not SDK-owned:

- deciding that ownership transfer is allowed
- expanding available tools after handoff

### Repo-Owned Query / Retrieval / Projection

Repo truth:

- ToolSpec names tool, owner, payload schema, result schema, runtime posture and read-only policy.
- Query service / retrieval core / projection service execute the bounded work.

SDK primitive:

- SDK `FunctionTool` invokes repo-owned executor.
- Function output is sanitized bounded projection.

Not SDK-owned:

- raw SQL
- object store reads
- index build
- collector / ingestion writes
- general web fallback

## RAG Boundary

SDK-owned:

- answer drafting / synthesis model turn
- structured output type
- internal `retrieve_evidence` function tool invocation loop
- output guardrail integration

Repo-owned:

- scope and runtime profile admission
- retrieval planning
- retrieval execution
- evidence selection
- grounding validation
- no-support / insufficient evidence fail-close
- release and serving alias truth

## Tool Surfaces

`structured_handoff`:

- visible to Go planner as admitted handoff tool
- compiled to SDK `FunctionTool` only after Go allows it for the target agent

`agent_internal`:

- not visible as Go preplanned structured handoff tool
- can be compiled to SDK `FunctionTool` only inside the owning agent runtime

## Trace Policy

SDK trace may be used internally. Exported truth must be repo-owned sanitized projection:

- selected target
- selected tool
- tool call count
- tool execution count
- argument key names only
- result/failure class
- model response reference when safe
- latency and cost summaries when available

Never export:

- raw prompt
- raw transcript
- raw provider response
- raw tool result
- raw source body
- SDK-native run graph object
- trace URL

## Official References

- <https://openai.github.io/openai-agents-python/agents/>
- <https://openai.github.io/openai-agents-python/tools/>
- <https://openai.github.io/openai-agents-python/handoffs/>
- <https://openai.github.io/openai-agents-python/running_agents/>
- <https://openai.github.io/openai-agents-python/tracing/>
