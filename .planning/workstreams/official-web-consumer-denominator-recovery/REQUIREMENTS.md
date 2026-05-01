---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Consumer Denominator Recovery

## Goal

Restore official-web collection only for facts that admitted downstream consumers can use:

- `contact_directory_lookup`
- `service_guide_lookup`
- `official_web/stable_reference`
- future notice/news candidates as inventory-only evidence

The workstream changes the recovery denominator from "crawl allowed public pages" to "retain and
materialize pages that match a governed consumer family."

## Scope

- Add a repo-tracked consumer denominator manifest for `official_web/muc_public`.
- Recut default scheduler and host scope so routine collection does not broad-crawl news.
- Add collector-side candidate classification and retained artifact gating.
- Add consumer-first projection routing for contact, service guide, stable reference and future
  notice/news inventory-only candidates.
- Prove the live seam in no-promotion mode:
  `collector -> app-api lifecycle -> object storage -> handoff receiver -> ingestion staging`.
- Define quality review and selected-write gates before any candidate becomes current read-model
  truth.
- Update architecture/workstream docs so future collection recovery follows the consumer
  denominator.

## Non-Goals

- Do not run full historical official-web backfill.
- Do not promote registry current truth as part of the first live seam.
- Do not refresh retrieval serving aliases.
- Do not open `fresh_news` or `news_archive`.
- Do not let generic `rag-agent` answer latest/news/notice questions from stale official-web
  pages.
- Do not build a second official-web backend outside `apps/app-api`.
- Do not move service/contact read-model ownership into the collector.

## Consumer Families

| Consumer family | Owner surface | Current posture | Materialization |
| --- | --- | --- | --- |
| `contact_directory_candidate` | `contact_directory_lookup` | active structured runtime | candidate first, selected write after review |
| `service_guide_candidate` | `service_guide_lookup` | active structured runtime | candidate first, selected write after review |
| `stable_reference_candidate` | `official_web/stable_reference` | query-serving scope exists | candidate first, release gate after audit |
| `notice_news_candidate` | future notice/news runtime | backlog/deferred | inventory-only, no current write |

## Success Criteria

- Consumer denominator manifest exists and names each downstream owner, required evidence fields and
  materialization policy.
- Default scheduler no longer treats broad news crawl as the main recovery path.
- Collector reports fetched, discovered, retained, rejected and consumer-family counts.
- Pages without consumer evidence do not enter selected downstream projection.
- No-promotion live seam proves object-store and handoff plumbing without registry promotion.
- Selected-write plan requires review evidence and source refs for every ready record.
- Docs preserve the distinction between discovery-only pages, retained source-truth and downstream
  read-model truth.

## Acceptance Evidence

Required evidence before closeout:

- manifest lint/test output for the new denominator config
- collector candidate classifier unit tests
- scheduler/config regression tests
- projection routing tests proving news/listing pages do not become answer-bearing by default
- no-promotion live seam report with object keys, handoff id, candidate counts and no promotion
  proof
- quality review report for the first batch
- selected-write dry-run or selected-write report with reviewed records only
