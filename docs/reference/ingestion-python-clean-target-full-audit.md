---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-06-12
updated: 2026-06-12
---
<!-- markdownlint-disable MD013 -->

# Ingestion Python Clean-Target Full Audit

## Scope

This audit records the current facts in branch
`refactor/python-ingestion-clean-target` after the clean-target deletion pass on
2026-06-12.

It is not merged truth for `develop`. It audits the isolated worktree only:

```text
/home/reptilian/code/campus-agent/.worktrees/python-ingestion-clean-target
```

Reviewed surfaces:

- repo-wide Python line distribution
- `apps/ingestion-worker` module surface and active `python -m` references
- `packages/ingestion-core` capability clusters
- current task registries under `configs/ingestion`
- active root `scripts/` ingestion runtime smoke/report helpers
- target runtime packages: `apps/ingestion-control`,
  `packages/ingestion-contracts`, `packages/ingestion-kernels-rs`
- LlamaIndex usage in ingestion / retrieval
- eval package Python footprint

Out of scope:

- claiming these findings are already accepted on `develop`
- claiming every TS handler or Rust kernel is already implemented
- preserving old Python modules only for compatibility

## Decision Standard

ADR-0050 and the data-plane architecture are the decision standard:

- old Python CLIs are not target runtime truth
- default decision for legacy Python collection CLI/module surfaces is delete
- needed lifecycle work should be rebuilt in TS ingestion-control / executor
- deterministic file work may move to Rust only after equivalence and profiling
- Python remains valid only for MinerU / OCR / ML / legacy document extraction
  adapters, offline eval, historical tooling, and narrow diagnostics
- rebuild/replay must continue from canonical source truth, canonical document
  artifacts or document-units, not provider-response replay as canonical owner

## Language Snapshot

Code-only line count, excluding `.git`, `node_modules`, `.venv`,
`.worktrees`, `target`, generated build directories:

| Language | Files | Lines | Share |
| --- | ---: | ---: | ---: |
| Python | 2122 | 557568 | 66.0% |
| TypeScript | 905 | 180207 | 21.3% |
| Go | 265 | 64193 | 7.6% |
| TSX | 182 | 31291 | 3.7% |
| Shell | 24 | 4035 | 0.5% |
| CSS | 8 | 3847 | 0.5% |
| SQL | 46 | 2279 | 0.3% |
| HTML | 25 | 1067 | 0.1% |
| JavaScript | 1 | 475 | 0.1% |
| Rust | 1 | 71 | 0.0% |

Including docs/config text, Python is 48.6% of counted tracked text. The
cleanup problem is therefore still Python-heavy, but the debt is not uniform:
most remaining Python is ingestion-core, ingestion tests, evals and worker
runtime shells.

## Python Distribution

Largest Python areas:

| Area | Files | Lines | Audit judgement |
| --- | ---: | ---: | --- |
| `packages/ingestion-core` | 520 | 166096 | Main data-plane implementation; split by target owner before deleting. |
| `tests/ingestion` | 625 | 162740 | Mirrors legacy worker/core lanes; should shrink as modules are deleted or rebuilt. |
| `packages/evals` | 131 | 40234 | Mostly acceptable offline eval surface, but ingestion-core coupling should be narrowed. |
| `tests/evals` | 161 | 35112 | Acceptable while eval package stays Python. |
| `apps/ingestion-worker` | 3 | 99 | Cleaned to Python adapter island: env bootstrap plus legacy Office normalization. |
| `packages/knowledge-capability` | 0 | 0 | Deleted from active workspace; Go-owned execution-control RAG runtime is the active owner. |
| `packages/retrieval-core` | 0 | 0 | Deleted from active workspace; retrieval runtime seam is Go-owned / repo-owned DTO + Qdrant native adapter target. |

## Current Target Runtime State

Target runtime exists, but it is still thin:

