---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0069
status: accepted
created: 2026-07-05
updated: 2026-07-05
---
# ADR-0069 Raw Replay Capture

## Context

The repository recently clarified that app-api, Operator Console, Temporal
metadata and repo-owned run / step projections must not carry raw prompt, raw
answer, raw transcript, raw provider payload, raw retrieved body or raw memory
text.

That safe-projection boundary is still correct. It prevents product observability
from becoming an uncontrolled data leak.

The same change also made current LLM debug trace behavior narrower than the
target diagnostic need: `include_model_io` is fixed to `false`, and current docs
can be read as if raw capture is generally forbidden. That is too restrictive
for chain diagnosis, badcase reproduction and eval. The OpenAI Agents SDK tracing
surface can capture generation and function inputs / outputs when sensitive trace
data is enabled; whether to use it is a repo governance decision, not an SDK
limitation.

The repository needs replay ability, but replay must not mean copying raw model
I/O into product projections or ordinary operator pages.

## Decision

Accept a separate restricted raw replay / capture data plane.

- Safe projection remains the default and remains raw-free.
- Raw or near-raw LLM I/O may be captured only through
  `raw_capture_policy.v1`.
- Replayable raw artifacts use `llm_replay_packet.v1`.
- Every run should produce a safe `llm_io_fingerprint.v1`.
- Replay comparisons use `replay_result_diff.v1`.
- Canonical replay packet ownership is repo-owned replay index plus encrypted
  S3-compatible object storage.
- Langfuse / OpenAI traces may act as controlled debug or eval sinks, but they do
  not replace replay packet truth.

`include_model_io=false` remains the default posture. It is no longer a permanent
contract prohibition. Enabling raw model I/O requires explicit policy admission,
RBAC, TTL, access audit, deletion linkage and sink allowlisting.

## Consequences

- App-api and Operator Console continue to consume only safe summaries, trace
  refs, replay packet metadata and deep links.
- Temporal metadata and repo-owned run / step projection must not store raw
  replay packet bodies.
- Eval can use restricted raw replay artifacts for badcase reproduction and
  diagnosis without turning ordinary eval datasets into raw production dumps.
- Runtime implementations must distinguish safe fingerprint construction from
  raw packet recording.
- Existing documentation that says raw prompts, answers or provider payloads are
  never sent to Langfuse must be narrowed to safe projection / score metadata /
  default eval datasets. Restricted raw debug and replay lanes are allowed only
  under policy.

## Alternatives Considered

### Keep raw capture fully disabled

Rejected. It preserves a simple privacy posture but prevents reliable diagnosis,
replay and eval of production LLM behavior.

### Put raw payloads in app-api projection

Rejected. App-api projection and Operator Console are product/ops surfaces, not
raw diagnostic stores. This would collapse the safe boundary.

### Let Langfuse be the only replay truth

Rejected. Langfuse is an observability and eval platform. Repo-owned replay needs
stable packet identity, object checksums, TTL, deletion linkage and access audit
that are independent of a vendor trace body.

### Store only hashes and never raw packets

Rejected. Hashes are enough for drift detection, not enough for reproducing
prompt assembly, evidence selection, memory context or provider payload issues.

## Privacy Boundary

Raw replay packets are personal-data-capable artifacts. They require purpose
limitation, minimization, TTL, RBAC, audit and deletion linkage. Secrets,
credentials, auth headers, cookies, JWTs, database URLs, object-store
credentials and provider keys remain forbidden in every lane.

## Related Documents

- `docs/contracts/replay-capture.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/contracts/stage-timing.md`
- `docs/contracts/app-api/observability.md`
- `docs/architecture/system/langfuse.md`
- `docs/architecture/system/learning-loop.md`
- `docs/architecture/system/prompt.md`
