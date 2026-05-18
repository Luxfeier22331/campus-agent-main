---
doc_type: plan
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Collection Execution Plan

## Execution Principle

Collection starts from a validated source-pack manifest, not from hosts, seeds, sections or broad
frontier discovery.

The collector may discover links for provider/debug artifacts, but discovered links are not admitted
as source-pack rows unless they are explicitly added to the manifest and validated in a later run.

## Execution Chain

```text
source-pack manifest
-> manifest validation
-> app-api target workset
-> official-web collector one-time capture
-> source artifact validation
-> QC report
-> ingestion handoff / replay dry-run
```

## Preferred Local Path

For a single row or small batch, use the existing target-first no-promotion live seam shape:

```bash
uv run --all-packages python scripts/official_web_live_seam_no_promotion.py \
  --site-id muc_public \
  --host <manifest-host> \
  --target-id <manifest-entry-or-target-id> \
  --target-url <manifest-url> \
  --max-pages-per-host 1 \
  --max-total-pages 1
```

The pack-level implementation should wrap this row-by-row shape or add a batch entrypoint that keeps
the same invariants:

- explicit URL
- explicit target identity
- one retained source-truth page per manifest row unless source returns non-success
- no current-truth promotion
- no host-discovered URL admission

An artifact-only local workset may be used only for extractor or source-truth unit/dev proof. It is
not sufficient as the source-pack acceptance path because it bypasses app-api target admission and
run ledger evidence.

## Artifact Requirements

Each successful capture must produce:

- response HTML
- response headers
- fetch metadata
- provider extraction
- discovered links for audit only
- page manifest
- content blocks
- run report
- validation report
- QC report

Each failed capture must produce:

- failed fetch metadata
- failure reason
- manifest row identity
- retry eligibility
- `blocked` or `deferred` classification for release planning

## Quality Gates

Capture is accepted only when:

- page HTTP status is successful.
- canonical URL identity is stable.
- source-truth page manifest validates.
- content blocks are non-empty for answer-bearing pages.
- source URL and fetched timestamp are retained.
- source pack row identity can be traced from run evidence to source-truth artifact.

Capture is rejected or deferred when:

- page is dynamic shell with no source text.
- page requires unsupported authenticated access.
- page is a file-only asset without admitted file loader.
- page has only navigation/listing shell content and no answer-bearing content.
- page is outside first-slice source family.

## No Runtime Fetch Rule

After capture, all downstream work must consume source-truth artifacts or derived projections. Runtime
tools must not fetch the official web page, reparse live HTML or stitch page fragments at query time.
