---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Context: Bounded Agent Handoff And Tool Contract

## Goal

Make RAG handoff consume only bounded workflow context and repo-owned allowed tools.

## Starting Truth

- Supervisor-led workflow owns admission, allowed agents, allowed tools and finalization.
- Cross-agent context must flow through `AgentRequest.workflow_context` projection refs.
- RAG should not receive raw prompt transcript, raw provider trace, raw source body, OCR dump or
  object-store bytes.
- `retrieval.query` is an internal retrieval step / eval denominator, not a top-level public tool.

## Required Decisions

- Which projection kinds are admissible as RAG framing context?
- Which projection metadata is required before RAG can use context?
- Where should missing projection refs fail closed?
- Which tests should guard Go planner, Python bridge and contract schema drift?

## Out Of Scope

- Adding new product capabilities.
- Introducing provider-native agent graph semantics as repo truth.
- State-changing tools.
