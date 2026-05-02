---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Summary: Phase 07 Legacy Wiki Login Federation Decision Gate

## Outcome

Legacy Wiki login federation is not implemented in this workstream.

Closed scope:

- Live MediaWiki remains native-account based for now.
- Hub/app-api does not become a MediaWiki login identity provider.
- Direct cookie/session reuse remains forbidden.
- Any future federation must use explicit MediaWiki auth extension or federation
  protocol planning.

## Verification

Verified through identity architecture docs and the workstream deferred/no-op
state.

## Residuals

Login federation remains deferred. Reopen only if the product explicitly wants
MediaWiki to trust hub/app-api as an identity provider.
