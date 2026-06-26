---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-06-26
updated: 2026-06-26
---
<!-- markdownlint-disable MD013 -->

# Campus Services And Content Corpus Completion Audit

## Boundary

This audit records the completion posture for two current product tracks:

- `campus_services`, currently limited to the published transport schedule
  product path and `transport_schedule_lookup`.
- Content corpus assets that are collected, cleaned, released and consumed by
  the main answer path.

This document does not audit developer documentation breadth. In this document,
`content corpus` means user-answerable source material and structured data
assets, not `docs/` implementation documents.

This audit also does not own staging release closeout, release proof, eval
platform proof, or operational smoke completion. Those remain ops / QA work and
must not be used as the primary next-work ranking for this track.

## Executive Conclusion

The current branch has the correct high-level boundary: `campus_services` is not
a generic service-status facade, and the only model-visible campus-services tool
is `transport_schedule_lookup`.

The next completion work should focus on product/data correctness, not release
proof loops:

1. Make the transport schedule product path reliable enough for students and
   developers: current-effective source truth, temporary changes, source links,
   public cache behavior and tool/page consistency.
2. Audit the four default query-enabled content corpora for source coverage,
   chunk quality, metadata, source URLs, freshness and answer citation quality.
3. Keep non-default retrieval-ready assets closed until their source/release and
   consumer contracts are explicit.
4. Treat multi-turn context, attachment upload and document-reader supplements
   as product backlog items, not as proof/eval closeout.

## Runtime Inventory

### Model-Visible Tools

| Tool | Capability | Exposure | Runtime | Completion posture |
| --- | --- | --- | --- | --- |
| `knowledge_query` | `knowledge` | model-visible | workflow signal / Go RAG graph | Open main knowledge path |
| `transport_schedule_lookup` | `campus_services` | model-visible | execution-control internal query | Open, transport only |
| `campus_notice_discover` | `notice` | model-visible | execution-control internal query | Open notice support |
| `campus_notice_get` | `notice` | internal-only | execution-control internal query | Not model-facing |
| `campus_notice_change_set_lookup` | `notice` | closed | execution-control internal query | Not model-facing |
| `campus_notice_period_summary` | `notice` | closed | execution-control internal query | Not model-facing |
| `retrieval.query` | `knowledge` | closed | execution-control internal query | RAG internal only |

`campus_services` currently allows only `transport_schedule_lookup` in
`configs/runtime/capabilities.v1.json`.

### Content Corpus Inventory

| Corpus / collection | Serving stage | Retrieval | Default query | Structured tool | Current posture |
| --- | --- | --- | --- | --- | --- |
| `regulations/student_rules` | `query_serving` | true | true | false | Default query corpus |
| `regulations/institutional_rules` | `query_serving` | true | true | false | Default query corpus |
| `curriculum/curriculum_plan` | `query_serving` | true | true | false | Default query corpus |
| `official_web/stable_reference` | `query_serving` | true | true | false | Default query corpus |
| `campus_services/transport_schedule` | `structured_query_serving` | false | false | `transport_schedule_lookup` | Structured service corpus |
| `curriculum/course_facts` | `query_serving` | true | false | false | Agent-internal / non-default |
| `curriculum/program_family_facts` | `query_serving` | true | false | false | Agent-internal / non-default |
| `curriculum/program_semester_facts` | `query_serving` | true | false | false | Agent-internal / non-default |
| `regulations/scoped_rules` | `query_serving` | true | false | false | Retrieval-ready / non-default |
| `calendar/academic_calendar` | `offline_preparation` | false | false | false | Data prework only |
| `campus_notices/internal_notice` | `offline_preparation` | false | false | false | Source/read-model preparation |
| `official_web/fresh_news` | `offline_preparation` | false | false | false | Closed until news opening gates pass |
| `official_web/news_archive` | `offline_preparation` | false | false | false | Closed until explicit history contract |
| `authenticated_documents/*` | `offline_preparation` | false | false | false | Capture/preparation only |
| `public_docs/reader_assets` | `offline_preparation` | false | false | false | Reader asset preparation only |

## Campus Services Findings

### CS-01: Current Scope Is Correctly Narrow

Status: `closed_boundary`

Current code and docs agree that `campus_services` is not a generic lookup
surface. `tool-catalog.v1`, `capabilities.v1`, workflow artifacts and domain
architecture all limit current model-visible exposure to
`transport_schedule_lookup`.

