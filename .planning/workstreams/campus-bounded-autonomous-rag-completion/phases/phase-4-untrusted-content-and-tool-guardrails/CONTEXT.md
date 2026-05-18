---
doc_type: phase_context
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Context: Untrusted Content And Tool Guardrails

## Goal

Prevent retrieved or projected content from becoming instructions, tool policy or routing policy.

## Starting Truth

- Retrieved chunks, source HTML, OCR text, notice body and projection summaries are untrusted data.
- Supervisor owns allowed tools and routing policy.
- RAG synthesis can use source text as evidence, but source text cannot override higher-priority
  instructions.

## Required Decisions

- Where instruction quarantine is encoded: prompt assembly, tool boundary, output guardrail or all
  of them.
- Which malicious source patterns become regression fixtures.
- How tool argument policy rejects source-requested exfiltration or arbitrary fetch behavior.

## Out Of Scope

- General content moderation lane unless separately triggered.
- State-changing tool approval / HITL.
- Arbitrary browsing sandbox.
