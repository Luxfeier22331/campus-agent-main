---
doc_type: roadmap
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Tool-Driven Source Pack

## Overview

This workstream replaces collector-first expansion with tool-demand-first source admission planning
for the first official-web source pack.

The first pass is intentionally one-time and manifest-driven, but manifest implementation and
collection execution are owned by `official-web-source-pack-collection-execution`.

## Phase Status

- [x] **Phase 0: Workstream Creation And Boundary Freeze** - Create native workstream and freeze
  the one-time source pack boundary.
- [ ] **Phase 1: Source Content Assessment And Downstream Demand Matrix** - Confirm official-web
  content families, owner tools, user intents, expected facts, non-goals and fail-close behavior
  for the first official-web demand slice.
- [ ] **Phase 2: Execution Handoff** - Freeze accepted demand, proposed page set, composition
  requirements and eval expectations as input to
  `official-web-source-pack-collection-execution`.

## Implementation Dependency

1. Phase 1 freezes content families and demand before URL expansion.
2. Phase 2 hands off only accepted demand and content cases; it does not implement manifest,
   capture, replay or release.

## Phase Promotion Rule

- Do not hand off a URL without a downstream owner and user-intent row.
- Do not promote a form/download page as a standalone service guide unless it has required guide
  evidence.
- Do not promote a policy page through `service_guide_lookup`; policy pages must enter RAG /
  regulation-style serving, with service guide only consuming extracted service facts when needed.
- Do not use listing pages as answer-bearing evidence unless they independently satisfy an owner
  denominator.

## Close Rule

Close this workstream only after:

- first-slice downstream demand is frozen
- execution handoff to `official-web-source-pack-collection-execution` is explicit
- proposed URLs have owner surfaces, release family, expected facts and eval expectations
- multi-page composition requirements are source-linked at the demand level
