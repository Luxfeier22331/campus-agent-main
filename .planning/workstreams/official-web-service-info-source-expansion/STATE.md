---
doc_type: state
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# State

## Completed

- Added `met.muc.edu.cn` to official-web source config as a university support host.
- Added `met.muc.edu.cn` to consumer-candidate scheduler host filters.
- Added source-map admission for `met.muc.edu.cn` service/contact targets.
- Advanced `muc_public` target inventory to `muc_public_target_inventory_v3`.
- Added `muc-information-disclosure-contact`.
- Added `muc-it-student-campus-card-service-guide`.
- Fixed collector negative-pattern matching so page-type exclusions use title/URL instead of
  incidental body text.
- Added targeted core, collector and ingestion regression coverage.

## Blockers

None.

## Next Reopen Trigger

Reopen only when a new target-first service-info page is identified, multi-page composition becomes
the selected-write strategy for service guides, or the denominator for contact/service surfaces is
changed.
