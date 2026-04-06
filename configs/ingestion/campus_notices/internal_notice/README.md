## internal_notice collection config

This directory holds the repo-tracked config scaffolding for the
`internal_notice` collection within the `campus_notices` corpus.

- `runtime-profile.json`: canonical runtime gate for bootstrap import plus serving policy
- `canonical-profile.json`: primary source unit, identity strategy, and projection notes
- `chunk-profile.json`: current generic runtime defaults for chunk preparation admission
- `source-projections.v1.json`: offline source-truth replay contract for clean parent notices and derived attachment documents
- `docs/reference/internal-notice-offline-preparation-strategy.md`: collection-specific offline preparation and lane strategy
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`: collection-specific quality acceptance criteria before any index release

Current runtime truth:

- source channel: `authenticated_notice_portal`
- primary source unit: `notice`
- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- collection visibility baseline: `restricted`
- default entitlement baseline: `campus_members`

`internal_notice` is the first restricted rollout target for authenticated portal notices.
It is intentionally isolated from public surfaces and should not be exposed as a default
query-serving collection until restricted document authorization, projection, and leakage
guards are verified end-to-end.

Offline source-truth replay rules:

- parent notice documents only carry notice body structure
- attachment refs remain in source-truth and do not participate in parent chunk identity
- downloaded attachments are materialized as derived restricted child documents

Current chunk-preparation truth:

- parent notice and attachment child docs must not share one global quality target
- the current `220/320/32/32` values are generic runtime defaults, not the final lane-specific semantic policy
- verified chunk preparation is a separate stage from `release_registry_scope`
- `release_registry_scope` now requires an explicit successful `preparation_run_id`
- structural preparation pass is not quality acceptance; attachment cleanup / extraction / chunk quality must be accepted separately
