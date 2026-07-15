# curriculum_plan collection

This directory defines the physical `curriculum/curriculum_plan` collection
used by the public `curriculum` knowledge target.

## Files

- `serving-config.json`: query-serving and Qdrant contract
- `split-manifest.v1.json`: synthetic public logical-document boundaries
- `chunk-profile.json`: section and table chunking profile
- `query-planning.json`: curriculum retrieval hints
- `retrieval-profile.json`: collection retrieval configuration
- `samples/`: synthetic document-unit samples
- `task-registry.v3.json`: executable ingestion tasks

## Runtime

- `configs/runtime/query-serving-targets.v1.json` deliberately exposes the
  domain target as `curriculum` while mapping it to this physical collection.
- The collection is `query_serving` and uses the `curriculum_plan` Qdrant
  alias.
- Query serving requires a published alias whose vector configuration matches
  the active embedding profile.

## Ingestion

The active registry starts from canonical `document-units` and exposes two
deterministic tasks:

- `document_units_validate`
- `chunk_prepare`

Source parsing, document materialization, indexing, and alias publication are
not task entries in this collection registry. Private artifacts provide real
curriculum source and reviewed split data; checked-in manifests and samples are
synthetic public fixtures.

Curriculum `document-units` preserve the structure required to reconstruct
sections and tables, including headings, reading order, HTML/table cells,
caption ownership, and continuation groups. Dropping these fields is a contract
violation. Runtime chunking is loaded from `serving-config.json` and
`chunk-profile.json`; section and table profiles remain collection-owned.
