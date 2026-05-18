---
doc_type: roadmap
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Service Info Denominator Realism

## Phase Status

- [x] **Phase 0: Contract And Source Evidence** - Record required/optional denominator semantics and
  the targeted public source facts.
- [x] **Phase 1: Core Schema And Report Gate** - Update official-web config models, validation and
  target inventory report readiness.
- [x] **Phase 2: Ingestion Release Gate** - Update consumer candidate review, selected-write task
  admission and release execution readiness.
- [x] **Phase 3: Operator Projection And Verification** - Project optional metadata through app-api
  and panel, then run targeted verification.

## Close Rule

Close only when tests prove required evidence still blocks release, optional absent evidence becomes
`source_not_provided`, and selected-write release can carry that contract without broad crawl or
manual approval.
