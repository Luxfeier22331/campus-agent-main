## internal_notice collection config

This directory holds the repo-tracked config scaffolding for the
`internal_notice` collection within the `campus_notices` corpus.

- `runtime-profile.json`: canonical runtime gate for bootstrap import plus serving policy
- `canonical-profile.json`: primary source unit, identity strategy, and projection notes
- `chunk-profile.json`: default structured-unit chunking profile for future restricted rollout
- `source-projections.v1.json`: offline source-truth replay contract for clean parent notices and derived attachment documents

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
