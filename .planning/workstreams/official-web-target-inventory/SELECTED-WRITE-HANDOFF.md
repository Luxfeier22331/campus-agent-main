---
doc_type: handoff
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Selected-Write Handoff

This workstream does not promote current read-model truth.

Future selected-write/release work may start only from inventory rows whose operator projection is
`ready_for_selected_write`.

Required release evidence for each row:

- app-api run id
- app-api target job id
- target attempt id
- source object keys
- raw asset id
- raw version id
- staged ingestion status
- staged promotion decision
- null current-truth import before release
- required fields all marked `present`

Current rows are not ready because they have no no-promotion preview evidence.
