---
doc_type: contract
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-06-23
updated: 2026-06-24
---
# Campus Services Tool Standard

## Boundary

This contract standardizes how `campus_services` typed tools are exposed to the
model-facing execution path and how their bounded results are consumed by
finalization.

It does not make every `campus_services` capability model-visible. Current
exposure is determined by runtime registries and readiness gates.

## Opening Rule

A `campus_services` tool is model-visible only when all of these are true:

- `configs/runtime/tool-catalog.v1.json` marks it `model_visible`.
- `configs/runtime/tool-function-schemas.v1.json` contains a canonical
  `strict: true` function schema for it.
- `configs/runtime/workflow-artifacts.v2.json` has an `open` producer binding for
  the tool.
- Every produced artifact is `current_projection_support: supported_go_runtime`.
- Go runtime profile and `/readyz` open the `campus_services` capability.

Tool-level or historical eval verdicts are not enough to open product serving.

## Tool Shape

`campus_services` uses repo-owned strict read-only function tools:

- `transport_schedule_lookup`

Do not replace typed tools with a generic `campus_service_lookup` facade unless
eval evidence shows real tool-selection conflict from the typed surface.

All model-visible `campus_services` tools must be:

- `read_only: true`
- `requires_approval: false`
- `strict: true`
- `additionalProperties: false` on every object parameter
- backed by `execution_control_internal_query`
- projected as `bounded_json`

## Result Envelope

Capability workers and finalization consume the standard envelope represented by
the canonical JSON Schema
`packages/contracts/schemas/campus-services-tool-result.v1.schema.json`.
`CampusServicesToolResultEnvelope` is the Python helper model for the same
shape, not an independent cross-language source of truth:

- `schema_version`: `campus_services_tool_result.v1`
- `capability`: `campus_services`
- `tool_name`
- `query_kind`
- `outcome`
- `facts`
- `source_refs`
- `projection_ref`
- `content_hash`
- `clarification_options`
- `fail_close_reason`

`source_refs` must be non-empty for resolved and not-found results. It may be
empty only for fail-closed results where source truth itself is unavailable; in
that case `fail_close_reason` is mandatory.

`facts` is a discriminated union:

- `schedule_facts`

The envelope may contain typed lookup results, but not raw read-model rows.

## Failure Semantics

The runtime must fail closed when currentness, projection readiness, source
truth, selector disambiguation, or source consistency cannot be proven.

Forbidden result material includes raw SQL, raw source, raw HTML, source HTML,
object locators, object-store keys, raw provider payloads, and unrestricted
read-model dumps.

No `campus_services` tool may fall back to generic retrieval, notice HTML scans,
object-store prefix scans, or browser-facing app-api loopback.

## Current Open Surface

As of 2026-06-23, the only `campus_services` model-visible tool in
`tool-catalog.v1` is `transport_schedule_lookup`.
