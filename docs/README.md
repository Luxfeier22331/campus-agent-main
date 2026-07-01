---
doc_type: index
truth_scope: repository
owner_boundary: docs
status: active
created: 2026-03-22
updated: 2026-06-30
---

# Docs

`docs/` is the long-lived documentation surface for `campus-agent`.

The repository uses a Source-of-Truth documentation architecture. Read
`documentation-architecture.md` first when a question depends on which document
class owns a fact.

## Question Routing

- Product boundary, users and non-promises:
  - [architecture/product.md](./architecture/product.md)
- Feature-level product requirements:
  - [product/README.md](./product/README.md)
  - [product/legal-consent.md](./product/legal-consent.md)
  - [product/attachments.md](./product/attachments.md)
  - [product/langfuse-evals.md](./product/langfuse-evals.md)
  - [product/run-context.md](./product/run-context.md)
  - [product/operator-diagnosis.md](./product/operator-diagnosis.md)
- Current accepted merged truth:
  - [architecture/current.md](./architecture/current.md)
- Long-term architecture invariants:
  - [architecture/target.md](./architecture/target.md)
- Documentation truth classes and conflict resolution:
  - [documentation-architecture.md](./documentation-architecture.md)
- Main question-answer chain semantics:
  - [architecture/system/execution-agent-layer.md](./architecture/system/execution-agent-layer.md)
  - [architecture/system/tool-routing.md](./architecture/system/tool-routing.md)
  - [contracts/app-api/chat.md](./contracts/app-api/chat.md)
  - [architecture/current.md](./architecture/current.md)
- Durable execution, Temporal, run/event/step projection, resume and cancel:
  - [architecture/system/durable-runtime.md](./architecture/system/durable-runtime.md)
  - [contracts/durable-runtime.md](./contracts/durable-runtime.md)
- Langfuse LLM observability and eval platform:
  - [product/langfuse-evals.md](./product/langfuse-evals.md)
  - [architecture/system/langfuse.md](./architecture/system/langfuse.md)
  - [contracts/langfuse-runtime.md](./contracts/langfuse-runtime.md)
  - [decisions/adr-0061-eval-runtime.md](./decisions/adr-0061-eval-runtime.md)
  - [decisions/adr-0062-ragas-langfuse.md](./decisions/adr-0062-ragas-langfuse.md)
  - [reference/eval.md](./reference/eval.md)
  - [reference/eval-map.md](./reference/eval-map.md)
  - [runbooks/eval-ragas.md](./runbooks/eval-ragas.md)
- Kubernetes execution-control runtime and KEDA/HPA worker autoscaling target:
  - [architecture/system/k8s-runtime.md](./architecture/system/k8s-runtime.md)
- Tool or domain readiness:
  - [architecture/domains/README.md](./architecture/domains/README.md)
  - [contracts/README.md](./contracts/README.md)
- Campus shuttle timetable capability:
  - [domains/transport.md](./domains/transport.md)
- Authenticated notice / internal notice document routing:
  - [architecture/domains/authenticated-notice/architecture.md](./architecture/domains/authenticated-notice/architecture.md)
  - [data/authenticated-notice.md](./data/authenticated-notice.md)
  - [contracts/campus-notice-runtime-contract.md](./contracts/campus-notice-runtime-contract.md)
- Data source truth, source-channel schema and read-model ownership:
  - [data/README.md](./data/README.md)
- Ingestion / collector / source-channel runtime shape:
  - [architecture/system/data-plane.md](./architecture/system/data-plane.md)
  - [decisions/adr-0054-ingestion-control-plane-and-kernel-boundary.md](./decisions/adr-0054-ingestion-control-plane-and-kernel-boundary.md)
  - [runbooks/ingestion-control-clean-target.md](./runbooks/ingestion-control-clean-target.md)
- HTTP/runtime wire contracts, DTOs and tool contracts:
  - [contracts/README.md](./contracts/README.md)
- ADR reasoning and supersession:
  - [decisions/README.md](./decisions/README.md)
- Deployment, staging, release, recovery or smoke procedure:
  - [runbooks/README.md](./runbooks/README.md)
  - [environment/README.md](./environment/README.md)
  - [policies/README.md](./policies/README.md)
