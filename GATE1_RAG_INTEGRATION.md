# Gate 1 RAG Integration Materials

This document publishes the bootstrap integration surface required for Gate 1 between `campus-agent` and `campusRag`.

## Workflow-side expected payloads

### `campus_rag_search`

```json
{
  "query": "library hours",
  "corpora": ["student_handbook"],
  "filters": {
    "audience": "student"
  },
  "debug": false
}
```

### `campus_rag_answer`

```json
{
  "query": "Where is the library service desk?",
  "corpora": ["student_handbook"],
  "filters": {
    "audience": "student"
  },
  "debug": false
}
```

## Adapter call shape to current runtime

### Shared header rules

- Canonical workflow trace headers remain authoritative in workflow state and adapter wrapping:
  - `x-trace-id`
  - `x-parent-run-id`
  - `x-tool-call-id`
- Current runtime request id rule:
  - `X-Request-ID = x-tool-call-id`
- Canonical actor headers map to current runtime compatibility headers:
  - `x-actor-user-id -> x-rag-user-id`
  - `x-actor-roles -> x-rag-roles`
  - `x-actor-departments -> x-rag-departments`
  - `x-actor-groups -> x-rag-groups`
  - `x-campus-scope -> x-rag-campus-scope`
- Derived compatibility header:
  - `x-rag-authenticated = true` when `x-actor-user-id` is present, otherwise `false`

### `campus_rag_search` runtime request

```http
POST /api/search
Authorization: Bearer <token>
X-Request-ID: <x-tool-call-id>
x-caller-service: campus-agent
x-rag-user-id: <x-actor-user-id>
x-rag-roles: <csv roles>
x-rag-departments: <csv departments>
x-rag-groups: <csv groups>
x-rag-campus-scope: <x-campus-scope>
x-rag-authenticated: <derived boolean>
x-trace-id: <canonical trace id>
x-parent-run-id: <canonical parent run id>
x-tool-call-id: <canonical tool call id>
Content-Type: application/json
```

```json
{
  "query": "library hours",
  "corpora": ["student_handbook"],
  "filters": {
    "audience": "student"
  },
  "debug": false
}
```

### `campus_rag_answer` runtime request

```http
POST /api/answer
Authorization: Bearer <token>
X-Request-ID: <x-tool-call-id>
x-caller-service: campus-agent
x-rag-user-id: <x-actor-user-id>
x-rag-roles: <csv roles>
x-rag-departments: <csv departments>
x-rag-groups: <csv groups>
x-rag-campus-scope: <x-campus-scope>
x-rag-authenticated: <derived boolean>
x-trace-id: <canonical trace id>
x-parent-run-id: <canonical parent run id>
x-tool-call-id: <canonical tool call id>
Content-Type: application/json
```

```json
{
  "query": "Where is the library service desk?",
  "corpora": ["student_handbook"],
  "filters": {
    "audience": "student"
  },
  "debug": false
}
```

### Runtime truth notes

- Bootstrap default corpus is `student_handbook`, matching Agent 1's current tracked registry default.
- This avoids direct `unknown_corpora` failures that would occur if bootstrap kept sending `handbook`.
- Current `/api/answer` flat payload truth is:
  - `answer_type = "answer"`
  - `answer_artifact_version = "v1"`
  - `render_mode = "compat_text"`
  - `artifact` must be non-null
  - `sources[]` must retain citation locator fields such as `doc_id`, `version_id`, `chunk_id`, `anchor`, `acl_level`, `canonical_url`, and `latest_url`

## Canonical wrapping rules

- Current flat `/api/search` and `/api/answer` payloads are wrapped into the canonical common response envelope.
- Canonical `request_id` uses the effective downstream request id returned by runtime handling, defaulting to `x-tool-call-id`.
- Canonical `trace_id` remains the workflow-side canonical trace id.
- Runtime conformance is not assumed during bootstrap; the adapter owns compatibility.
- FastAPI `detail` error payloads are normalized into the canonical error envelope:

```json
{
  "ok": false,
  "tool_name": "campus_rag_search",
  "contract_version": "v1",
  "request_id": "req_unknown_corpora",
  "trace_id": "trace_001",
  "error": {
    "code": "unknown_corpora",
    "message": "Unknown corpora requested: handbook",
    "retryable": false
  }
}
```

## Workflow/state boundaries retained for later agents

- Directory, map, and navigation tools are declared in the workflow registry but intentionally unimplemented.
- Workflow state persists core frozen fields plus two extension containers:
  - `actor_context.snapshot`
  - `hitl_context` / `extension_state`
- Those containers exist to avoid freezing `P-003` prematurely while keeping runs resumable.
