# student_rules collection

This directory defines the physical `regulations/student_rules` collection
used by the public `student_rules` knowledge target.

## Files

- `serving-config.json`: query-serving and Qdrant contract
- `split-manifest.v1.json`: synthetic public split-manifest fixture
- `canonical-profile.json`: document identity and metadata fields
- `chunk-profile.json`: document chunking profile
- `task-registry.v3.json`: executable ingestion tasks

## Runtime

- `configs/runtime/query-serving-targets.v1.json` maps the `student_rules`
  target to this collection.
- The collection is `query_serving` and uses the `student_rules` Qdrant alias.
- Query serving requires a published alias whose vector configuration matches
  the active embedding profile.

## Ingestion

The active registry starts from canonical `document-units` and exposes two
deterministic tasks:

- `document_units_validate`
- `chunk_prepare`

Source parsing, document materialization, indexing, and alias publication are
not task entries in this collection registry. The checked-in split manifest is
a synthetic public fixture; private source artifacts provide deployment data.

Handbook-specific normalization, identity, chunk budgets, header handling, and
validation rules are defined in `docs/policies/student-rules-chunking.md`.
Student rules contain regulation-facing documents and appendices only; phone
directories and service catalogs belong to their owning product domains.
