# AGENTS.md

This file supplements the repository guide for `apps/execution-control`.

## Owner Boundary

- This app owns the Go execution-control service, Temporal lifecycle,
  sanitized projections and runtime observability.
- Browser product state and auth belong to app-api. Agent/tool loops belong to
  agent-runtime. Ingestion, vector collection lifecycle and source publication
  stay outside this app.
- Generated execution wire contracts remain the request/response source. Do
  not add a second parser, alias model or compatibility envelope.

Read `apps/execution-control/README.md` and the relevant runtime architecture
and contract documents before changing service boundaries.

## Go Layout

- Keep `internal/httpapi/server.go` focused on assembly and route registration.
- Add behavior tests to the relevant domain test file instead of growing
  `internal/httpapi/server_test.go`.
- Keep metrics state/recording separate from exposition formatting.
- Split new Go files before they exceed the repository's 800-line review limit.

## Verification

Run `pnpm go:check` for Go changes and `pnpm repo:static` when Markdown or other
repository text changes.