| Surface | Current fact | Gap |
| --- | --- | --- |
| `apps/ingestion-control` | TS service with validated admission, idempotency, claim/lease, closeout, operator projection, registry loading and a fail-closed TS executor shell. Runtime requires Postgres. | Collection-specific handlers still need to be implemented behind the TS executor; missing handlers dead-letter rather than falling back to Python. |
| `packages/ingestion-contracts` | TS + Python validators for task envelope and registry schemas. | Contracts cover envelope/topology, not collection-specific materialization contracts. |
| `apps/ingestion-worker` | Python adapter island only: env bootstrap plus legacy Office normalization adapter. | Any new Python use must be a private extraction adapter invoked from an explicit TS task handler. |
| `packages/ingestion-kernels-rs` | One Rust kernel: `validate_document_units_jsonl`. | Rust footprint is not yet a real chunking/hash/dedup/release-manifest kernel suite. |
| Task registries | Default registries declare TS/Rust task topology for student rules, curriculum, academic calendar, official web, internal notice, WeChat public notice and campus-service projections. | Registries are topology declarations; collection-specific TS handlers and Rust kernels remain explicit implementation work. |

## Task Registry Audit

Current registry files include:

- `configs/ingestion/regulations/student_rules/task-registry.v1.json`
- `configs/ingestion/curriculum/curriculum_plan/task-registry.v1.json`
- `configs/ingestion/calendar/academic_calendar/task-registry.v1.json`
- `configs/ingestion/official_web/stable_reference/task-registry.v1.json`
- `configs/ingestion/official_web/fresh_news/task-registry.v1.json`
- `configs/ingestion/campus_notices/internal_notice/task-registry.v1.json`
- `configs/ingestion/campus_notices/wechat_public_notice/task-registry.v1.json`
- `configs/ingestion/campus_services/*/task-registry.v1.json`

Both registries are valuable because they declare target topology. They are not
proof that Python should remain the default implementation lane.

Current executor mix:

| Collection group | Python adapter tasks | Rust kernel tasks | Missing target owner |
| --- | --- | --- | --- |
| `regulations/student_rules` | none in registry | document-units validate, chunk prepare | TS handlers for materialization, projection and alias publish; Rust chunk kernel implementation proof |
| `curriculum/curriculum_plan` | none in registry | document-units validate, chunk prepare | TS handlers for materialization, projection and alias publish; Rust chunk kernel implementation proof |
| calendar / official web / notices / services | none in registry | document-unit validation, chunk or release-manifest validation where declared | Collection-specific TS handlers; Python only behind private extraction adapters where required |

Clean-target decision:

- keep registries as declarations
- lifecycle / release / alias publish are TS ingestion-control task families
  by declaration
- keep Python adapters only where actual MinerU/OCR/legacy document extraction
  or ML/domain extraction is required
- make Rust kernels file-level only: validation, chunk packing, hash/dedup/diff,
  manifest validation, embedding batch input preparation

## Worker Surface Audit

`apps/ingestion-worker` no longer publishes Python console scripts and no
longer contains the old collection/runtime modules. The retained package files
are:

- `__init__.py`
- `env_bootstrap.py`
- `normalize_authenticated_notice_legacy_office_attachment.py`

Deleted active worker surfaces include:

- on-demand batch runner and wrapper scripts
- collection-specific Python worker modules
- Python ingestion task executor seam
- root Python ingestion runtime smoke/report scripts that had no current owner
- local systemd units for old ingestion-worker loops
- old active runbooks for authenticated notice closeout/replay, official-web
  handoff/replay, index release, Qdrant backup/GC and local Postgres recovery

### Strong Active Chains

These chains were cut from active runtime surfaces in this worktree. Remaining
work is implementation behind the target TS/Rust topology, not compatibility
retention.

| Chain | Current disposition | Target disposition |
| --- | --- | --- |
| on-demand batch runner | deleted from scripts and worker modules | TS ingestion-control task admission/execution |
| official-web handoff/release | old worker modules deleted; active docs point to ingestion-control clean target | TS source-channel/release tasks |
| authenticated notice queue/closeout | old worker modules/runbooks archived | TS admission/lease/closeout/read-model projection; Python extraction adapters only |
| internal notice multimodal | old lifecycle commands deleted | TS lifecycle with private Python OCR/multimodal adapter only |
| structured services projections | old Python builders deleted; service-guide runtime verification moved to eval owner | TS projection tasks |
| academic calendar projection | old root Python publish/runtime smoke scripts deleted; registry declares structured projection publish | TS projection tasks |
| registry/index release | old Python release modules deleted | TS release state machine, Rust manifest/chunk/hash kernels |
| Qdrant backup/GC/seed | old ingestion-worker modules/runbooks archived | ops tooling outside ingestion-worker |

