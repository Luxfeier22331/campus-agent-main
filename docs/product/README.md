---
doc_type: index
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-18
updated: 2026-06-23
---

# Product Requirements

`docs/product/` owns feature-level product requirements and launch-facing user
experience requirements.

It does not own product positioning, current merged truth, target architecture,
HTTP contracts, data schemas, operational procedures or active work status.

## Active PRDs

- [account-registration-legal-consent-prd.md](./account-registration-legal-consent-prd.md)
  - registration terms/privacy consent, legal pages and sign-up admission
- [conversation-attachment-upload-prd.md](./conversation-attachment-upload-prd.md)
  - proposed conversation attachment upload, per-message image/document context,
    storage boundary and fail-closed semantics
- [langfuse-eval-platform-completion-prd.md](./langfuse-eval-platform-completion-prd.md)
  - Langfuse eval platform completion for trace evidence, score publishing,
    datasets, experiments and RAG parameter evals
- [multi-turn-context-and-rag-followup-prd.md](./multi-turn-context-and-rag-followup-prd.md)
  - run context envelope, RAG follow-up resolution, previous evidence proof
    reuse and context-quality evals
- [observability-orchestration-repair-prd.md](./observability-orchestration-repair-prd.md)
  - observability orchestration repair across OTel Collector, Sentry, Axiom,
    Temporal, Langfuse and operator projections

## Use Rules

- Product boundary and non-promises remain in
  [`docs/architecture/product.md`](../architecture/product.md).

- Current accepted implementation truth remains in
  [`docs/architecture/current.md`](../architecture/current.md).
- Runtime/API wire shape remains in [`docs/contracts/`](../contracts/).
- A PRD may state user-facing behavior and acceptance criteria, but it must not
  redefine architecture owners, data schemas or deployment runbooks.
