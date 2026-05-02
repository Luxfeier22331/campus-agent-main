---
doc_type: design
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Eval Acceptance Matrix

## Purpose

Eval gates prove that the collected source pack is consumable by downstream tools and retrieval
surfaces without query-time web fetch or unsupported source inference.

## Required Eval Families

### Tool Routing

Representative questions must route to the intended owner surface:

- campus card loss/replacement -> `service_guide_lookup`
- VPN usage -> `service_guide_lookup`
- campus network authentication -> `service_guide_lookup`
- information disclosure office contact -> `contact_directory_lookup`
- information disclosure scope -> `official_web/stable_reference` or `regulations/*`
- fee table source question -> `official_web/stable_reference`

### Source Grounding

Answers must include source references and avoid unsupported facts:

- do not invent office hours when source does not provide them
- do not infer missing email or department responsibility
- do not answer fee row values unless table row alignment is preserved
- do not flatten policy source into a service procedure answer

### Fail-Close

Excluded or deferred questions must fail closed:

- latest news
- recruitment/procurement/event queries
- library dynamic-shell rules if still excluded
- transactional actions such as submitting applications or booking rooms
- arbitrary department phone directory beyond admitted contact rows

### Multi-Page Composition

Information disclosure evals must verify:

- application process answer cites procedure source
- application form answer cites material source
- office contact answer cites contact source
- disclosure scope answer cites policy source
- composed guide answer preserves component provenance

### Release Preview

Release preview evals must verify:

- no-promotion preview shows intended writes before current-truth mutation
- blocked rows expose machine-checkable blocker reasons
- ready rows include source refs and target release class
- repeated preview from the same source-truth bundle is deterministic

## Acceptance Rule

A source-pack row is not release-ready unless both replay gate and eval gate pass for its owner
surface. Rows that fail deterministic gates should remain `blocked`, `deferred` or `inventory_only`
instead of requiring normal-path human approval.
