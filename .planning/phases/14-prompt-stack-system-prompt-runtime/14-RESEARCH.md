# Phase 14 Research: 产品主链路 Prompt Stack 与 System Prompt Runtime 收口

## External Findings

1. **Instruction hierarchy must be enforced structurally, not narratively**
   OpenAI Model Spec formalizes a hierarchy across higher-priority instructions and explicitly says to ignore untrusted data by default. For this repo, that means user text and retrieved evidence cannot be concatenated into the same trusted instruction zone as developer invariants or role prompts.

2. **Developer instructions should stay thin and high-priority**
   OpenAI prompt engineering guidance recommends putting instructions first and separating instructions from context clearly. This supports the repo’s existing direction: keep repo-global developer invariants thin, then pass task/evidence as typed lower-priority packets instead of building one mega prompt.

3. **Stable prompt assembly should also optimize for repeatability and cacheability**
   OpenAI prompt engineering guidance recommends pinning production applications to specific model snapshots and keeping repeated prompt content near the beginning of the request so prompt caching can work effectively. For this repo, that means Phase 14 should not stop at “which provider/model family”; it should freeze exact model snapshot handling and keep repo-global invariants in a stable front-loaded assembly order.

4. **Agent safety depends on layered controls, not a single system prompt**
   OpenAI’s agent safety guidance emphasizes tool permission boundaries, explicit handling of untrusted inputs, monitoring, evals, and human review. This matches the repo’s code-first architecture: the prompt stack should improve wording and reasoning, but policy/scope/authz/serving truth must remain code-owned.

5. **Structured outputs should be schema-enforced, not prompt-enforced**
   OpenAI structured outputs guidance recommends strict schema mode when exact output shapes matter. This directly supports moving supervisor/rag prompt execution from “typed interface + fake executor in tests” to provider-backed strict outputs in the product path.

6. **Structured output success and refusal are different runtime states**
   OpenAI’s structured outputs guide explicitly calls out that a refusal does not follow the supplied schema and must be handled through a separate `refusal` branch; incomplete/content-filtered generations must also be handled explicitly. For this repo, Phase 14 executor design must treat `schema-valid success`, `refusal`, and `incomplete/filtered` as separate code-owned outcomes.

7. **Representative evals are part of the runtime design, not post-hoc QA**
   OpenAI eval guidance stresses building representative evals tied to release decisions. For this repo, prompt stack work is incomplete until trusted-vs-untrusted zoning, prompt metadata projection, deterministic-path protection, and schema-failure behavior are all regression-tested.

8. **Prompt/version identity is a real runtime concern even when prompt ownership stays in code**
   OpenAI’s prompt engineering guide now documents reusable prompt IDs plus explicit prompt versions. This does not mean the repo should move prompt ownership into the dashboard, but it does reinforce that `prompt_id` / `prompt_version` are product-path runtime identifiers rather than diagnostics-only extras.

## Repo Implications

### 1. “System prompt” should stop being the runtime unit

The correct runtime unit for this repo is:

- repo-global developer invariants
- package-owned role prompt
- typed trusted task packet
- typed untrusted user/evidence packet
- strict structured output
- code-side finalization

This matches both the current architecture docs and OpenAI’s instruction hierarchy guidance better than any monolithic prompt.

### 2. `apps/supervisor-api` is the correct runtime assembly owner

Current code already keeps prompt ownership in packages and transport in apps. Therefore:

- `packages/supervisor-core` and `packages/rag-specialist` should keep owning prompt families and packet builders
- `apps/supervisor-api` should own provider binding, prompt assembly, and execution admission
- `apps/app-api` should only consume the resulting observability-safe metadata

This preserves accepted topology and avoids adding a new app-owned prompt-authoring seam.

### 3. Provider-backed execution must preserve trusted vs untrusted zoning

The provider adapter must make it impossible, by construction, to:

- inject user text into developer instructions
- inject retrieval evidence into developer instructions
- let freeform provider text bypass strict output validation

The repo should therefore prefer a shared prompt runtime assembler/executor that takes typed inputs and emits validated typed outputs plus `PromptTrace`.

### 4. Provider-backed execution must distinguish valid structured success from refusal/incomplete

OpenAI structured outputs guidance materially changes one implementation detail: a returned response is not automatically a valid structured result.

The runtime must distinguish at least:

- schema-valid completed output
- explicit model refusal
- incomplete or content-filtered output
- invalid trace / invalid schema parse

Only the first state may enter package-owned terminal response assembly. The rest must stay explicit code-owned fallback or fail-closed branches.

### 5. Prompt metadata must become product-path truth

The repo already has:

- `PromptTrace`
- `prompt_id`
- `prompt_version`
- `template_sha256`
- `model_provider`
- `model_name`

But these are not yet consistently projected through `apps/app-api` request observability. That is now a correctness gap, not a convenience gap, because operator/eval truth cannot distinguish prompt rollout state without it.

### 6. Deterministic protected paths must remain explicitly stronger than promptified paths

The prompt runtime should be admitted only where the repo already expects wording variability:

- supervisor clarify / approval_required / reject / out_of_scope
- rag clarify / unsupported / generic no-answer
- generic grounded answer branches that already pass grounding validation

It must not silently replace deterministic-first branches such as:

- high-structure curriculum answers
- handbook `procedure / materials / time` protected paths

## Recommended Phase Breakdown

### Plan 14-01

Freeze prompt stack assembly and ownership:

- formalize repo-global developer invariants as a runtime-owned thin layer
- define typed trusted/untrusted zoning contract
- add runtime assembly helpers and product-path config seam in `apps/supervisor-api`
- freeze pinned model snapshot / exact model identity handling in runtime config
- keep repeated developer invariants and role prompt content in a stable front-loaded order for prompt caching and latency predictability

### Plan 14-02

Land provider-backed strict prompt execution:

- add shared provider-backed executor contract
- wire supervisor and rag prompt families through strict structured outputs
- emit validated `PromptTrace` with provider/model/template metadata
- treat `schema-valid success`, `refusal`, and `incomplete/filtered` as separate runtime outcomes

### Plan 14-03

Close verification and observability:

- add regression coverage for zoning, schema failures, prompt metadata, and deterministic-path protection
- add explicit regression coverage for refusal/incomplete structured-output branches
- project prompt metadata into app observability-safe truth
- update hardening docs so future work cannot drift back to ad hoc prompt assembly

## Recommended Non-Goals

- no prompt-first orchestration
- no app-owned ad hoc prompt templates outside package-owned registries
- no dashboard-owned prompt truth replacing repo-owned prompt registries
- no raw prompt or raw transcript exposure in operator sinks
- no broadening prompt runtime into deterministic protected branches

## External References

- OpenAI Model Spec: https://model-spec.openai.com/2025-09-12.html
- OpenAI Agent Safety: https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Prompt Engineering: https://developers.openai.com/api/docs/guides/prompt-engineering
- OpenAI Evals: https://developers.openai.com/api/docs/guides/evals
