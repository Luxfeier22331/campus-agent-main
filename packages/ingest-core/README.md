# ingest-core

Runtime-neutral ingestion helpers for campus-agent data plane code.

This package owns shared TypeScript ingestion helper semantics that are used by
collector runtimes, ingestion-control handlers and jobs. It is not a deployable
runtime and must not import Temporal, Crawlee, concrete object-store clients,
database clients, provider transports or env bootstrap.

Allowed responsibilities:

- artifact refs and `s3://` URI helpers
- sha256 / `sha256:` digest helpers
- runtime-neutral object-store interfaces
- source-channel handoff DTO parsers backed by Zod for TS-only boundaries
- deterministic source-truth object key builders
- canonical JSON / JSON Lines artifact writers backed by the package canonical
  JSON helper
- collection runtime / chunk profile parsers backed by Zod for TS-only
  boundaries
- Rust kernel output parsers backed by Zod for the currently executable kernel
  contracts
- authenticated notice notice-family config parsing, deterministic routing
  decisions and capture-route attachment retention helpers
- authenticated notice source-truth inventory entry parsing, risk labeling,
  latest-parent selection and parent snapshot helpers
- ingestion task registry catalog lookup
- default executor inventory audit for registry-declared task executability and
  input/output contract alignment, including fail-closed rejection of registry
  tasks that imply alias publication before an `alias_publish` lifecycle exists
- runtime-neutral registry-aware task dispatch, TS handler registry, Rust kernel
  handler registry, object-store input-ref enforcement and stable fail-closed
  execution error codes
- Node-only registry file loading through `ingest-core/node`

Runtime code remains in `apps/*` or `jobs/*`.

`ingest-core` is the only TS package that should own generic source handoff
parsing, collection profile payload validation, canonical artifact
serialization, digest comparison and source-truth key construction. It also
owns the runtime-neutral executor semantics for choosing a declared
`ts_control` handler or `rust_kernel` handler from a validated registry task.
Runtime handlers in `apps/ingestion-control` should call these helpers instead
of reimplementing local JSON sorting, handoff validators, profile parsers,
artifact writers or registry-aware dispatch.

Active default task execution requires `input_ref.kind=object_store`.
`inline`, `local_file` and `postgres_row` refs may remain in shared contracts
or narrow tests, but `ingest-core` rejects them before handler dispatch for
registry-declared runtime tasks.

Authenticated notice inventory helpers in this package only transform
registry-like rows and source-truth payloads into deterministic DTOs. They do
not own the inventory store, full-scope rebuilds, attachment byte inspection,
OCR/provider execution or downstream materialization lifecycle.

Authenticated notice routing helpers require callers to inject the parsed
notice-family config. Runtime file loading belongs to `apps/ingestion-control`
or another deployable runtime, not this package.

Forbidden responsibilities:

- Temporal workflow/activity clients or worker setup
- Crawlee collectors, routers, browser/page state or crawler storage
- concrete S3, Postgres, Qdrant, provider or env bootstrap clients
- collection profile file discovery, env projection or runtime config loading
- collection lifecycle, task lease/claim/retry/dead-letter or closeout storage
- Temporal workflow/activity execution or terminal closeout mutation
- source-specific capture runtime code
