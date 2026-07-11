---
doc_type: contract
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-07-05
updated: 2026-07-06
---
# Replay Capture Contract

## Contract Boundary

This contract defines how online LLM execution may produce replayable diagnostic
artifacts without weakening product-safe observability.

It owns:

- run-level LLM I/O fingerprint shape
- prompt registry, primary-call and tool-runtime attestation shape
- provider request safe hash and model params safe projection shape
- raw capture policy shape
- raw replay packet shape
- evidence replay index shape
- replay packet safe index shape
- replay result diff shape
- storage, access, retention and deletion boundaries for replay artifacts

It does not own:

- app-api public chat response shape
- Operator Console UI layout
- Langfuse score schemas
- Temporal workflow history shape
- release verdicts or staging closeout

## Core Rule

Safe projection and raw replay are separate data planes.

Safe projection is the default online observability surface. It may be retained
and queried by app-api, Operator Console, Axiom, Sentry, Langfuse metadata and
Temporal step projection. It must not contain raw prompt, raw answer, raw
transcript, raw provider payload, raw tool I/O, raw retrieved body, raw memory
text, auth material or secrets.

Raw replay is a restricted diagnostic and eval data plane. It may contain raw or
near-raw LLM I/O only when admitted by `raw_capture_policy.v1`. It is not product
truth, not app-api read-model truth, not Temporal metadata truth and not an
Operator Console payload.

## `llm_io_fingerprint.v1`

Every online provider-backed OpenAI Agents SDK run should produce a comparable
safe fingerprint. The fingerprint identifies what the model saw and which
runtime contract produced the answer without storing the raw body. Knowledge
Agent handoff remains part of the same SDK run.

Required fields:

- `schema_version`: `llm_io_fingerprint.v1`
- `run_id`
- `request_id`
- `trace_id`
- `runtime_release`
- `llm_call_site`: `agent.primary`
- `provider_profile_revision`
- `provider`
- `model`
- `model_params_hash`
- `model_params_projection`
- `prompt_id`
- `prompt_registry_attestation`
- `prompt_template_sha256`
- `prompt_variables_schema_version`
- `rendered_prompt_sha256`
- `provider_request_safe_hash`
- `tool_catalog_sha256`
- `tool_schema_sha256`
- `tool_runtime_fingerprint`
- `tool_runtime_attestation`
- `workflow_artifact_sha256`
- `context_envelope_sha256`
- `memory_selection_sha256`
- `evidence_packet_sha256`
- `output_schema_id`
- `primary_attestation`

`prompt_registry_attestation.v1` binds the call to the prompt registry truth:

- `schema_version`: `prompt_registry_attestation.v1`
- `prompt_registry_version`
- `prompt_id`
- `prompt_template_sha256`
- `prompt_variables_schema_version`
- `output_schema_id`
- `attestation_sha256`

The attestation is safe metadata. It proves which registered prompt template,
variable schema and output schema were used. It must not contain rendered prompt
text or prompt variables.

`primary_attestation.v1` proves the LLM call entered through the current
primary-agent-first topology:

- `schema_version`: `primary_attestation.v1`
- `attestation_kind`: `primary_agent_call`
- `attested_by`
- `attestation_sha256`

The attestation proves that the complete provider-backed run was produced by
`apps/agent-runtime`. A Knowledge Agent handoff is represented by sanitized SDK
trajectory/agent identity, not a second execution-control-owned LLM call.

`model_params_projection.v1` is the only safe model-params projection:

- `schema_version`: `model_params_projection.v1`
- `params_schema_version`
- `params_sha256`
- `projected_params`

`projected_params` is an allowlisted view of stable behavior-affecting knobs
such as max output tokens, temperature, top-p, reasoning effort, response format
and tool-choice class. It must not include provider headers, request body,
messages, prompt text, user text, raw tool I/O or credentials.

`provider_request_safe_hash.v1` identifies the provider request without storing
the provider request body:

- `schema_version`: `provider_request_safe_hash.v1`
- `canonicalization`: `canonical_json_redacted_v1`
- `redaction_policy`: `llm_provider_request_safe_projection.v1`
- `request_sha256`

The hash is computed over the canonical safe projection after redaction. It is
not a hash of raw prompt text, raw messages or the unredacted provider body.

`tool_runtime_fingerprint` uses `tool_runtime_fingerprint.v1`:

- `schema_version`: `tool_runtime_fingerprint.v1`
- `tools_schema_version`
- `tools_registry_version`
- `tools_sha256`
- `function_schema_version`
- `function_schema_sha256`
- `workflow_artifact_schema_version`
- `workflow_artifact_registry_version`
- `workflow_artifact_sha256`
- `combined_sha256`

The three flat fields remain required index fields:

- `tool_catalog_sha256` must equal `tool_runtime_fingerprint.tools_sha256`.
- `tool_schema_sha256` must equal
  `tool_runtime_fingerprint.function_schema_sha256`.
- `workflow_artifact_sha256` must equal
  `tool_runtime_fingerprint.workflow_artifact_sha256`.

The runtime must compute these hashes from canonical JSON content of the actual
runtime config files used for the call:

