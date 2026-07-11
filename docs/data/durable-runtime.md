---
doc_type: data
truth_scope: data
owner_boundary: apps/execution-control
status: active
created: 2026-06-04
updated: 2026-07-11
---
# Durable Agent Runtime Schema

## Boundary

This document owns the logical sanitized projection model for online execution.
Temporal history remains execution truth; PostgreSQL projection supports
app-api, Operator Console, eval and diagnostics.

## Core Records

### Run

A run binds conversation, turn, request, trace, owner, surface, lifecycle,
runtime versions, selected tool/handoff, terminal reason and finalization ref.

Run status follows the admitted lifecycle and cannot be inferred from browser
connection state. Terminal state is monotonic.

### Run Event

Run events provide ordered sanitized lifecycle and streaming facts. Event
sequence is monotonic within a run. Payloads contain safe refs and summaries,
not raw prompts, transcripts, provider responses or source bodies.

### Step, Attempt And Result

Step projection describes the four workflow phases:

- `memory_recall`;
- `agent_activity`;
- `finalization`;
- `memory_append`.

Attempt projection may include Temporal queue/worker identity, attempt number,
timestamps, duration, retry/cancel/timeout outcome, provider/model-safe identity,
usage and estimated cost.

Result projection contains status, result kind/ref, fail-close reason and safe
metadata. It does not turn SDK-internal handoffs or function calls into a second
workflow graph.

## Agent Activity Projection

The Agent Activity represents one complete OpenAI Agents SDK run. Its sanitized
metadata may include:

- primary/last-agent identity;
- available and selected model-visible tools;
- Knowledge Agent handoff occurrence;
- SDK function-tool invocation summaries;
- provider response/trace refs;
- input, output and cached token counts;
- structured terminal outcome.

SDK state, raw messages and raw function payloads are not stored in canonical
projection.

## Knowledge Search Projection

Each internal `knowledge_search` invocation is correlated to the run and SDK
invocation id. Safe projection includes:

- admitted query shape/hash;
- resolved scope and version;
- found/no-evidence outcome;
- bounded evidence refs and source identity;
- result ref, latency and fail-close reason.

Raw query vectors, Qdrant payloads, provider responses and unrestricted snippets
are forbidden.

## Finalization Projection

Finalization stores the SDK terminal answer and deterministic validation result.
For evidence-backed answers it also stores browser-safe sources derived from
trusted `knowledge_search` evidence.

Finalization may reject malformed or unsupported output, but it does not create
or rewrite answer text. App-api may convert validated sources into product
source-item shape while preserving answer text.

## Terminal And Failure Data

Cancellation, timeout, fail-close, late completion, provider abort proof and
missing usage must be attributable to the owning phase or internal tool call.
Human-facing error text does not replace low-cardinality terminal/fail-close
codes.

Late success cannot overwrite an already terminal run or phase result.

## Data Safety

Canonical projection must not contain:

- raw prompt, transcript or model output payload;
- raw provider request/response or SDK state;
- raw memory payload or vendor ids;
- auth token, cookie or credential;
- raw source body, Qdrant point or object-store bytes;
- local filesystem path.

## Read Models

App-api materializes browser and operator read models from these projections.
Browser responses receive only finalized answer, approved source items and
public status/error fields. Operator diagnostics receive safe lifecycle,
phase/tool summaries and correlation refs, never raw execution payloads.

## Related Documents

- `../contracts/durable-runtime.md`
- `../contracts/tool-execution.md`
- `../architecture/system/durable-runtime.md`
