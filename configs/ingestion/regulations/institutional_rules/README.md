# institutional_rules collection

This directory defines the physical `regulations/institutional_rules`
collection used by the public `institutional_rules` knowledge target.

## Files

- `serving-config.json`: query-serving and Qdrant contract
- `canonical-profile.json`: document identity and provenance fields
- `chunk-profile.json`: canonical document chunking profile
- `query-planning.json`: title-aware retrieval hints
- `task-registry.v3.json`: executable ingestion tasks

## Runtime

- `configs/runtime/query-serving-targets.v1.json` maps the
  `institutional_rules` target to this collection.
- The collection is `query_serving`, uses the `institutional_rules` Qdrant
  alias, and admits public or campus-restricted evidence.
- Query serving requires the alias to exist and its dense and sparse vector
  configuration to match the active embedding profile.

## Ingestion

The active registry starts from canonical `document-units` and exposes two
deterministic tasks:

- `document_units_validate`
- `chunk_prepare`

Source materialization, indexing, and alias publication are not task entries in
this collection registry. No placeholder promotion declaration is retained.

Canonical regulation identity is based on the regulation work, issuer, and
semantic applicability rather than a wrapper notice id. Promotion preserves
source notice provenance while keeping `source_notice_document_id` separate
from `semantic_owner_document_id`.

Display metadata keeps these meanings distinct:

- `regulation_work_title`: stable work identity
- `regulation_edition_label`: edition or revision label
- `regulation_display_title`: rendered work and edition title
- `source_title_literal`: source-facing title

Annual-cycle and time-bound rules belong to `regulations/scoped_rules`, not
this collection.