- `configs/runtime/tools.v4.json`
- `configs/runtime/tool-function-schemas.v1.json`
- `configs/runtime/workflow-artifacts.v2.json`

Missing, unreadable, malformed or unsupported registry files are execution
contract failures and must fail closed before claiming a provider-backed LLM
call is replayable. Hardcoded placeholder hashes are not valid runtime
fingerprints.

`tool_runtime_attestation.v1` binds that fingerprint to the runtime config
files that made tools model-visible:

- `schema_version`: `tool_runtime_attestation.v1`
- `attested_by`
- `config_refs`: exactly
  `configs/runtime/tools.v4.json`,
  `configs/runtime/tool-function-schemas.v1.json` and
  `configs/runtime/workflow-artifacts.v2.json`
- `tools_registry_version`
- `function_schema_version`
- `workflow_artifact_registry_version`
- `combined_sha256`

If any config ref is missing, unreadable, malformed, unsupported or inconsistent
with the flat fingerprint hashes, the provider-backed LLM call is not
replayable and must fail closed before claiming replay capture.

The fingerprint must not contain raw prompt text, raw memory text, retrieved
source text, provider request body, provider response body, raw tool arguments,
raw tool results or credentials.

## `raw_capture_policy.v1`

Raw capture is disabled unless a request is admitted by policy.

Allowed modes:

- `off`
- `sampled`
- `failure_triggered`
- `operator_window`
- `eval_case`
- `manual_run_capture`

Required fields:

- `schema_version`: `raw_capture_policy.v1`
- `mode`
- `capture_reason`
- `ttl_days`
- `allowed_sinks`
- `allowed_raw_fields`
- `operator_principal`
- `approval_ref`
- `request_id`
- `run_id`
- `trace_id`
- `audit_required`
- `dsar_delete_linkage_required`

Rules:

- Default mode is `off`.
- `ttl_days` must be explicit for every mode other than `off`.
- Capturing raw memory text, selected evidence text or provider payload requires
  the policy to name that field in `allowed_raw_fields`.
- Secrets, credentials, auth headers, cookies, JWTs, database URLs,
  object-store credentials and provider API keys are never allowed raw fields.
- Policy admission is request-scoped. Agent-runtime must not infer it from
  process environment variables. Every non-`off` policy must name exactly one
  `request_id`, `run_id` and `trace_id`; app-api, execution-control and
  agent-runtime must reject scope drift instead of silently widening the policy.

## `llm_replay_packet.v1`

A replay packet is the restricted raw artifact used to reproduce, diagnose or
evaluate a run.

Required safe metadata:

- `schema_version`: `llm_replay_packet.v1`
- `packet_id`
- `run_id`
- `request_id`
- `trace_id`
- `created_at`
- `expires_at`
- `capture_policy`
- `llm_io_fingerprint`
- `sensitivity_classification`
- `object_checksum_sha256`
- `encryption_key_ref`
- `deletion_linkage`
- `retention`
- `access_audit`
- `evidence_replay_index`

Allowed raw sections when admitted by policy:

- `rendered_messages`
- `provider_request_body`
- `provider_response_body`
- `provider_stream_deltas`
- `tool_calls`
- `tool_results`
- `selected_evidence_packet`
- `selected_memory_context`
- `output_schema`

`evidence_replay_index.v1` is a safe evidence replay index:

- `schema_version`: `evidence_replay_index.v1`
- `evidence_packet_sha256`
- `evidence_profile_ref`
- `evidence_ref_count`
- `evidence_refs`

Each `evidence_refs` entry carries only `evidence_ref`, `evidence_sha256` and
`source_profile_ref`. It must not contain raw evidence text, snippets, document
body, raw retrieved context or backend-specific vector DB payload.

`replay_retention.v1` records retention and DSAR reachability:

- `schema_version`: `replay_retention.v1`
- `retention_class`
- `ttl_days`
- `created_at`
- `expires_at`
- `dsar_delete_linkage_required`
- `deletion_linkage_ref`

`replay_access_audit.v1` records the audit envelope required for raw packet
access:

- `schema_version`: `replay_access_audit.v1`
- `audit_required`
- `audit_log_ref`
- `access_policy_ref`
- `last_accessed_at`

Rules:

- Raw replay packets live in encrypted S3-compatible object storage.
- `object_checksum_sha256` is computed over the canonical replay packet content
  before adding `object_checksum_sha256` itself.
- PostgreSQL may store only replay index rows, safe metadata, object refs,
  checksums, TTL, retention state, policy state and access audit.
- App-api and Operator Console may show packet metadata, approval state, safe
  fingerprints and links, but must not inline packet raw body.
- Raw replay execution must be side-effect isolated. It must not write back to the
  user conversation, memory store, source-truth corpus or production tool targets.
- Raw sections must be present only when named by `allowed_raw_fields`.
- A raw packet with positive evidence count must include an evidence replay index
  that can locate the selected evidence by safe refs and hashes.
- Missing retention, DSAR linkage or access-audit envelope is a contract failure.

## `llm_replay_packet_index.v1`

