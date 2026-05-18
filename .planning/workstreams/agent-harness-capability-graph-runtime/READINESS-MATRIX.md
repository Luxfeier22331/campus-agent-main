---
doc_type: readiness_matrix
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Readiness Matrix: Agent Harness Capability Graph Runtime

## External Dependencies

| Dependency | Required Evidence | Owner / Source | Current Verdict | Runtime Impact |
|------------|-------------------|----------------|-----------------|----------------|
| `AgentSpec` registry | Agents declare status, allowed payloads and runtime posture. | `configs/runtime/agents.v1.json`; `supervisor-multi-agent-runtime-contract-hardening` | ready baseline, verify in Phase 1 | Blocks resolver implementation if drift guard fails. |
| `ToolSpec` registry | Tools declare payload/result schema, read-only posture, owner and eval denominator. | `configs/runtime/tools.v1.json`; `execution-tool-calling-governance` | ready baseline, needs artifact extension | Blocks artifact producer mapping. |
| Workflow artifact registry | Artifact ontology, current projection support status and raw-key guard. | `configs/runtime/workflow-artifacts.v1.json`; this workstream Phase 1 | ready baseline | Phase 2 must consume this as source vocabulary. |
| Workflow run store | Multi-step run persistence and step summaries. | `apps/supervisor-api/internal/execution` | ready baseline | Required before executable harness runtime opens. |
| Step output projections | Bounded projection envelope and trace summary. | `apps/supervisor-api/internal/execution`; `packages/contracts`; `packages/evals` | ready baseline | Required for artifact bundle truth. |
| Agents SDK step adapter | Step-local SDK runner, guardrails and trace sanitization. | `apps/supervisor-agent-worker`; `agents-sdk-domain-agent-adapter-promotion` | ready for selected read-only tools | Optional for first migration, required for SDK-backed steps. |
| RAG bounded context grounding | RAG can consume bounded upstream context and produce grounded result/fail-close. | `rag-agent-internal-agents-sdk-loop`; RAG suites | ready baseline | Required for notice follow-through and transport grounding. |
| Notice selected context | Internal selected notice resolution produces bounded context without top-level `campus_notice_get` provider reopening. | `notice-agent-card-first-tool-boundary`; notice runtime tests | ready baseline | Required for first migration. |
| Transport schedule read model | Schedule baseline and exceptions available through structured tool. | `campus-services-runtime-tool-gap-closeout` | ready baseline, refresh before expansion | Required for first expansion. |
| Notice change set | Recent notice override/change facts can be produced as bounded artifact. | authenticated notice architecture / governed pilot | pilot precedent exists, needs artifact contract | Required for first expansion. |
| Navigation place context | Place/stop context without owning timetable/status truth. | `navigation-agent`; navigation docs/tests | deferred for this workstream initial phases | Blocks service/location expansion only. |

## Internal Gates

| Gate | Owner Phase | Required Before | Evidence |
|------|-------------|-----------------|----------|
| Artifact ontology freeze | Phase 1 | Registry extension | `ARTIFACT-ONTOLOGY.md`, `workflow-artifacts.v1.json` and focused tests. |
| Registry producer/consumer matrix | Phase 2 | Resolver implementation | `CAPABILITY-GRAPH.md`, registry schema tests, `calendar_fact` normalization. |
| `CapabilityPlan` contract | Phase 3 | Resolver runtime | Go/Python contract tests and fixture snapshots. |
| Resolver fail-close matrix | Phase 4 | Any migration | Go structuredplanning/execution tests. |
| Step runner artifact validation | Phase 5 | Executable harness | Go/Python projection validation tests. |
| Harness eval denominator | Phase 9 | Workstream closeout | `packages/evals` workflow/artifact gate. |
| Selected notice migration | Phase 7 | Expansion admission | Existing behavior parity tests and live smoke when configured. |
| Transport expansion readiness | Phase 8 | Transport workflow opening | Tool/artifact/read-model evidence and public product gate. |

## Blocking Rules

- No new supervisor-level scenario may be admitted without artifact producer/consumer registration.
- No new step may execute if required artifacts are unresolved or produced by a closed owner.
- No final answer may use an artifact marked `answer_eligible=false`.
- No SDK-native trace or raw tool result may be used as artifact truth.
- No state-changing tool can enter this matrix.
