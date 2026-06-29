---
doc_type: contract
truth_scope: eval
owner_boundary: docs/contracts
status: active
created: 2026-04-23
updated: 2026-06-29
---
# Eval Artifact Contract

This document keeps the historical eval artifact contract path alive while the
active eval runtime has moved to Langfuse/Ragas-first workflows.

Active eval truth is now split across:

- `docs/reference/eval.md`
- `docs/reference/eval-map.md`
- `docs/reference/eval-gold-truth-model.md`
- `docs/runbooks/eval-ragas.md`
- `docs/decisions/adr-0061-eval-runtime.md`
- `docs/decisions/adr-0062-ragas-langfuse.md`

Do not add new self-built run/repair/accept artifact contracts here. Active
evaluation flows should use Langfuse traces/datasets, official Langfuse
experiments or annotation queues, upstream Ragas through `packages/ragas-runner`,
and `packages/eval-langfuse` score publishing.

Retired artifact families include:

- Python `campus_evals` profile reports
- `scripts.eval_gate` run/repair/accept artifacts
- local release evidence builders/checkers
- generic score report publishers
- app-api eval coverage and diagnostic-badcase projection artifacts

Runtime-owner release evidence still belongs to the owning app/package tests,
staging E2E closeout and explicit product/runtime runbooks. This contract must
not become a replacement release-gate framework.