Required action:

- Preserve this boundary.
- Do not reintroduce `service_status_lookup`, service guide lookup, contact
  directory lookup or academic calendar lookup as part of this track.

### CS-02: Status Page Exists, But Completion Is Source-Data Limited

Status: `partially_closed`

Current implementation:

- `campus-web` exposes a `/services` page with a date picker and HeroUI table.
- The page renders route sections, route status badges, departures and source
  links.
- The page renders release id / published time when app-api exposes release
  metadata.
- `app-api` exposes `GET /api/campus-services/transport-schedule`.
- The endpoint calls execution-control
  `/internal/query/campus-services/transport-schedule`.
- Tool lookup and public status page both consume the same execution-control
  structured runtime.
- Public departure rows preserve structured `departure_status`,
  `departure_kind`, `operational_note` and `related_notice_refs` when
  execution-control returns them.
- `adjustmentCount` includes non-normal departure rows, route-level non-running
  status and route operational notes.

Remaining gaps:

- `calendarLabel` is fixed to `以发布时刻表为准`; workday / holiday / special-day
  semantics still need upstream source-data support.
- Concrete `added` / `changed` / `cancelled` departure rows require upstream
  projection facts. app-api and campus-web preserve these fields but do not
  infer them from prose comments.
- Source link title is generic (`班车时刻表来源`) even when upstream notice title
  could be more useful.

Required action:

- Extend the upstream transport projection to emit reliable service-day kind,
  source title and concrete added/cancelled/changed departure rows when the
  source notice contains row-level changes.
- Keep temporary changes inside the timetable semantics: cancelled or added
  departures should appear in the route table when they affect concrete
  departures; route-level suspension should appear as the route status and
  operational note.

### CS-03: Edge Cache Is Present And Correctly Scoped

Status: `mostly_closed`

Current implementation:

- app-api returns `cache-control: public, max-age=60, s-maxage=300`.
- app-api returns an ETag derived from `serviceDate`, `releaseId` and
  `publishedAt`.
- campus-web Worker cache only handles `GET` / `HEAD`
  `/api/campus-services/transport-schedule` with exactly one valid
  `serviceDate` query parameter.
- Cache hits/misses are surfaced through `x-campus-edge-cache`.

Remaining gap:

- The cache key is currently service-date scoped. A new release changes the
  response ETag/body but does not make an already cached service-date key miss.
  Emergency changes may therefore take up to the configured edge freshness
  window to appear unless the release path purges cache or the browser API
  adopts a versioned query key.

Required action:

- Keep the current scoped cache.
- Ensure `releaseId` / `publishedAt` changes for every current-effective release
  so validators and fresh fetches can distinguish versions.
- If immediate emergency invalidation becomes required, add a targeted purge or
  versioned query key; do not disable edge cache globally.

### CS-04: Query Fan-Out Is Acceptable For Cached Public Reads, But Not Final

Status: `watch`

Current app-api behavior:

- First calls `timetable` without route selector to discover route candidates.
- Then calls one `timetable` query per candidate route.

This is acceptable behind edge cache and small route counts, but it makes a cold
cache miss cost proportional to route count.

Required action:

- Keep current fan-out for now.
- If route count or cold miss traffic grows, add one aggregate structured query
  mode for full public timetable projection rather than letting the browser or
  page layer call multiple tools.

### CS-05: Operator Release Overlay Fails Closed

Status: `closed_in_current_branch`

Current Go runtime behavior:

- `loadTransportScheduleBundle` always loads the baseline projection bundle.
- If `CampusServicesOpsReleaseStore` is configured, it tries to load the latest
  published release and apply transport overrides.
- If release loading returns an error, current lookup fails closed with
  `temporarily_unverifiable` and `fail_close_reason=source_truth_unavailable`
  instead of returning a normal baseline timetable.

Verification:

- `TestLookupTransportScheduleFailsClosedWhenConfiguredOpsReleaseStoreFails`
  covers the configured-store failure path.

Required action:

- If the store is explicitly optional in an environment, that optionality must
  be visible in readyz/runtime profile and not treated as current-effective
  overlay support.
- Environments that configure the ops release store must publish an empty or
  non-empty current-effective release during initialization; no published
  release is treated as unverifiable currentness, not as "no override".

