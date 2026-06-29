---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-04-29
updated: 2026-06-28
---
# Eval Operations Governance

This runbook covers active Langfuse/Ragas eval operations. It does not author
domain truth, define product release gates, or keep legacy profile-gate policy
files alive.

## Source Of Truth

- Active eval shape: `docs/reference/eval.md`
- Active workflow lanes: `docs/reference/eval-map.md`
- Golden truth model: `docs/reference/eval-gold-truth-model.md`

The retired Python/profile-gate policy files are deleted. New operational
checks must be implemented in `packages/eval-langfuse` or the owning runtime
before they become active.

## Active Operations

Current workflow-dispatchable lanes are:

- `ragas-trace`
- `ragas-dataset`

Both lanes must use safe projections from Langfuse traces or datasets, execute
upstream Ragas through `packages/ragas-runner`, and publish `ragas.*` scores
through `packages/eval-langfuse`.

## Release Posture

Langfuse/Ragas scores are evaluation evidence and review input. They are not a
standalone repo-owned release gate.

Release closeout remains owned by product/runtime contracts, staging E2E
runbooks and the relevant app/package test lanes. A low Ragas score can mark
operator coverage as `attention`; it must not silently become a hard release
blocker without an explicit current contract.

## Required Evidence

Each active eval operation must record:

- selected Langfuse trace or dataset source
- source git head
- eval run id
- Ragas metric names
- scored denominator
- omitted denominator and omission reasons
- published / failed / validate-only status

Score metadata must stay on the allowlist enforced by
`packages/eval-langfuse/src/score-publisher.ts`; raw prompt, raw transcript,
raw answer, provider raw response, source body, secrets and local paths are not
allowed in published metadata.

## Audit

Before relying on eval evidence for release closeout, run:

```bash
uv run --all-packages python -m scripts.langfuse_eval_audit audit --json
```

The audit checks workflow dispatch choices, Langfuse publish contract, retired
self-built eval package references, retired CLI commands, score registry shape
and active eval-map expectations.

## Operator Projection

The former app-api eval coverage and low-score diagnostic projections are
retired. Operator observability no longer mirrors Langfuse/Ragas scoring state
into app-api tables.

Operator-facing eval evidence should stay in Langfuse datasets, runs, scores and
annotation queues. App-api may still expose runtime quality badcases, negative
feedback candidates and trace backlinks, but it does not own eval scoring or
coverage truth.
