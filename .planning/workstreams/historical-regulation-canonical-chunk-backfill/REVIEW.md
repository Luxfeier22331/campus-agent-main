---
doc_type: review
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Historical Regulation Canonical Chunk Backfill Review

## Findings Fixed

- **Chunk-quality boundary ambiguity:** README originally said the workstream
  stopped before chunk quality review, while the roadmap required chunk-quality
  evidence. It now stops after chunk preparation, quality evidence and an
  explicit later-release handoff decision.
- **Reader asset ambiguity:** Planning text implied reader assets were chunk
  inputs. It now states document-units are the chunk input; reader/preview assets
  are optional audit/human-review artifacts and do not imply serving readiness.
- **Release-lane leakage:** Phase 0 listed release-lane alias evidence as a
  normal input. It is now explicitly a negative guard only, not an inventory
  source.
- **Side-effect assertion too narrow:** Serving-closed assertions now include
  candidate enqueue, candidate processor, release admission and alias publish
  flags, not only embedding/index flags.
- **Candidate-store mutation gap:** The workstream now explicitly forbids
  repairing, deleting, force-reenqueuing or advancing existing
  `rag_release_candidate` state.
- **Object-store path ambiguity:** The regulation artifacts were reviewed
  against ADR-0002 object-key conventions. Current regulation canonical and
  document-units keys use
  `regulations/documents/{collection}/{title_slug}--{docid8}/current-effective/undated/{artifact}`;
  CJK human-readable `{title_slug}` segments are compliant with the current
  contract and are now documented as not ASCII-only.
- **Canonical cleanup gaps:** HTML table flattening, publication-imprint tails
  with page markers, application-form tails and flattened information-table
  tails, supplementary indicator tables and graduation-paper templates are now
  removed in the ingestion-layer canonical cleaner instead of being left for
  downstream chunk/RAG consumers.
- **Chunk validation gaps:** Chunk prep now fail-closes on HTML residuals,
  publication-imprint residuals, form/table tail markers, polluted
  `section_path`, excessive `section_path` depth, duplicate headers, fabricated
  page anchors and coarse token-guardrail splits.
- **False-positive section paths:** Legitimate chapter/article headings such as
  `第二章 教学事故的种类与适用` and `第六条 优秀导师的评选条件` are no longer treated
  as body text solely because they contain school/unit terms or punctuation.
- **Superseded reruns:** `phase-26` was a 10-document default-parameter rerun and
  is not authoritative. `phase-27` through `phase-39` were superseded by v9 after
  form/table/template-tail validation was added.

## Remaining Boundary

This workstream may write canonical/chunk-preparation evidence in ingestion
truth, but it must not write RAG release state. Any future RAG release must start
from a separate quality-accepted handoff manifest.

## Latest Review Result

Phase 42 v9 final quality audit passed for 42 documents and 1773 emitted chunks:
0 HTML residual chunks, 0 publication-imprint chunks, 0 form-tail marker chunks,
0 body-like `section_path` chunks, 0 deep `section_path` chunks and 0 coarse
token-guardrail chunks. It also found 0 document metric failures and 0
object-store key failures. The 84 canonical/document-units object keys matched
the current regulation document artifact contract.

Phase 36 chunk quality acceptance is `passed`; the later-release handoff status
is `ready_for_separate_release_lane_decision`. This is not a release. Embedding,
index release, release admission, candidate enqueue, candidate processor and
alias publish remain unopened.
