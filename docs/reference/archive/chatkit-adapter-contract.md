---
doc_type: reference
truth_scope: product
owner_boundary: apps/chatkit-adapter
status: historical
created: 2026-06-12
updated: 2026-06-23
---
# Campus Web ChatKit Adapter Contract

> Legacy: `campus-web` Q&A no longer consumes `/api/chatkit` or the ChatKit
> browser runtime. Current student Q&A uses `/api/chat/assistant-ui`. This file
> only documents the retired backend adapter seam.

## Boundary

This is a historical contract for the retired ChatKit experiment. It does not
describe the current `campus-web` Q&A runtime, which uses assistant-ui primitives
and `/api/chat/assistant-ui`.

The retired browser path called:

`campus-web /api/chatkit -> app-api /api/chatkit -> apps/chatkit-adapter /chatkit`

`apps/chatkit-adapter` was an internal protocol adapter. It did not generate
answers, own conversation truth, write database rows directly, or call
`execution-control`. It translated ChatKit thread/item/action/event protocol to
explicit `apps/app-api` chat commands and projections.

`apps/app-api` remains the owner of auth/session/principal, conversation rows,
message rows, feedback, run command/query/cancel, source-card-safe projections,
and browser-facing route admission.

`apps/execution-control` remains the execution engine behind app-api run
creation, cancellation, and lifecycle events.

## Identity And Admission

- Browser requests to `/api/chatkit` require an app-api resolved end-user
  principal with chat access.
- `app-api` forwards the raw ChatKit request body to `chatkit-adapter` with:
  - `x-app-internal-auth`
  - `x-app-campus-principal-id`
  - `x-app-campus-principal-type`
  - display name / email headers when available
  - actor roles / departments / cohort / major / program when available
  - entitlement snapshot / groups / visibility / applicability / ownership
    projection when available
- Browser cookies are not forwarded to `chatkit-adapter`.
- Adapter calls back to app-api through explicit chat routes using the signed
  internal principal headers.
- Missing service credential, missing adapter URL, invalid principal, unknown
  conversation, or cross-user ownership fails closed.

## Protocol Mapping

| ChatKit concept | Campus truth |
| --- | --- |
| thread | app-api conversation |
| thread metadata | `ConversationSummary` |
| thread item | app-api message projection |
| user message item | app-api chat request command input |
| assistant message item | app-api finalized answer projection |
| history load | `GET /api/chat/conversations` |
| thread load | `GET /api/chat/conversations/:conversationId` |
| rename thread | `PATCH /api/chat/conversations/:conversationId` |
| delete thread | `DELETE /api/chat/conversations/:conversationId` |
| response stream | `POST /api/chat/requests/stream` |
| stream cancel | `POST /api/chat/runs/:runId/cancel` |
<!-- markdownlint-disable-next-line MD013 -->
| retry / edit cleanup | `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing` |
<!-- markdownlint-disable-next-line MD013 -->
| feedback | `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback` |

## Stream Event Mapping

`chatkit-adapter` consumes app-api lifecycle SSE events and emits ChatKit stream
events:

- `execution.queued` -> progress update
- `execution.running` -> progress update
- `request.accepted` -> progress update and cancellable stream state
- `request.completed` -> assistant thread item with structured content
- `request.failed` -> terminal ChatKit error event
- `request.cancelled` -> terminal stopped event

The adapter must not expose `runId`, `traceId`, provider names, raw execution
events, source refs, or runtime internals to the browser UI.

The adapter records the currently accepted `runId` only as transient in-process
stream state so ChatKit stream cancellation can call the app-api cancel command.
Terminal app-api lifecycle events clear that transient state. The adapter must
not persist run state or become a second run truth owner.

## Adapter Runtime Configuration

`apps/chatkit-adapter` requires:

- `APP_API_INTERNAL_BASE_URL`
- `APP_API_INTERNAL_SHARED_SECRET`

Missing or invalid runtime configuration fails closed. The adapter must not
default to a localhost app-api URL, because that would hide deployment
configuration defects.

The forwarded internal principal headers must preserve the current app-api
principal projection. The adapter callback path must not reconstruct a weaker
default authorization context from only `principalId` and `principalType`.

## Retry And Edit

ChatKit retry/edit operations remove trailing items before submitting the next
prompt. The adapter maps that cleanup to app-api trailing delete:

`DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`

The adapter must not delete rows directly and must not emulate retry/edit with
browser-local state.

## Structured Content

Answer text, clarification, no-answer, and error semantics remain typed at
app-api. The adapter projects them to ChatKit items without changing the answer
truth.

`source_items` must preserve:

- title
- section title or snippet
- publisher / trust / version labels
- canonical `/docs/...?...#...` href

The first implementation uses ChatKit URL annotations for source cards. If a
future widget implementation replaces annotations, it must preserve the same
canonical href and labels. Source cards must not be flattened into unlinked
markdown text.

`place_card` maps to structured ChatKit content or widget content with place
name, campus, description, and tags. It must not turn into a guessed route,
feedback prompt, or plain hidden metadata.

## Historical Browser Integration

In the retired ChatKit experiment, `campus-web` owned:

- Q&A product shell
- account modal and account menu
- support navigation
- same-origin `/api/chatkit` route admission through the Worker allowlist
- CSP/static-asset admission for the self-hosted ChatKit web component runtime
  mirror under `/vendor/openai-chatkit/<runtime-version>/`

ChatKit owned the central thread UI, history panel, history search, composer,
retry, stop, feedback controls, rename/delete actions, and thread item rendering.

The browser runtime was the OpenAI ChatKit web component mirrored as versioned
same-origin campus-web static assets. `@openai/chatkit-react` provides React
bindings and configuration; it does not replace the web component runtime. The
custom API config must point to the same-origin `/api/chatkit` endpoint and carry
the registered domain key for the campus integration.

Unauthenticated ChatKit requests are handled by request intent:

- active user actions such as creating a thread, adding a user message, retrying,
  or custom actions may open the campus account modal when `/api/chatkit`
  returns `401`
- passive loads such as history/thread/item list requests must not open the
  account modal on page load
- successful modal login refreshes campus session state and closes the modal; it
  does not automatically replay the original ChatKit request

Current `campus-web` must not reintroduce this ChatKit browser path, a second
self-built message/composer/run-state path, or a self-built conversation
search/history path for `/` or `/c/:conversationId`.

Raw adapter, network, stack, provider, run, trace, staging, federation, or OAuth
diagnostics must be logged only through internal telemetry/console paths. User
copy is limited to product-level messages such as login-required, temporary send
failure, or runtime load failure.

## Out Of Scope

- Agent Builder hosted workflow
- hosted ChatKit auth flow
- attachments
- voice
- model picker
- share/export
- browser-local conversation truth
- direct adapter database writes
- direct adapter calls to `execution-control`