### Compatibility Export Risk

`apps/ingestion-worker/src/campus_ingestion_worker/__init__.py` no longer
contains lazy `_EXPORTS`, `__getattr__`, heavy adapter re-exports or `*_main`
compatibility exports. It exports only `load_worker_env`; adapter code is
imported by its concrete module path.

## Ingestion-Core Audit

`packages/ingestion-core` is still the largest Python area. It should not be
bulk-deleted: it owns canonical source truth, materialization, projection and
release logic today. The cleanup must classify by owner.

Ingestion-core cluster distribution:

| Cluster | Files | Lines | Target owner |
| --- | ---: | ---: | --- |
| authenticated notice | 94 | 31693 | TS lifecycle + Python extraction adapters + core canonical models during transition |
| regulation / handbook | 73 | 26067 | TS materialization lifecycle + Rust deterministic kernels + domain semantics packages |
| internal notice | 65 | 20260 | TS lifecycle/projection; Python only for OCR/multimodal adapters |
| curriculum | 37 | 12741 | TS projection/materialization lifecycle; Rust validation/chunking; Python extraction only if needed |
| official web | 29 | 10035 | TS source-channel/release lifecycle; core keeps canonical projection logic until replacement |
| raw/process/chunk/embed | 28 | 9228 | Rust for deterministic chunk/file kernels; remove LlamaIndex dependency from canonical DTOs over time |
| service/transport/contact projections | 35 | 9561 | TS projection tasks; core models can remain until TS owner exists |
| index/release | 18 | 5252 | TS release state machine; Rust manifest/hash/diff validation |
| file asset / OCR | 11 | 4137 | Python adapter island is acceptable |
| source handoff | 8 | 2931 | TS source-channel lifecycle |
| Qdrant ops | 7 | 1620 | Ops/release lane, not collection materialization core |

Clean-target judgement:

- do not migrate all ingestion-core Python one-for-one
- do not expose `campus_ingestion_core` as a `python -m` utility surface; tokenizer
  cache misses now fail closed and require pre-provisioned runtime artifacts
- delete historical/replay/backfill modules after evidence is archived
- rebuild lifecycle and release orchestration in TS
- rebuild deterministic file/manifest/chunk work in Rust only after proof
- preserve Python island for file asset extraction, OCR, MinerU, multimodal and
  offline diagnostics

## LlamaIndex Audit

Runtime LlamaIndex usage remains only in ingestion-core:

- ingestion-core:
  - `process_shared.py`
  - `process_chunking.py`
  - `embed.py`
- tests:
  - registry-scope release/audit tests

Current architecture allows LlamaIndex only as an internal implementation
dependency. It must not enter contracts, execution-control, panel/eval canonical
truth or source-truth artifacts.

Clean-target judgement:

- no urgent delete is required if DTO boundaries stay repo-owned
- ingestion chunking and embedding helpers are candidates for replacement by
  repo-owned DTOs plus Rust file kernels / direct provider clients
- retrieval backend should stay in Go-owned / repo-owned DTO + Qdrant-native request /
  payload shaping; deleted Python retrieval-core must not be revived as compatibility
  runtime
- evals should not make LlamaIndex node identity canonical truth

## Eval Audit

`packages/evals` is Python-heavy but mostly legitimate:

- 131 files / 40234 lines in package code
- 161 files / 35112 lines in eval tests
- uses deterministic gates, qrels, product-path checks, policy fixtures,
  answer quality gates and supplemental adapters
- `ragas` is explicitly supplemental, not canonical deterministic truth

Clean-target judgement:

- do not prioritize eval package deletion before ingestion runtime cleanup
- keep offline eval in Python for now
- service-guide selected-write runtime smoke is eval-owned Python verification,
  not an ingestion root script or serving fallback
- remove direct ingestion-worker dependencies from evals when old worker modules
  are deleted
- avoid allowing eval fixtures to freeze legacy ingestion implementation details

## Executed Cleanup Batches

### Batch A: Cut Compatibility Facade

Goal: stop making old worker operations look like stable Python package API.

Executed:

