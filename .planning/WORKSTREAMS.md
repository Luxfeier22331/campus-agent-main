# Active Work Signals

## Boundary

This file is the repository-level planning signal surface. It is not current
architecture, a completed-work ledger, a release closeout report or live
session state. GSD SDK and Codex sessions own live execution context; git
history owns retired planning history.

## Active Signals

### Official Web Consumption

Official Web collection and control-plane code exists, but no Official Web
target is query-enabled. Work may resume only from the target-first chain in
`docs/architecture/domains/official-web/architecture.md` and ADR-0070. Adding a
serving config or source artifact alone must not open Knowledge Agent access.

### Conversation Attachments

`docs/product/attachments.md` is an accepted product proposal, not implemented
product truth. The browser entry remains hidden until app-api transport,
storage, execution projection and deletion behavior are accepted and
implemented together.

## Deferred Signals

### Tool Expansion

Current model-visible runtime exposure is defined by
`configs/runtime/tools.v5.json`. Dining lookup, broader campus-services tools,
notice lookup and navigation tools require their own product requirement,
strict schema, internal query owner, evidence contract and eval denominator
before exposure changes.

### Reader Supplements

Original appendix or form downloads remain deferred. A future reader
supplement must belong to the same canonical document version and must not
label generated exports as original source files.

## No Current Repository-Wide Gap

This file does not declare a generic main-chain, RAG, eval, memory or runtime
profile migration gap. Those migrations are represented by current owner docs
and code. New work enters this file only when it has:

- one owner boundary;
- one durable requirement or decision link;
- a concrete reopen trigger;
- a clear condition for removing the signal.

## Recovery Rule

Do not restore `.planning/workstreams`, `.planning/quick`,
`.planning/legacy-flat`, `.planning/milestones`, `.planning/research`,
`.planning/todos`, `.planning/codebase` or `.planning/seeds`. Recover only the
specific still-valid fact from git history and place it in the correct current
document class.
