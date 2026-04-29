---
doc_type: plan
status: planned
created: 2026-04-27
updated: 2026-04-27
---

# Phase 4: Notice Consumption Projection Opening

## Goal

Open an offline notice-consumption lane for public WeChat official-account
articles without opening query-serving.

Phase 4 consumes Phase 3 `wechat_official_account` article source-truth
artifacts and materializes deterministic `wechat_public_notice` projection
candidates. It also records cross-source dedupe decisions so later notice
read-model and serving work never has to scan raw FeedWe/provider output at
query time.

## Boundaries

Phase 4 owns:

- `wechat_public_notice` source-family admission in notice-family contracts.
- WeChat article source-truth readers on the ingestion side.
- WeChat article source-truth to `notice_consumption_projection` mapping.
- deterministic cross-source dedupe against existing notice-family rows.
- optional read-model row construction for offline/operator evidence only.
- worker CLI entrypoints for selected source-truth refs or fixture replay.

Phase 4 does not own:

- FeedWe capture changes beyond consuming existing Phase 3 source-truth refs.
- article body crawling or browser rendering.
- document registry writes.
- chunking, embedding, Qdrant, release aliases, or RAG serving.
- Go notice runtime opening for `wechat_public_notice`.
- `campus_notice_discover` / `campus_notice_get` user-facing enablement.

## Source And Target Semantics

Source channel remains:

- `sourceChannel`: `wechat_official_account`

Notice-family source family added in this phase:

- `source_family`: `wechat_public_notice`

Projection scope:

- `source_corpus`: `campus_notices`
- `source_collection`: `wechat_public_notice`

Default candidate unit:

- `primary_role`: `notice_window`
- `semantic_owner`: `notice_body`
- `default_agent`: `notice-agent`
- `target_surface`: `notice_level_query`
- `temporal_policy`: `announcement_window`

Because Phase 3 is metadata-only, the first projection must preserve
`bodyState: "not_captured"` as a downstream fact. It must not fabricate article
body text. If a read-model row is built before article body capture exists, it
is offline/operator evidence only and must stay non-query-serving.

## Dedupe Policy

WeChat candidates are lower precedence than existing official or authenticated
notice truth.

Precedence order:

1. `internal_notice_restricted`
1. `official_web_public_notice`
1. `wechat_public_notice`

Deterministic dedupe keys:

- normalized source URL exact match
- normalized title plus publication day
- provider article id within the same account
- account slug plus normalized article URL

Initial dedupe behavior:

- If a WeChat article is unique, emit a `wechat_public_notice` candidate.
- If it duplicates `official_web_public_notice` or `internal_notice_restricted`,
  emit a suppressed audit entry with `target_surface=unsupported` and
  `consumption_status=no_adoption`.
- Preserve duplicate evidence in `role_metadata`:
  - `dedupe_status`
  - `dedupe_basis`
  - `duplicate_of_source_family`
  - `duplicate_of_notice_id`
  - `canonical_source_family`
  - `canonical_notice_id`

No dedupe rule may read raw provider bytes or perform query-time source scans.

## Implementation Tasks

### 1. Freeze Source-family Contract

- Add `wechat_public_notice` to `packages/contracts` notice source-family
  validation.
- Add tests proving `NoticeCard`, `CampusNoticeDiscoverPayload`, and
  `CampusNoticeGetPayload` accept `wechat_public_notice`.
- Add `NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC` in ingestion projection shared
  constants.
- Keep Go `apps/supervisor-api` notice runtime restricted to
  `internal_notice_restricted`; add/adjust tests showing `wechat_public_notice`
  still fail-closes with `source_family_unavailable`.

### 2. Add WeChat Source-truth Reader

- Add an ingestion-core module for WeChat article source-truth DTO parsing.
- Read only:
  - `article-manifest.json`
  - `content-blocks.jsonl`
  - `media-refs.jsonl`
- Validate:
  - `sourceChannel == "wechat_official_account"`
  - `bodyState == "not_captured"` is propagated, not ignored
  - stable identity exists from normalized article URL or provider article id
  - forbidden downstream fields are absent
- Support object-store reads and fixture/local bytes in tests.

### 3. Materialize Projection Entries

- Add a builder that maps WeChat article source-truth to
  `NoticeConsumptionProjectionEntry`.
- Use `articleStableId` or `rawAssetId` as `source_notice_id`, with a stable
  unit id derived from article identity and role.
