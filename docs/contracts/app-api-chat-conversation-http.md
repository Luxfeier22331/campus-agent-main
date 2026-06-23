---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-10
updated: 2026-06-21
---
# App API Chat Conversation HTTP Contract

## Boundary

`apps/app-api` owns conversation truth: conversation rows, messages, run
association, user-side archive/pin/delete state, answer feedback, and edit
truncation. Browser surfaces, including `campus-web`, only render a UI
projection and send commands through this contract.

`campus-web` Q&A uses assistant-ui primitives for the browser experience, but
the wire contract is app-api-owned durable lifecycle SSE:
`POST /api/chat/requests/stream` creates or continues a run, and
`GET /api/chat/runs/:runId/events/stream` resumes run event consumption.
Conversation list/detail/search, feedback, run events and cancel remain
explicit app-api routes; they are not a second browser-side conversation truth.

This contract does not define token delta streaming, share/export, file upload,
batch management, or local browser-only conversation truth.

## Authorization Rules

- Every route requires a resolved end-user session principal with chat access.
- Conversation routes require current user ownership.
- Run routes require current user ownership of the run.
- Soft-deleted conversations are not returned by list, search, or detail routes.
- Search never matches raw trace fields, source refs, provider internals, or
  runtime error internals.
- Error responses use `docs/contracts/app-api-error-model.md`.

## Conversation Summary

```ts
type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  pinnedAt: string | null;
};
```

Pinned conversations sort before non-pinned conversations. Within each group,
results sort by `updatedAt desc`.

## Browser Product Usage

The default Q&A sidebar uses the `active` conversation view only. It presents
new chat and chat search as primary commands, then active conversation history.
Archived conversations are still part of the conversation management contract,
but they are surfaced only from a deeper account settings history-management
entry. The main sidebar and primary chat search do not expose archived
conversations as a top-level view.

## Routes

### `GET /api/chat/conversations`

Query:

- `view`: optional `active | archived`, default `active`
- `limit`: optional integer, default `50`, maximum `100`

Response:

```ts
type ConversationListResponse = {
  conversations: ConversationSummary[];
};
```

Rules:

- `active` returns `deletedAt IS NULL AND archivedAt IS NULL`.
- `archived` returns `deletedAt IS NULL AND archivedAt IS NOT NULL`.
- The response does not embed message history.

### `GET /api/chat/conversations/search`

Query:

- `q`: required non-empty search query after trim
- `view`: optional `active | archived`, default `active`
- `limit`: optional integer, default `20`, maximum `50`

Response:

```ts
type ConversationSearchResponse = {
  query: string;
  conversations: ConversationSummary[];
};
```

Rules:

- Search matches conversation title and message text.
- Search does not match trace IDs, source references, provider names, internal
  errors, or observability payloads.

### `POST /api/chat/conversations`

Creates an explicit draft conversation.

Response:

```ts
type ConversationCreateResponse = {
  conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: [];
  };
};
```

The browser may skip this route and submit the first prompt directly through
`POST /api/chat/requests/stream`.

### `GET /api/chat/conversations/:conversationId`

Returns the current user's non-deleted conversation detail with messages and
message feedback state.

### `PATCH /api/chat/conversations/:conversationId`

Request:

```ts
type RenameConversationRequest = {
  title: string;
};
```

Response:

```ts
type ConversationMutationResponse = {
  conversation: ConversationSummary;
};
```

Rules:

- `title` is trimmed server-side.
- Trimmed title length must be 1 to 80 characters.
- Empty or overlong titles return a validation error.
- The server does not auto-generate a title for this command.

### `DELETE /api/chat/conversations/:conversationId`

Soft-deletes the conversation for the current user.

Response:

```ts
type DeleteConversationResponse = {
  deleted: true;
};
```

Rules:

- Delete sets `deletedAt`.
- List, search, and detail do not return deleted conversations.
- Physical retention and cleanup are separate data-retention work.

### `POST /api/chat/conversations/:conversationId/archive`

Archives the conversation and returns the updated summary.

### `DELETE /api/chat/conversations/:conversationId/archive`

Unarchives the conversation and returns the updated summary.

### `POST /api/chat/conversations/:conversationId/pin`

Pins the conversation and returns the updated summary.

### `DELETE /api/chat/conversations/:conversationId/pin`

Unpins the conversation and returns the updated summary.

### `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`

Deletes the target message and every later message in that conversation.

Rules:

- This route only truncates the conversation tail.
- Editing and resending a prompt is a two-step browser command:
  first trailing delete, then `POST /api/chat/requests/stream` with the edited
  prompt.

### `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`

Submits or updates answer feedback.

Rules:

- `vote` is `helpful | unhelpful`.
- `reasonCodes` are only accepted for `unhelpful`.
- Assistant error messages do not accept feedback.

### `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`

Removes the current user's feedback from the target assistant message.

### `POST /api/chat/requests/stream`

Creates or continues a conversation and streams lifecycle events.

Rules:

- This route streams lifecycle events, not token deltas.
- `request.accepted` contains `runId` when the durable run has been created.
- `request.completed` may contain the app-owned answer projection on the
  original request stream.
- Browser disconnect does not cancel finalization.

### `POST /api/chat/runs/:runId/cancel`

Requests cancellation for a non-terminal owned run.

Rules:

- Only the owner can cancel a run.
- Terminal runs return a typed non-retryable error.
- A successful cancel request does not synthesize an answer.

### `GET /api/chat/runs/:runId`

Returns the current user's durable run summary.

Rules:

- Only the owner can read the run.
- The response is a product runtime summary, not raw execution-control storage.

### `GET /api/chat/runs/:runId/events`

Returns browser-visible durable run events for an owned run.

Query:

- `after_sequence`: optional non-negative integer cursor

Rules:

- This route returns browser-visible events only.
- This route does not create a new request or re-run execution.

### `GET /api/chat/runs/:runId/events/stream`

Resumes browser-visible run events for an owned run.

Query:

- `after_sequence`: optional non-negative integer cursor

Rules:

- This route does not create a new request.
- This route does not re-run execution or finalization.
- The browser resumes from the latest consumed event sequence.
- Resume stream events are browser-facing chat lifecycle events. Terminal
  `request.completed` events notify completion only; the browser must refresh
  `GET /api/chat/conversations/:conversationId` to render the app-owned answer
  projection.

### `GET /api/chat/runs/:runId/steps`

Returns the current user's sanitized durable run step trajectory.

Rules:

- Only the owner can read the run step trajectory.
- The response contains sanitized `steps`, `attempts`, `results`, and the
  product `run` summary.
- The response is not a raw execution-control `/steps` browser passthrough.
- Browser and smoke consumers can use it to verify step-level projection such
  as `memory.recall` completion without relying on answer text.
