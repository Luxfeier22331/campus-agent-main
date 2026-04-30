---
doc_type: schema
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# State Schema

Implemented in:

`packages/ingestion-core/src/campus_ingestion_core/collected_notice_fact_state_contract.py`

Required payload fields:

- `schema_version`
- `target`
- `source_unit_state`
- `fact_readiness_state`
- `target_admission_state`
- `required_fact_groups`
- `ready_fact_groups`
- `missing_fact_groups`
- `reason_codes`
- `media_states`
- `blocking_media`
- `provenance`

Validation test:

`tests/ingestion/test_collected_notice_ingest_fact_state_contract.py`