### CS-06: Source URLs Are Partially User-Ready

Status: `product_gap`

Current implementation:

- Public status page deduplicates source notices and renders direct links.
- app-api only exposes refs that are valid `http` or `https` URLs.
- internal ops refs such as `campus_services_ops:release:*` and
  `campus_services_ops:attestation:*` are not shown as user links.

This matches the desired behavior for authenticated notice URLs: students can
open the URL and authenticate themselves if the source requires login.

Remaining gap:

- Operator-curated sources without URL are not user-clickable. That is acceptable
  for manual attestation, but the page should not pretend such refs are source
  URLs.
- Source titles should come from the upstream notice where available.

Required action:

- Keep showing direct URLs only.
- Add better source labels once notice title is present in structured results.
- Do not add "requires login" badges or explanatory UI; direct URL is enough.

## Content Corpus Findings

### CC-01: Default Query Corpus Set Is Clear And Small

Status: `closed_boundary`

Default query-enabled corpora are limited to:

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

This is the right audit denominator for current content quality. The main answer
path should not be judged by every future collection.

Required action:

- Keep this set as the current default corpus denominator.
- Record any future default opening as an explicit runtime profile and source
  quality change.

### CC-02: `student_rules` Is The Most Complete Default Corpus

Status: `mostly_closed`

Current assets include runtime profile, canonical profile, chunk profile,
query-planning, source projections, split manifest, task registry and accepted
eval metrics.

Remaining gaps:

- Quality work should focus on source freshness, citation quality and user
  question coverage, not on reopening architecture boundaries.
- Curated service guides under `student_rules` are regulation/content corpus
  material; they are not a campus-services service-guide runtime.

Required action:

- Run content-level sample checks against common student questions.
- Keep curated guides in the knowledge/content path unless a separate product
  requirement admits them elsewhere.

### CC-03: `institutional_rules` Needs Source/Release Trace Tightening

Status: `corpus_gap`

Current assets include canonical profile, chunk profile, query planning,
retrieval eval manifest and source projections.

Observed gap:

- Compared with `student_rules`, this directory does not currently show a
  task-registry or split-manifest at the top level.

Required action:

- Confirm whether current institutional source/release trace is intentionally
  represented only through source projections and eval manifest.
- If not intentional, add or regenerate the missing source/release inventory
  artifact before treating content quality as closed.

### CC-04: `curriculum_plan` Is Query-Enabled But Still Carries Gap-Triage Signals

Status: `corpus_gap`

Current assets include runtime profile, retrieval profile, query planning,
split manifest, task registry, samples and candidate gap-triage artifacts.

Observed gap:

- Existing candidate gap files indicate the corpus still needs content-shape
  review around split boundaries, table-heavy plans and course-map behavior.

Required action:

- Promote remaining split-manifest candidate gap decisions into a current
  content-quality ledger.
- Validate common curriculum questions against source-level citations and
  course/table boundaries.

### CC-05: `official_web/stable_reference` Is Default-Open But Metadata Policy Is Thin

Status: `corpus_gap`

Current runtime profile is `query_serving` and default enabled. It explicitly
does not support freshness-sensitive queries.

Observed gaps:

- Runtime profile has empty `required_metadata_fields`.
- Runtime profile has empty `primary_evidence_page_families`.
- No top-level source projections/canonical profile were found in the config
  directory during this audit.

Required action:

- Define the minimum stable-reference metadata denominator: source URL, page
  family, title, crawl/release time and page role where available.
- Keep recent/fresh/news questions out of this collection; `fresh_news` and
  `news_archive` must stay closed until their opening checklist passes.

### CC-06: Non-Default Retrieval-Ready Assets Must Stay Non-Default

Status: `closed_boundary`

The following are retrieval-enabled but not default query-enabled:

- `curriculum/course_facts`
- `curriculum/program_family_facts`
- `curriculum/program_semester_facts`
- `regulations/scoped_rules`

Required action:

- Do not promote them to default query scope just because retrieval is enabled.
- Before opening, require explicit consumer scenarios, source/release trace and
  answer citation behavior.

### CC-07: Academic Calendar Is A Data Asset, Not A Campus-Services Tool

Status: `closed_boundary`

`calendar/academic_calendar` is `offline_preparation`, retrieval disabled and
query disabled.

Required action:

- Redesign calendar facts as a data asset before any runtime opening.
- Do not attach it to `campus_services` by naming convenience.

