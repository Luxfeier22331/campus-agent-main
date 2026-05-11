# service_guide collection config

This directory holds the repo-tracked config scaffolding for the
`service_guide` collection within the `campus_services` corpus.

- `runtime-profile.json`: canonical runtime gate for structured projection
  release and serving-policy control
- `chunk-profile.json`: placeholder chunk profile for config invariants while
  serving remains gate-closed
- `source-truth.v1.json`: canonical manifest of curated source-truth artifacts
  consumed into `campus_services_service_guide_projection.v1`

Current runtime truth:

- serving stage: `structured_query_serving`
- query enabled: `false`
- structured query enabled: `true` via `service_guide_lookup`
- serving alias: `service_guide`
- collection prefix: `service_guide`
- release manifests: `campus_services/releases/service_guide/{release_id}/...`

Current structured projection:

- schema: `campus_services_service_guide_projection.v1`
- current tracked source-truth gate: 15 ready records from dormitory workflows,
  public medical guides, student daily-affairs guides, financial-aid guides and
  official campus-card service pages
- canonical build path: `regulations/student_rules` handbook raw ingestion and
  provider-response replay load `source-truth.v1.json` after successful
  document persistence, then publish the `service_guide` structured projection
  release in the same run
- debug/recovery shell:
  command `python -m campus_ingestion_worker.build_service_guide_projection`
  with `--source-truth-manifest` pointing at this directory's
  `source-truth.v1.json`
- data contract:
  `docs/data/campus-services-service-guide-source-truth-schema.md`

`service_guide` is the read-only owner for campus service guide facts:
procedures, required materials, entry explanations, office hours, contact refs,
eligibility notes and source refs. It does not own transaction submission,
booking, payment, work-order creation or route planning. It opens only the typed
structured runtime path for `service_guide_lookup`; generic retrieval and
default query-serving aliases remain closed.