- shrank `apps/ingestion-worker/__init__.py` to `load_worker_env` only
- move tests importing worker facade exports to direct module imports or core
  imports
- delete `*_main` lazy exports
- add a guard test that prevents new legacy facade exports

Result:

- no lazy compatibility facade remains
- `apps/ingestion-worker` contains only three Python files and 99 lines

### Batch B: Archive Or Delete Historical Recovery Modules

Goal: remove executable historical/replay/backfill paths with no current SLA.

Executed:

- deleted historical regulation denominator/chunk/backfill executable modules
- deleted collection rename backfill executable path
- deleted smoke/preview/reset/purge/repair modules and root scripts
- deleted replay generation modules and orphan status/list/report wrappers
- archived historical runbooks/reference files under
  `docs/runbooks/archive/python-ingestion-worker/` and
  `docs/reference/archive/python-ingestion-worker/`

Guard:

- active docs now point to ingestion-control or archived evidence, not old Python
  command execution

### Batch C: Replace On-Demand Runner With TS Task Families

Goal: retire Python child-process orchestration.

Executed:

- deleted the Python on-demand batch runner and wrapper scripts
- added collection task registries for official web, notices, services,
  student rules, curriculum and academic calendar
- added registry-aware TS executor shell in `apps/ingestion-control`
- removed the non-registry `runClaimedTaskOnce` execution seam so task dispatch
  cannot bypass registry topology

Target:

- TS ingestion-control owns admit/register/claim/lease/retry/dead-letter
- durable executor shell dispatches typed task handlers
- Python called only as adapter subprocess for OCR/multimodal/extraction
- telemetry closeout is a task event, not a JSON report side channel
- missing handler / kernel now dead-letters fail-closed rather than falling
  back to Python

### Batch D: Rebuild Release And Alias Publish

Goal: remove Python release/index/Qdrant alias ownership.

Executed:

- deleted Python release/index/Qdrant alias modules and tests
- registry task topology declares `alias_publish` as `ts_control`
- registry task topology declares deterministic validation/chunk work as
  `rust_kernel`
- Qdrant backup/GC/seed commands no longer live under ingestion-worker

Target:

- TS release task state machine
- Rust manifest/hash/chunk validation kernels
- Qdrant alias publish behind explicit release acceptance and backup gate
- no provider-response replay as canonical rebuild owner

### Batch E: Rehome Ops Tooling

Goal: move operational data-plane utilities out of ingestion-worker collection
runtime.

Executed:

- deleted Qdrant filesystem backup/cleanup/retention audit modules
- deleted Qdrant GC check/delete modules
- deleted serving seed export/verify/restore modules
- deleted root local Postgres restore/smoke scripts tied to old ingestion-worker
  operations
- active runbooks no longer present these as ingestion-worker commands

Target:

- infra/ops runbooks and scripts
- strict inventory-only destructive guards
- no source-channel collection semantics

### Batch F: Collapse Python Adapters Into Islands

Goal: make remaining Python intentional and small.

Executed:

- `apps/ingestion-worker` now contains only env bootstrap and the legacy Office
  normalization adapter
- service-guide selected-write runtime verification moved under
  `packages/evals`
- tokenizer prefetch CLI was deleted; tokenizer cache misses require
  pre-provisioned artifacts
- guard tests prevent reintroducing old worker modules, old core lifecycle
  modules, active root scripts and Python adapter registry executors

Allowed remaining islands:

- MinerU/OCR
- multimodal image/table extraction
- legacy Office / OOXML extraction
- ML/domain extraction adapters
- offline eval
- historical audit evidence that is not executable runtime

Everything else should be TS lifecycle, Rust kernel or deleted.

## Clean-Target Summary

The next correct move is not "migrate every old Python CLI into the registry".
That would preserve the wrong abstraction.

The correct target is:

- registry declares task topology
- TS control plane owns lifecycle
- TS executor owns durable dispatch and closeout
- Rust owns proven deterministic kernels
- Python is a private adapter island
- historical scripts become archived evidence or are deleted

The largest immediate cleanup leverage is `apps/ingestion-worker`, not
`packages/evals`. The largest long-term Python reduction is moving
ingestion-core lifecycle/release/projection orchestration into TS task families
while preserving only canonical models and Python-only extraction adapters
during the transition.
