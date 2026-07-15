---
doc_type: architecture
truth_scope: domain
owner_boundary: authenticated-notice
status: active
created: 2026-04-02
updated: 2026-07-13
---
# Authenticated Notice Sources

## Current Scope

This domain captures source evidence from authenticated internal-portal notice
and file-release surfaces and from a WeChat official account. It stops at
source manifests. It does not provide notice query, regulation promotion, OCR,
chunk/index publication, or a model-visible tool.

## Sources

| Registry task | Provider surface | Output |
| --- | --- | --- |
| `internal_portal.notice.capture` | authenticated notice listing/detail/attachments | `authenticated_notice_source_manifest.v1` |
| `internal_portal.file_release.capture` | authenticated file-release metadata and original files | `authenticated_file_release_source_manifest.v1` |
| `wechat_official_account.capture` | FeedWe discovery plus real WeChat article pages/media | `wechat_official_account_source_manifest.v1` |

All three run as `source_collector` Temporal activities. Requests and results
are digest-pinned object-store artifacts.

## Flow

```text
request artifact
-> ingestion-control v3 admission
-> Temporal workflow
-> source-collector provider capture
-> source artifacts + capture release + result manifest
-> bounded ingestion task projection
```

The collector may use Crawlee/Playwright and provider-specific authentication,
but it does not expose HTTP routes, write a run ledger, call app-api, or start
another ingestion task. Ingestion-control owns workflow start and terminal
projection; Temporal owns attempts, retry, timeout, heartbeat, and
cancellation.

## Internal Portal

`internal_portal.notice.capture` preserves notice metadata, body blocks,
attachment refs, and captured attachment bytes. The notice-family config is
loaded from
`configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json`
to produce deterministic source classification only.

`internal_portal.file_release.capture` is a sibling source, not a notice. Only
released files whose bytes were captured and verified enter the source
manifest. `reference_only` rows remain explicit capture evidence and cannot be
promoted to document holding or serving.

## WeChat

FeedWe is discovery/authentication infrastructure. Canonical source evidence is
the real `mp.weixin.qq.com` article page and media captured in the activity.
The collector writes article-level source truth and a run-level capture release
before producing the task result manifest.

## Storage And Privacy

- Provider credentials and cookies are source-collector secrets.
- Source bytes and detailed manifests are stored in the source bucket.
- Temporal stores workflow/activity state, not cookies or raw page bodies.
- PostgreSQL stores only the shared bounded ingestion task projection.
- App-api has no collector command, ledger, or source projection table.

## Serving Boundary

None of these sources is present in the online query-serving registry. A future
notice capability must define normalization, authorization, freshness,
publication, retrieval/tool contracts, and eval coverage together. Existing
source capture does not imply that capability.

## Related Documents

- `docs/data/authenticated-notice.md`
- `docs/data/wechat-official.md`
- `docs/contracts/file-release-export.md`
- `docs/architecture/system/data-plane.md`
- `docs/runbooks/notice-release-auth-window.md`
