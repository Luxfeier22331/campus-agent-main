# campus-ingestion-worker

Python adapter island for ingestion data-plane extraction work.

This package no longer owns ingestion task lifecycle, batch orchestration,
release, alias publish, object-store cleanup, Qdrant operations, or collection
materialization CLIs.

Target ownership:

- `apps/ingestion-control` owns task admission, claim / lease, retry,
  dead-letter, closeout and operator projections.
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` declares task
  topology with `ts_control` or `rust_kernel` executors.
- `packages/ingestion-kernels-rs` owns deterministic file-level kernels.
- Python in this package is limited to extraction adapters that require the
  Python ecosystem.

Current retained modules:

- `campus_ingestion_worker.env_bootstrap`
- `campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment`

Removed surfaces:

- on-demand batch runner
- public `campus-ingestion-*` console scripts
- collection-specific `python -m campus_ingestion_worker.*` commands
- registry/release/index/Qdrant/seed cleanup commands
- Python ingestion task executor seam

No compatibility wrapper or fallback command should be added for removed
modules. Needed tools must be rebuilt in TS control-plane/executor tasks
or Rust kernels, with Python called only as a private extraction adapter when
the task genuinely requires it.
