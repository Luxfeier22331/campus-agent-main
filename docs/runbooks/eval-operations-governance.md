---
doc_type: runbook
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-04-29
updated: 2026-07-04
---
# Eval Operations Governance

This runbook covers active Langfuse/Ragas eval operations. It does not author
domain truth, define product release gates, or keep profile-gate policy files
alive.

## Source Of Truth

- Active eval shape: `docs/reference/eval.md`
- Active eval lanes: `docs/reference/eval-map.md`
- Golden truth model: `docs/reference/eval-gold-truth-model.md`

New operational checks must be implemented in `packages/eval-langfuse` or the
owning runtime before they become active.

## Active Operations

Current internal eval lanes are:

- `ragas-trace`
- `ragas-dataset`

Both lanes must use safe projections from Langfuse traces or datasets, execute
upstream Ragas through `packages/ragas-runner`, and publish `ragas.*` scores
through `packages/eval-langfuse`.

## Learning-Loop Candidate Operations

候选选择、发布 payload 和发布后核验路径由以下命令覆盖：

```bash
pnpm --dir jobs/learning-loop-candidates test
pnpm --dir jobs/learning-loop-candidates typecheck
pnpm --dir packages/eval-langfuse test
pnpm --dir packages/eval-langfuse typecheck
```

真实 Langfuse 项目中的发布后核验命令为：

```bash
APP_API_DB_URL=<app-api projection database> \
LANGFUSE_BASE_URL=<langfuse base url> \
LANGFUSE_PUBLIC_KEY=<project public key> \
LANGFUSE_SECRET_KEY=<project secret key> \
pnpm --dir jobs/learning-loop-candidates exec tsx ./src/cli.ts verify-published-candidates \
  --since <ISO timestamp> \
  --limit <N> \
  --json
```

该命令不是在线回答链路的一部分。它只证明 learning-loop candidate 已经进入
Langfuse dataset，可供 annotation / dataset / eval 工作流消费。

## Supporting Surface Commands

Learning-loop candidate selector:

```bash
pnpm --dir jobs/learning-loop-candidates exec tsx ./src/cli.ts \
  select-candidates --since <ISO> --limit <N> --json
```

Learning-loop candidate publisher:

```bash
pnpm --dir jobs/learning-loop-candidates exec tsx ./src/cli.ts \
  publish-candidates --since <ISO> --limit <N> --dry-run
```

Langfuse score config sync:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts sync-score-configs
```

Langfuse dataset sync:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts sync-datasets
```

RAG dataset manifest builder:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts build-rag-dataset-manifest
```

Runtime trace evidence verifier:

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace
```

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
pnpm --dir packages/eval-langfuse exec tsx src/cli.ts audit --json
```

The audit checks workflow dispatch choices, Langfuse publish contract, blocked
self-built eval package references, blocked CLI commands, score registry shape
and active eval-map expectations.

## Operator Projection

Operator observability does not mirror Langfuse/Ragas scoring state into
app-api tables.

Operator-facing eval evidence should stay in Langfuse datasets, runs, scores and
annotation queues. App-api does not expose runtime quality badcases, negative
feedback candidates, eval scoring or coverage truth as the
current Operator Console surface.
