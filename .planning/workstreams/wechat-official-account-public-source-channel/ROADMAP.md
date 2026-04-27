---
doc_type: roadmap
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: WeChat Official-Account Public Source Channel

## Overview

This workstream restores the historical backlog item as a native active
workstream. It admits FeedWe-backed public WeChat article acquisition and
routes collected content into notice consumption.

## Phases

- [x] **Phase 1: Source Admission And FeedWe Provider Contract**
  - Freeze `wechat_official_account` as a separate source channel.
  - Record FeedWe endpoint/auth contract and secret posture.
  - Decide notice-family source family / target surface names.

- [x] **Phase 2: Capture And App-api Control-plane Handoff**
  - Implement or scaffold FeedWe capture into the existing MinIO source bucket
    through the repo's existing `OBJECT_STORE_*` interface and file-architecture
    conventions.
  - Add app-api run ledger / artifact refs / operator status.
  - Keep collector away from document registry, index, and query runtime.

- [x] **Phase 3: WeChat Article Source-truth And Replay Contract**
  - Define provider-agnostic source-truth schema.
  - Normalize article identity, account identity, content hash, media refs,
    publish time, and deletion/update posture.
  - Add replay validator and fixture-backed tests.

- [ ] **Phase 4: Notice Consumption Projection Opening**
  - Add `wechat_public_notice` into notice-family consumption/read-model
    semantics.
  - Materialize public notice candidates without query-time source scans.
  - Add cross-source dedupe against official-web reposts and authenticated
    notice references.

- [ ] **Phase 5: Acceptance Evidence And Planning Closeout**
  - Run real FeedWe sample capture and replay.
  - Verify notice discover/get behavior stays gate-controlled.
  - Record residual provider/compliance risks and close the workstream.

## Guardrails

- FeedWe is acquisition only; the existing MinIO source bucket and app-api
  ledger own repo truth.
- WeChat public articles do not become `official_web` pages.
- Phase 2 must reuse ADR-0002 `capture/`, `provider/`, `source-truth/`, and
  `projection/` conventions instead of inventing a new file layout.
- Query-serving remains closed until Phase 4/5 explicitly admits notice runtime.
- No private WeChat content, logged-in content, group chat, or direct user data.