- Populate role metadata with:
  - account name / slug
  - provider and provider article id
  - normalized article URL
  - publish time and source
  - title normalization
  - cover image refs
  - source-truth object keys
  - `body_state`
- Use existing `NoticeConsumptionProjectionStore` rather than introducing a new
  table.
- Add replace-by-selected-notices behavior; do not allow accidental persistent
  full-scope rebuilds without explicit source-truth refs or a selection file.

### 4. Add Cross-source Dedupe

- Build a deterministic dedupe index from existing
  `notice_consumption_projection` and/or read-model rows.
- Compare WeChat candidates against:
  - existing `official_web_public_notice`
  - existing `internal_notice_restricted`
  - same-source `wechat_public_notice`
- Apply precedence without deleting upstream source-truth.
- Mark suppressed duplicate WeChat entries as `unsupported/no_adoption`.
- Include dedupe counts in worker reports.

### 5. Add Offline Read-model Evidence Path

- Extend read-model entry construction so WeChat candidates can be converted to
  offline evidence rows without query-serving admission.
- Do not require document registry records for WeChat metadata-only source
  truth.
- For metadata-only rows:
  - title comes from source-truth title
  - source URL comes from normalized article URL
  - body excerpt is empty or title-only according to explicit test contract
  - provenance refs point to source-truth artifact keys
  - query-serving remains closed by Go runtime policy
- Keep `campus_notice_get` unavailable until canonical body support exists.

### 6. Add Worker CLI

- Add an ingestion-worker command such as
  `campus-ingestion-project-wechat-public-notices`.
- Inputs:
  - selected source-truth manifest refs, or
  - a JSON selection file containing article source-truth artifact refs.
- Outputs:
  - projection row count
  - retained candidate count
  - duplicate suppressed count
  - read-model evidence row count, if requested
  - no query-serving opening flag
- Record consumer admission provenance when writing persistent projection rows.

### 7. Update Documentation

- Update WeChat source-truth schema doc with Phase 4 projection handoff section.
- Update notice/runtime docs to list `wechat_public_notice` as admitted
  projection/read-model source family but not yet runtime-served.
- Update workstream `STATE.md` after implementation with verification evidence.

## Test Plan

Focused tests:

- `tests/contracts/contract_models_services_and_notice_suite.py`
  - `wechat_public_notice` is accepted in contracts.
- new ingestion-core tests
  - parse source-truth manifest/content/media refs.
  - reject malformed source channel or downstream fields.
  - build unique WeChat projection candidate.
  - suppress official-web duplicate by normalized title/publication date.
  - suppress internal notice duplicate by precedence.
  - keep metadata-only body state explicit.
- worker tests
  - selected source-truth refs are required.
  - persistent full-scope rebuild is refused.
  - report includes retained/duplicate/read-model counts.
- Go supervisor-api tests
  - `wechat_public_notice` remains fail-closed in notice runtime until an
    explicit runtime-opening phase.

Verification commands:

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_services_and_notice_suite \
  tests.ingestion.test_wechat_public_notice_projection \
  tests.ingestion.test_project_wechat_public_notices_worker

pnpm --filter wechat-official-account-core test
pnpm --filter wechat-official-account-core typecheck
pnpm --filter wechat-official-account-collector test
pnpm --filter wechat-official-account-collector typecheck
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts \
  test/wechat-official-account-command.service.test.ts \
  test/wechat-official-account-command.route.test.ts

go test ./apps/supervisor-api/...
uv run --all-packages ruff check \
  packages/ingestion-core apps/ingestion-worker tests/ingestion tests/contracts
uv run --all-packages ruff format \
  packages/ingestion-core apps/ingestion-worker \
  tests/ingestion tests/contracts --check
pnpm docs:lint
git diff --check
```

If repo-wide `pnpm web:lint` is still blocked by unrelated workstreams, keep
the Phase 4 touched-file Biome/Markdown checks explicit in the implementation
summary.

## Acceptance Criteria

- `wechat_public_notice` is an explicit notice-family source family in shared
  contracts.
- WeChat Phase 3 source-truth can materialize deterministic notice-consumption
  projection rows.
- The projection builder does not read raw FeedWe/provider output.
- Cross-source dedupe is deterministic and recorded in projection metadata.
- Duplicate WeChat candidates are suppressed without deleting source-truth.
- Metadata-only article rows do not fabricate body content.
- Go notice runtime still refuses `wechat_public_notice`.
- No document registry, chunking, index, release alias, or query-serving opening
  is introduced.
