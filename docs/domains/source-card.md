---
doc_type: domain
truth_scope: product
owner_boundary: domains/source-card
status: active
created: 2026-06-28
updated: 2026-07-08
---
# Source Card

This is the canonical human document for source-card permalink, anchor and
highlight behavior across Q&A and the docs reader.

## Boundary

A source card is the browser-safe citation target produced from selected
supporting evidence. It exists so Q&A answers, docs search results and direct
reader navigation land on the same canonical reader permalink.

It is not:

- raw retrieval trace
- raw chunk id / source unit key
- object storage key
- provider score or debug payload
- reader content payload

## Consumption

The shared target shape is:

```text
SupportingEvidence + CanonicalReference
  -> SourceCard
  -> /docs/:corpus/:collection/:docSlug?hl=<rootUnitId>#<anchor>
```

Fixed rules:

- assistant prose contains the answer, not stringified citation fields.
- source cards carry canonical document title, optional section title, snippet,
  version label and reader target.
- `canonicalUrl` remains the legacy wire field name, but its semantics are
  reader permalink, not SEO canonical URL.
- `anchor` is the stable navigation target.
- `highlightRootUnitIds[]` is the stable temporary highlight target.

## Reader Target

Reader permalink semantics are:

- current version: `/docs/:corpus/:collection/:docSlug`
- explicit version: `/docs/:corpus/:collection/:docSlug/v/:versionSlug`
- section jump: `#<anchor>`
- temporary highlight: `?hl=<rootUnitId1>,<rootUnitId2>`

`anchor` and `rootUnitId` come from canonical document units and must not be
derived from current chunk ids or vendor result ids.

## Owner Documents

- Browser/docs control-plane fields:
  `../contracts/app-api/document-reader.md`
- Canonical reader model:
  `../data/document-reader.md`
- Knowledge evidence and final source contract:
  `../contracts/tool-execution.md`
- Indexed retrieval serving boundary:
  `../architecture/system/retrieval-serving.md`
- Docs reader architecture:
  `../architecture/system/document-site.md`

Those documents own their machine-readable contracts and data models. This
document owns the human behavior summary for source-card navigation.
