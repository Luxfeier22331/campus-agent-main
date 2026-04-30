---
doc_type: evidence
status: current
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Current Inventory

This inventory freezes the starting truth for `canonical-retrieval-release-hardening`.
It is evidence for Phase 0 only; it does not change runtime behavior.

## Scope Inventory

Runtime profiles currently mark these scopes as default query-enabled:

| Scope | Serving stage | Alias | Source |
|-------|---------------|-------|--------|
| `curriculum/curriculum_plan` | `query_serving` | `curriculum_plan` | `configs/ingestion/curriculum/curriculum_plan/runtime-profile.json` |
| `official_web/stable_reference` | `query_serving` | `official_web_stable_reference` | `configs/ingestion/official_web/stable_reference/runtime-profile.json` |
| `regulations/institutional_rules` | `query_serving` | `institutional_rules` | `configs/ingestion/regulations/institutional_rules/runtime-profile.json` |
| `regulations/student_rules` | `query_serving` | `student_rules` | `configs/ingestion/regulations/student_rules/runtime-profile.json` |

`configs/runtime/query-serving-scopes.v1.json` currently lists the same four scopes.

Retrieval-ready but default-off scopes:

| Scope | Serving stage | Alias | Posture |
|-------|---------------|-------|---------|
| `curriculum/course_facts` | `query_serving` | `course_facts` | agent-internal retrieval surface |
| `curriculum/program_family_facts` | `query_serving` | `program_family_facts` | agent-internal retrieval surface |
| `curriculum/program_semester_facts` | `query_serving` | `program_semester_facts` | agent-internal retrieval surface |
| `regulations/scoped_rules` | `query_serving` | `scoped_rules` | retrieval-ready holding collection, not default product admission |

Offline-preparation or non-retrieval scopes:

- `authenticated_documents/common_download_source`
- `authenticated_documents/file_release_source`
- `campus_navigation/place_catalog`
- `campus_notices/internal_notice`
- `campus_services/contact_directory`
- `campus_services/service_catalog`
- `campus_services/service_guide`
- `campus_services/transport_schedule`
- `official_web/fresh_news`
- `official_web/muc_public_pages`
- `official_web/news_archive`

## Query-Enabled Truth Drift

Phase 1 must resolve the remaining query-enabled truth drift:

- `docs/architecture/current-architecture.md` and `.planning/PROJECT.md` currently name
  `regulations/student_rules`, `regulations/institutional_rules`, and `curriculum/curriculum_plan`
  as current query-enabled truth.
- `docs/architecture/system/retrieval-serving-architecture.md` currently names only
  `regulations/student_rules` and `curriculum/curriculum_plan`.
- Runtime profiles and `configs/runtime/query-serving-scopes.v1.json` currently include
  `official_web/stable_reference` as default query-enabled.

Phase 1 must explicitly decide whether `official_web/stable_reference` remains default
query-enabled. After that decision, architecture docs, `.planning/PROJECT.md`, runtime profiles,
`configs/runtime/query-serving-scopes.v1.json`, and drift tests must converge.

## Chain Owners

`packages/ingestion-core` owns the offline data-plane and release truth:

- `campus_ingestion_core.corpus_profiles` loads `CollectionRuntimeProfile`, chunk profiles,
  `default_query_scopes`, and Qdrant alias/prefix bindings.
- `campus_ingestion_core.registry_scope_release.release_registry_scope` and
  `publish_scope_release` select registry records, require verified chunk preparation, build
  embeddings, write the physical collection, and optionally publish the serving alias.
- `campus_ingestion_core.index_release` owns `IndexReleaseManifest`, release validation,
  release artifact writes, alias publish/rollback/reset, and release metadata payload injected
  into Qdrant points.
- `campus_ingestion_core.local_rebuild_runtime.rebuild_local_data` owns provider-response replay
  indexing and already fail-closes alias publish for provider-response replay.
- `campus_ingestion_core.qdrant_backup` owns snapshot backup / restore artifact behavior.

`apps/ingestion-worker` owns CLI/runtime shells for offline operations:

- `campus_ingestion_worker.release_registry_scope`
- `campus_ingestion_worker.release_index`
- `campus_ingestion_worker.rebuild_local_data`
- `campus_ingestion_worker.scope_alias`
- `campus_ingestion_worker.qdrant_backup_create`
- `campus_ingestion_worker.qdrant_backup_restore`
- `campus_ingestion_worker.audit_collection_runtime_state`

