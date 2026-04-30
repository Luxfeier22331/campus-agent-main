---
doc_type: contract
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Notice Ingest Fact State Machine

The state machine has four layers:

- `source_unit_state`: capture/queue/source/searchable readiness.
- `media_state`: OCR/multimodal lifecycle and media role.
- `fact_readiness_state`: readiness of target-required fact groups.
- `target_admission_state`: downstream replay decision.

The invariant is:

`target_admission_state` is derived from required fact readiness, not from whole-notice media status.

Pending media is target-blocking only when the media role carries a missing required fact group.

External workflow systems were reviewed only as design references. The repo implementation remains deterministic and internal:

- AWS Step Functions best practices emphasize explicit state and retry boundaries.
- Google Workflows retry guidance distinguishes retries and idempotent operations.
- Temporal durable execution guidance reinforces deterministic workflow logic.
- Enterprise Integration Patterns describes idempotent receivers for replay-safe queues.