The replay packet index is the app-api ingest and query contract for safe replay
metadata. It is not the raw packet body.

Required fields:

- `schema_version`: `llm_replay_packet_index.v1`
- `packet_id`
- `run_id`
- `request_id`
- `trace_id`
- `object_ref`
- `object_checksum_sha256`
- `sensitivity_classification`
- `capture_policy`
- `llm_io_fingerprint`
- `deletion_linkage`
- `encryption_key_ref`
- `created_at`
- `expires_at`
- `retention`
- `access_audit`
- `evidence_replay_index`

Optional fields:

- `approval_ref`
- `operator_principal`

Rules:

- `object_ref` is an S3-compatible object reference using the repo's `s3://`
  object-ref notation. It does not mean AWS S3 is the only supported backend.
- `run_id`, `request_id` and `trace_id` must match the embedded
  `llm_io_fingerprint`.
- `request_id` and `trace_id` must match `deletion_linkage`.
- `capture_policy` must itself satisfy `raw_capture_policy.v1`; non-`off` modes
  require positive TTL, non-empty sinks / raw fields, audit and DSAR deletion
  linkage.
- The index must not include raw replay sections such as `rendered_messages`,
  `provider_request_body`, `provider_response_body`,
  `provider_stream_deltas`, `selected_evidence_packet`,
  `selected_memory_context`, `tool_calls`, `tool_results`, raw prompt or raw
  answer.
- The index may include `evidence_replay_index`, but only with safe evidence
  refs and hashes. It must not inline the selected evidence packet body.
- The index is the only app-api query surface for replay metadata. Raw packet
  reads require the restricted artifact lane and access-audit record.

## `replay_result_diff.v1`

Replay output compares a replay execution with the original run. It is safe by
default and may enter eval or operator-safe summaries.

Required fields:

- `schema_version`: `replay_result_diff.v1`
- `packet_id`
- `run_id`
- `replay_run_id`
- `replay_mode`: `safe_replay` or `raw_replay`
- `answer_diff_summary`
- `tool_selection_diff`
- `evidence_diff`
- `schema_validity_diff`
- `latency_diff`
- `cost_diff`
- `provider_error_diff`
- `fingerprint_drift`
- `verdict`

The diff must not embed raw prompt, raw answer, raw evidence text, raw provider
body or raw memory text unless it is itself stored as a restricted raw replay
artifact under `raw_capture_policy.v1`.

## Replay Modes

`safe replay` rebuilds from safe refs, hashes, prompt registry attestation,
tool-runtime attestation, model params projection, provider request safe hash
and source truth. It is suitable for routine diagnostics, CI validation and
drift detection. It does not consume `llm_replay_packet.v1` raw sections.

`raw replay` consumes `llm_replay_packet.v1`. It is suitable for precise
badcase reproduction, LLM I/O diagnosis and restricted eval. It requires RBAC,
access audit, TTL, retention state and deletion linkage.

Neither mode promises byte-for-byte deterministic LLM output. Replay diagnoses
which input, tool, retrieval, memory, model, provider or release dimension
changed.

## Ownership

- `apps/app-api` owns policy management, replay index query, safe metadata
  projection, `llm_replay_packet_index.v1` ingest and access audit surfaces.
- `apps/agent-runtime` produces SDK trace/fingerprint facts for the complete
  primary/Knowledge Agent run under the admitted capture policy.
- `apps/execution-control` owns execution-boundary policy enforcement,
  correlation and sanitized replay refs; it does not perform a separate LLM
  call or answer capture path.
- Any admitted raw packet goes only to encrypted S3-compatible object storage;
  app-api receives `llm_replay_packet_index.v1` safe metadata. Prompt trace
  projections must not contain raw prompt text or provider payloads.
- `apps/agent-runtime` owns SDK trace sensitivity configuration only from the
  request-scoped policy result.
- `packages/eval-langfuse` may consume replay packets or derived safe samples for
  restricted eval workflows, but does not own raw packet storage.
- Langfuse and OpenAI trace stores are controlled sinks, not canonical replay
  packet stores.

## Privacy And Retention

Raw replay is personal-data-capable and must be governed as such.

Requirements:

- purpose limitation: diagnostics, badcase reproduction and eval only
- data minimization: no raw capture without policy admission
- storage limitation: explicit TTL for all raw packets
- access control: restricted operator/eval roles only
- audit: every raw packet read, export and replay is logged
- deletion linkage: user deletion or correction workflows can locate related raw
  packets, memory selections, trace links and eval artifacts
- DSAR: replay packet index and raw packet retention records must carry enough
  linkage for deletion, export review and correction workflows without exposing
  raw body through app-api
- processor boundary: external sinks require their own processor/vendor records

## Related Documents

- `docs/contracts/langfuse-runtime.md`
- `docs/contracts/stage-timing.md`
- `docs/contracts/app-api/observability.md`
- `docs/architecture/system/langfuse.md`
- `docs/architecture/system/learning-loop.md`
- `docs/architecture/system/prompt.md`
- `docs/decisions/adr-0069-raw-replay-capture.md`