`packages/retrieval-core` owns online retrieval execution:

- `QdrantRetrievalBackend.retrieve` loads the runtime profile, rejects disabled retrieval scopes,
  queries the profile alias, builds dense+sparse hybrid prefetch and RRF queries, applies no-hit /
  official-web low-signal policies, expands named-document support, and shapes evidence.
- Current retrieval runtime does not yet validate alias release metadata against current
  `RetrievalSettings`, `SparseEmbeddingSettings`, or `CollectionRuntimeProfile`.

`packages/rag-agent` / supervisor consume retrieval evidence and must not own index release truth.

## Confirmed Gaps

Correctness blockers:

- Query-enabled truth is inconsistent across docs / planning / runtime profiles.
- Registry-scope alias publish does not yet run deterministic retrieval acceptance against the
  newly built physical collection.
- Query-serving publish has no fail-closed rule for missing acceptance fixtures.
- Runtime retrieval does not yet detect release metadata drift before returning evidence.

Release provenance gaps:

- Release manifest / Qdrant point payload do not yet fully capture sparse provider/model/tokenizer,
  hybrid RRF profile, dense/sparse prefetch limits, query instruction identity, tokenizer identity,
  chunker implementation identity, normalizer identity, or document-units schema provenance.

Cost / quality hardening gaps:

- Embedding cache is not implemented.
- Retrieval tuning is not qrels-driven per collection.

## Fixed Phase Order

The execution order is now fixed as:

1. Phase 0: scope and truth inventory.
2. Phase 1: query-enabled truth fix.
3. Phase 2: release retrieval acceptance gate.
4. Phase 3: sparse and hybrid provenance.
5. Phase 4: chunker and tokenizer provenance.
6. Phase 5: retrieval runtime drift guard.
7. Phase 6: embedding cache and cost control.
8. Phase 7: eval-driven retrieval tuning.
9. Phase 8: acceptance, docs, and closeout.

Runtime drift guard intentionally follows provenance phases, because it must validate fields that
exist in release / point payload truth.

## Phase Acceptance Denominator

Phase 1:

- `tests.ingestion.test_corpus_runtime_profile`
- `tests.supervisor.test_query_serving_scope_policy_drift`
- docs lint

Phase 2:

- New `tests.ingestion.test_index_release_acceptance`
- `tests.ingestion.test_registry_scope_release`
- `tests.ingestion.test_regulation_serving_release_gates`
- `tests.retrieval.test_backend_qdrant`

Phase 3:

- `tests.ingestion.test_index_release`
- `tests.ingestion.test_registry_scope_release`
- `tests.ingestion.test_qdrant_backup`
- `tests.ingestion.test_qdrant_backup_worker`
- provider-result replay indexing suites

Phase 4:

- chunk preparation / regulation serving release gate tests.
- docs lint for operator rerun rules.

Phase 5:

- retrieval backend/service tests covering matching metadata, dense mismatch, sparse mismatch,
  chunk policy mismatch, missing metadata, and cache behavior.

Phase 6:

- embedding, registry scope release, and index release tests with cache hit/miss/dimension
  validation.

Phase 7:

- `tests.evals`
- retrieval backend/service tests for selected tuned profiles.

Phase 8:

- focused ingestion + retrieval + backup + eval gates.
- docs lint.

## Frozen Decisions

- Provider-response replay must not publish query-serving alias.
- Query-serving alias publish must fail closed when acceptance fixtures are missing or failing.
- Online retrieval runtime must not depend on object-store manifest fetches in the request path.
  Runtime drift guard should use Qdrant point payload / current release metadata; object-store
  manifest remains audit / offline fallback.
- `packages/evals` owns shared qrels / retrieval tuning runner logic. `packages/ingestion-core`
  may consume deterministic reports or schemas but must not own shared eval tuning logic.
- `campus_services/*` structured tools and generic notice card search remain projection/read-model
  surfaces; this workstream must not convert them into retrieval aliases.

## Deferred / Non-Goals

- No raw collector, source-specific scraping, notice routing taxonomy, campus services structured
  tool, or public-chat UI work belongs in this workstream.
- No new vector database or retrieval backend replacement belongs in this workstream.
- No default expansion of query-enabled scopes may happen through eval tuning.
