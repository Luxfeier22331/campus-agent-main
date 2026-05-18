---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Consumer Denominator Design

## Decision

Official-web collection recovery must be downstream-consumer driven.

The collector may discover many pages during a run, but retained source-truth and downstream
projection should be bounded by a repo-tracked denominator that states which consumer can use the
page and what evidence makes that claim.

## Target Config

Add:

`configs/sources/official_web/muc_public/consumer-denominator.json`

The manifest should contain:

- `schema_version`
- `site_id`
- `denominator_version`
- `enforcement_mode`
- `consumer_families`
- `default_rejected_policy`
- `reporting_counters`

Each consumer family should define:

- `consumer_family`
- `owner_surface`
- `owner_agent_or_runtime`
- `materialization_policy`
- `page_families`
- `title_keywords`
- `path_patterns`
- `required_evidence`
- `negative_patterns`
- `selected_write_target`
- `review_policy`

`enforcement_mode` is explicit:

- `retain_matching_only` is the production recovery posture. Only matched consumer candidates are
  retained as source-truth.
- `audit_only` is allowed for regression/legacy crawl tests and temporary diagnostic runs. It still
  records consumer match metadata but does not drop unmatched pages.

## Candidate Families

### Contact Directory Candidate

Purpose:

- phone lookup
- email lookup
- office location lookup
- office hours lookup

Required evidence:

- at least one phone, email, location or office-hours candidate
- a display name or owning department label
- source URL and page title

Default policy:

- `candidate_only`
- selected write to `campus_services/contact_directory` only after review or deterministic
  high-confidence extraction

### Service Guide Candidate

Purpose:

- process/procedure answer
- entry point answer
- required material answer
- service location/contact/hour answer

Required evidence:

- at least one process, entry, material, contact, location or office-hours candidate
- service-like subject label
- source URL and page title

Default policy:

- `candidate_only`
- selected write to `campus_services/service_guide` only after review or deterministic
  high-confidence extraction

### Stable Reference Candidate

Purpose:

- long-lived institutional reference for `official_web/stable_reference`

Required evidence:

- stable page family such as directory, introduction, organization overview or long-lived
  institutional explanation
- no freshness-sensitive/news posture
- source URL and page title

Default policy:

- `release_gate_required`
- do not mix with fresh news or historical archive pages

### Notice News Candidate

Purpose:

- preserve future notice/news discovery evidence without opening the runtime

Required evidence:

- article/news/event/notice-like page shape
- publish time if available
- source URL and page title

Default policy:

- `inventory_only`
- no current read-model write
- no retrieval serving alias update

## Page Lifecycle

The intended lifecycle is:

1. Fetch and parse page.
2. Classify page family.
3. Match consumer denominator.
4. If no match, record rejected reason in run summary.
5. If discovery-only, keep only run-level discovery evidence.
6. If matched, retain source-truth artifacts with consumer match metadata.
7. In ingestion staging, emit candidate projection or inventory-only record.
8. Only selected write can publish ready structured records or stable-reference release candidates.

## Reporting Counters

Every run report should expose:

- `fetched_pages`
- `discovered_urls`
- `parsed_pages`
- `retained_source_truth_pages`
- `discovery_only_pages`
- `rejected_pages`
- `rejected_reason_counts`
- `consumer_family_counts`
- `selected_write_candidates`
- `inventory_only_candidates`

## Projection And Selected-Write Gate

Projection replay consumes consumer match metadata before title allowlist routing:

- `stable_reference_candidate` emits an `official_web/stable_reference` release candidate.
- `contact_directory_candidate` and `service_guide_candidate` remain
  `consumer_candidate_pages`; they are not current read-model records.
- `notice_news_candidate` remains `inventory_only`.

Projection validation must reject malformed consumer candidates:

- missing `matched_evidence`
- unsupported consumer family or materialization policy
- missing source refs
- missing selected-write target for contact/service candidates
- selected-write target on notice/news inventory-only candidates

Handoff staging emits `consumerCandidateReview`:

- selected-write candidates default to `selected_write_review_required`
- selected-write dry-run is `blocked` until reviewed extraction evidence exists
- stable-reference release candidates remain release-gate scoped
- notice/news candidates remain inventory-only

## Guardrails

- Listing pages are discovery by default, not answer-bearing evidence.
- News pages are inventory-only until notice/news runtime is admitted.
- Consumer match metadata is evidence, not a serving decision by itself.
- App-api remains official-web control-plane owner.
- Ingestion-worker owns projection and selected-write execution.
- Protected panel consumes app-api projections only.