- License, notices and third-party source attribution:
  - [../LICENSE](../LICENSE)
  - [../NOTICE](../NOTICE)
  - [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
  - [policies/public-source-data.md](./policies/public-source-data.md)
  - [reference/open-source-data.md](./reference/open-source-data.md)
- Current work map and backlog signals:
  - [../.planning/PROJECT.md](../.planning/PROJECT.md)
  - [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)
- Account center, identity product projection and federation boundary:
  - [architecture/system/identity-platform.md](./architecture/system/identity-platform.md)
  - [architecture/system/identity-browser.md](./architecture/system/identity-browser.md)
  - [architecture/system/mucwiki-login.md](./architecture/system/mucwiki-login.md)
  - [contracts/app-api/identity.md](./contracts/app-api/identity.md)
  - [contracts/app-api/federation.md](./contracts/app-api/federation.md)
  - [data/identity-platform.md](./data/identity-platform.md)
- campus-web docs reader, Rspress delivery and Q&A source-card jumps:
  - [architecture/system/document-site.md](./architecture/system/document-site.md)
  - [domains/source-card.md](./domains/source-card.md)
  - [contracts/app-api/document-reader.md](./contracts/app-api/document-reader.md)
  - [decisions/adr-0051-campus-docs-rspress-reader-surface.md](./decisions/adr-0051-campus-docs-rspress-reader-surface.md)
- Operator Console and dining map/menu/release operations:
  - [decisions/adr-0055-unified-operator-console-surface.md](./decisions/adr-0055-unified-operator-console-surface.md)
  - [architecture/system/operator-console.md](./architecture/system/operator-console.md)
  - [architecture/domains/dining/architecture.md](./architecture/domains/dining/architecture.md)
  - [contracts/app-api/operator-ops.md](./contracts/app-api/operator-ops.md)
  - [contracts/app-api/dining.md](./contracts/app-api/dining.md)
  - [contracts/app-api/dining-ops.md](./contracts/app-api/dining-ops.md)
  - [data/dining.md](./data/dining.md)

## Documentation Areas

- [architecture/README.md](./architecture/README.md)
  - product, current, target and supporting architecture entry
- [product/README.md](./product/README.md)
  - feature-level PRDs and launch-facing user experience requirements
- [architecture/system/README.md](./architecture/system/README.md)
  - cross-domain runtime, execution, retrieval, data and observability boundaries
- [architecture/domains/README.md](./architecture/domains/README.md)
  - domain / tool architecture boundaries
- [domains/README.md](./domains/README.md)
  - narrow human capability docs and direct owner routing
- [contracts/README.md](./contracts/README.md)
  - contract truth for HTTP, runtime and tool seams
- [data/README.md](./data/README.md)
  - data truth, source truth schemas and read-model ownership
- [decisions/README.md](./decisions/README.md)
  - ADR lifecycle and accepted decision reasoning
- [reference/README.md](./reference/README.md)
  - glossary, inventory, matrices, baselines and reference material
- [runbooks/README.md](./runbooks/README.md)
  - operational procedure and release/staging/smoke runbooks
- [environment/README.md](./environment/README.md)
  - env ownership, provider and secret inventory
- [policies/README.md](./policies/README.md)
  - governance rules, thresholds and collection-specific policies

## Non-Ownership Rules

- `.planning/` is a compact work map. It does not override architecture,
  contract, data or ADR truth.
- `runbooks/` define operational procedures and release evidence. They do not
  define whether the main answer chain is architecturally complete.
- Domain/tool docs define local readiness. They do not
  redefine main-chain completion.
- `current.md` describes accepted merged truth. It does not carry
  feature-branch progress or release closeout.
- `target.md` describes long-term invariants. It does not carry
  P0/P1/P2 status or current implementation progress.
- Reference material can support a discussion, but contracts, data schemas and
  architecture docs own current product/runtime/data truth.
- Historical planning material must be promoted into the correct active
  document class before it can be cited as current truth.

## Historical Material

Tracked planning archive trees have been removed from branch tip. Historical
planning material is recovered through git history. If a historical decision,
requirement or evidence reference is still needed, promote that specific fact
into the correct active document class instead of restoring the archive tree.