### CC-08: Notice Content Maturity Is Separate From Generic Corpus Completion

Status: `watch`

Only `campus_notice_discover` is model-visible for notice. `campus_notices/internal_notice`
remains an offline-preparation source/data area rather than a default generic
RAG corpus.

Required action:

- Keep notice discovery as the typed notice tool.
- Do not use notice content maturity as a blocker for the four default content
  corpora.
- When a notice-derived item becomes a regulation, service override or schedule
  fact, it must enter that downstream surface through explicit projection.

## Backlog Alignment Findings

### BL-01: Multi-Turn Context Is A Product Gap For Content Consumption

Status: `backlog_ready`

The PRD already identifies the correct target: app-api compiles
`context.conversation`, execution-control performs memory recall, and primary
agent / RAG consume typed model-visible slices.

Content impact:

- Follow-up questions cannot be judged only by raw corpus quality.
- Previous answer summaries and previous evidence refs are required for
  high-quality multi-turn corpus consumption.

Required action:

- Treat run context envelope work as a content-consumption product feature.
- Do not frame it as staging proof or eval closeout.

### BL-02: Conversation Attachments Are Proposed Backlog, Not Current Corpus Input

Status: `backlog_ready`

The attachment PRD correctly states that user-uploaded files are per-message
context and not institutional RAG/source truth.

Required action:

- Keep any frontend attachment entry hidden or fail-closed until upload,
  storage, metadata, execution projection and provider input are implemented.
- Do not let user attachments enter official notice, regulation, curriculum,
  official-web or campus-services source truth.

### BL-03: Document Reader Supplements Need Source-Asset Truth

Status: `backlog_ready`

Document reader appendix/form downloads should only expose a downloadable
original when source truth contains a real original file asset.

Required action:

- Separate original source files from generated table exports.
- Do not label generated exports as original attachments.

## Recommended Implementation Batches

### Batch 1: Transport Schedule Correctness

Goal: make current-effective班车 truth reliable.

Tasks:

- Done in current branch: configured ops release overlay failures fail closed
  instead of silently returning baseline truth.
- Done in current branch: execution-control, app-api and campus-web preserve
  departure status/kind/note/source refs and count route-level adjustments.
- Remaining source-data work: emit reliable service-day kind, source titles and
  concrete added/cancelled/changed departure rows from the transport projection.
- Add focused tests for baseline-only, temporary suspension, added service,
  expired override and ops release store failure.

### Batch 2: Transport Status Page Product Completion

Goal: make the status page useful without overdesign.

Tasks:

- Done in current branch: render service-day label and current release time/id
  when app-api exposes those fields.
- Remaining source-data work: expose better source labels once notice title is
  present in structured results.
- Keep temporary changes inside route tables when they affect concrete
  departures.
- Keep direct source URLs only; do not add login badges or explanatory wrappers.
- Keep edge cache, but validate release id / published time changes on publish.

### Batch 3: Default Corpus Quality Audit

Goal: make default knowledge answers traceable and complete.

Tasks:

- For each default corpus, produce a source/release/citation coverage ledger.
- Sample common student questions and classify failures as source missing, split
  poor, metadata missing, stale, answer synthesis issue or routing issue.
- Fix corpus config/artifacts before expanding default query scope.

### Batch 4: Non-Default Corpus Decisions

Goal: avoid accidental product opening.

Tasks:

- Keep course facts, program facts and scoped rules non-default.
- For each candidate opening, require a consumer scenario and source/release
  proof.
- Keep academic calendar as data prework until a dedicated schema and product
  consumer are accepted.

### Batch 5: Product Backlog Follow-Through

Goal: improve content consumption after source quality is stable.

Tasks:

- Implement run context envelope before expecting reliable follow-up answers.
- Implement attachments only as per-message context, not corpus ingestion.
- Implement document-reader supplements only from real source assets.

## Completion Checklist

The audit track is complete when:

- Campus-services status page and `transport_schedule_lookup` consume the same
  current-effective projection, including temporary changes.
- Missing current-effective transport overlay truth cannot silently return a
  normal baseline answer.
- The four default corpora each have source, release, metadata and citation
  coverage recorded.
- Non-default retrieval assets remain closed unless explicitly admitted.
- Backlog product features are ranked as product/content-consumption work, not
  release closeout work.
