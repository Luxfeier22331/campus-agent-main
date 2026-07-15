---
doc_type: runbook
truth_scope: eval
owner_boundary: retrieval-serving
status: active
created: 2026-04-23
updated: 2026-07-13
---
# RAG Release

## Boundary

Use this runbook only when preparing a retrieval or Knowledge Agent change for
release. Normal implementation work uses affected local tests and does not run
external Langfuse/Ragas scoring by default.

## Required Evidence

1. The target exists in `query-serving-targets.v1.json` and its referenced
   serving config validates.
1. Contract, execution-control and agent-runtime tests pass.
1. The relevant Langfuse dataset contains reviewed cases for changed behavior.
1. The real product eval run produces answers, retrieved contexts, tool
   trajectory and trace identity.
1. Registered Ragas RAG and agent/tool scores are reviewed against the previous
   accepted release or experiment run.
1. Hard negatives, no-answer and cross-target cases show no new unsupported
   claims or evidence-integrity failures.

## Procedure

1. Run `pnpm ci:contracts`, `pnpm go:check` and `pnpm ci:eval`.
1. Build and dry-run dataset sync using `eval-ragas.md`.
1. Run `agent-eval --validate-only` for the changed dataset against the real
   product path, then publish when the target project and samples are correct.
   This one command links the product trace to the dataset run and computes
   applicable Agent, RAG and deterministic scores.
1. Use `ragas-score-dataset` only when an already materialized dataset run must
   be rescored without executing the product request again.
1. Compare score distributions and inspect failed cases in Langfuse rather than
   producing a repo-owned gate report.

Ragas scores are review evidence, not an automatic release verdict. Contract or
evidence-integrity failures remain hard failures in owning runtime tests.
