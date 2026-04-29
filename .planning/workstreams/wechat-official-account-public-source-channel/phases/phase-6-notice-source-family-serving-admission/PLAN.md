---
doc_type: phase_plan
phase: "6"
phase_name: "Notice Source-family Serving Admission"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 6 Plan

## Objective

Admit `wechat_public_notice` into the existing `campus_notice_discover` /
`campus_notice_get` runtime as a normal notice `source_family`, not as a
separate WeChat runtime.

This phase closes the gap between:

- already completed WeChat capture and notice consumption projection
- missing query-serving read model materialization
- Go notice runtime still hard-coding `internal_notice_restricted`

## Scope

Phase 6 owns:

- notice source-family admission policy in Go `supervisor-api`
- WeChat projection materialization into the notice read model
- reference-only `campus_notice_get` semantics for public notice rows that have
  title / URL / metadata but no captured body
- tests and smoke evidence proving WeChat notices are served through the same
  notice tools as other notice families

Phase 6 does not own:

- FeedWe provider contract changes, scraping semantics, or SLA guarantees
- body capture for WeChat article HTML
- generic retrieval / RAG indexing of WeChat content
- promotion of WeChat articles into `regulations/*`, `curriculum/*`, or
  `official_web`
- opening private / logged-in / group-chat WeChat content

## Target State

`campus_notice_discover` admits source families by policy:

- `internal_notice_restricted`: requires restricted authorization and
  entitlement groups
- `wechat_public_notice`: public notice family; no restricted entitlement
  requirement
- `official_web_public_notice`: public notice family; no restricted entitlement
  requirement

`campus_notice_get` resolves by source family:

- restricted internal notices keep current body-required behavior
- public WeChat notice rows may resolve as metadata / reference-only when
  `canonical_markdown_object_key` is empty
- reference-only results must include `source_url`, title, published time,
  target surface, and provenance refs where available

## Implementation Slices

### Slice 1: Freeze Source-family Policy

- Replace `internalNoticeSourceFamilies()` with a policy helper that:
  - normalizes requested `source_families`
  - rejects unknown families
  - defaults omitted source families to families visible to the current
    principal
  - separates public families from restricted families
- Preserve fail-close for:
  - unknown source families
  - restricted family without restricted authorization
  - empty admitted family set

Acceptance:

- Go tests prove `wechat_public_notice` is admitted without restricted
  entitlement.
- Go tests prove `internal_notice_restricted` still requires restricted auth.
- Unknown families continue to return `source_family_unavailable`.

### Slice 2: Materialize WeChat Into Notice Read Model

- Extend `project_wechat_public_notices` from evidence-only output to optional
  read-model write.
- Reuse existing notice read-model store shape instead of inventing a WeChat
  table.
- Map WeChat fields:
  - `source_family = wechat_public_notice`
  - `source_collection = wechat_public_notice`
  - `source_notice_id = articleStableId`
  - `source_url = normalized_article_url`
  - `title = titleNormalized/titleRaw`
  - `published_at = publish_time`
  - `target_surface = notice_level_query`
  - `body_excerpt = title/summary only`
  - `canonical_markdown_object_key = ""` until body capture exists
  - `queryable = true` only for retained notice-level rows
- Keep source-truth refs in `record` / provenance metadata.

Acceptance:

- Worker tests verify non-dry-run projection can write one
  `internal_notice_read_model` row for `wechat_public_notice`.
- The write must be source-collection scoped and must not erase internal notice
  rows.
- DB smoke shows `internal_notice_read_model` count for
  `source_collection=wechat_public_notice` is greater than zero.

### Slice 3: Reference-only Notice Get

- Update Go `campus_notice_get` so public notice families can return a
  reference-only response when no canonical body object is present.
- Do not use this relaxation for `internal_notice_restricted`.
- Add explicit outcome or field semantics so callers can distinguish:
  - full body resolved notice
  - reference-only public notice
  - temporarily unverifiable source truth

Acceptance:

- `campus_notice_get` for a WeChat notice without body returns `200` with title
  and `source_url`.
- It does not fabricate `normalized_body`.
- Internal restricted notices with missing body continue to fail closed.

### Slice 4: Runtime And Finalizer Wiring

- Ensure `campus_notice_discover` cards can expose WeChat `source_url`.
- Ensure finalizer / response observation keeps `notice_source_family_summary`
  accurate when cards include public source families.
- Ensure planner payloads can request or default to public notice families
  without hardcoding WeChat-specific tool names.

Acceptance:

- Go structured query tests cover discover/get for `wechat_public_notice`.
- HTTP handler tests prove the structured tool path hands the source family
  through unchanged.
- Final answer metadata records `wechat_public_notice` as notice source family,
  not as a separate runtime target.

### Slice 5: End-to-end Local Smoke

- Run a real local sequence:
  - FeedWe capture with app-api control-plane
  - projection from `--capture-run-id`
  - read-model materialization
  - Go `campus_notice_discover`
  - Go `campus_notice_get`
- Capture evidence:
  - capture run id
  - source URL
  - projection row count
  - read-model row count
  - discover/get runtime outcome

Acceptance:

- The smoke returns the sample WeChat article URL from
  `campus_notice_discover`.
- `campus_notice_get` returns reference-only result for the same notice.
- Query serving remains scoped to admitted notice tools; no generic RAG
  serving alias is opened.

### Slice 6: Planning And Guardrail Closeout

- Update workstream state and closeout summary.
- Remove or rewrite old tests that assert WeChat source family must fail-close.
- Add guard wording that future public notice source families must join the
  unified notice source-family policy, not create a new runtime.

Acceptance:

- Workstream Phase 6 summary records what is now open and what remains closed.
- `wechat_public_notice` is no longer described as a separate runtime.
- Residual body-capture / provider-retention risks remain explicitly deferred.

## Verification

Required focused verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_project_wechat_public_notices_worker
uv run --all-packages python -m unittest tests.ingestion.test_wechat_public_notice_projection
pnpm --filter wechat-official-account-collector test
pnpm --filter wechat-official-account-collector typecheck
go test ./internal/structuredquery -run Notice
go test ./internal/httpapi -run Notice
pnpm docs:lint
git diff --check
```

Required local smoke:

```bash
pnpm --filter app-api dev
pnpm --filter wechat-official-account-collector capture -- \
  --account "中央民族大学学生会" \
  --max-pages 1 \
  --max-articles 5 \
  --require-control-plane \
  --app-api-base-url http://127.0.0.1:8787 \
  --service-token "$WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN"

uv run --all-packages campus-ingestion-project-wechat-public-notices \
  --capture-run-id "<capture_run_id>"
```

The final smoke report must include the concrete `mp.weixin.qq.com` article URL
returned through notice discover/get.

## Residual Risks

- FeedWe retention, rate limits, deletion/update semantics, and SLA remain
  provider risks. They do not block source-family serving admission for already
  captured source-truth artifacts.
- WeChat article body capture remains deferred. Phase 6 only opens
  metadata/reference-only serving for public notice cards.
- The table name `internal_notice_read_model` is semantically narrow. Phase 6
  may use it as the current physical table because its schema already supports
  `source_family/source_collection`, but a later data-plane cleanup should
  rename or abstract it as `notice_read_model`.
