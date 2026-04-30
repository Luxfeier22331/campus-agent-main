---
doc_type: policy
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Idempotency Policy

State replay keys must include:

- source channel / surface / identity
- content hash
- target
- fact source hash when available
- OCR / owner-text output hash when available

The existing `notice_ingest` queue idempotency key remains the source enqueue guard.
This workstream adds target/fact-level idempotency semantics for replay artifacts and future materialization.
