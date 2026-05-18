---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements

## Problem Statement

`service_guide_lookup` is now backed by target-first service-guide projection work, but current data
and runtime behavior are still not sufficiently shaped for high-quality user answers.

Observed gaps:

- multi-mode pages such as VPN are flattened into one `process_steps` array
- tool answers concatenate all sections instead of selecting the relevant section for the user goal
- real official-web material rows still include shell labels and date/listing noise
- final answers expose coarse source refs, not field-level provenance
- query-time guardrails do not yet verify answer focus, unsupported claims or source-not-provided
  semantics
- release gates do not use a product-question dataset that exercises official-web service-guide
  answers end to end
- multi-page composition for information disclosure / email service is still implemented as
  special-case projection logic rather than a declarative role contract
- grouped procedure and focused answer fields are not yet frozen through one canonical
  cross-language contract / golden fixture across Python, Go and TypeScript consumers
- selected-write projection changes do not yet specify typed PostgreSQL read-model migration,
  backfill, rollback and compatibility behavior
- no-promotion replay and selected-write publish proof are not yet separated as side-effect
  distinct gates
- planner-level `guide_focus` selection is not yet part of the service-guide product gate
- "focused answer" and "no section dump" are not yet expressed as machine-verifiable thresholds

## Goals

1. Make service-guide projection capable of representing grouped procedures and source-linked
   sections without losing source fidelity.
2. Make `service_guide_lookup` answer the user-requested facet instead of dumping all known guide
   content.
3. Preserve and surface field-level provenance for procedure, material, entry, contact and office
   hour facts.
4. Keep selected-write release and current projection publishing under ingestion ownership.
5. Add deterministic runtime guardrails for answer focus, unsupported fields and `source_not_provided`
   handling.
6. Add eval / release gate coverage for representative user journeys over official-web-backed
   service-guide records.
7. Convert real source-pack replay quality checks into repeatable no-promotion evidence.
8. Update architecture and data contract docs to make these boundaries explicit.
9. Canonicalize grouped procedure and focused result shape across Python contracts, Go structured
   query, TypeScript consumers and eval/provider tool fixtures.
10. Keep real selected-write publish proof isolated from no-promotion replay and require explicit
    local target environment evidence before any PG/object-store promotion.

## Non-Goals

- No broad official-web crawling.
- No query-time fetch of official-web pages.
- No generic RAG fallback for missing service-guide fields.
- No human approval queue as a required happy path.
- No transaction execution, auto-submission, appointment booking or work-order creation.
- No ownership transfer from ingestion-worker to app-api for selected-write admission/release.
- No navigation/place lookup implementation.

## Acceptance Criteria

- Service-guide projection has a canonical grouped procedure shape or an equivalent section shape
  that can represent VPN direct/client/mobile modes without flattening them into one answer dump.
- The grouped procedure / selected section contract is frozen in docs, Python dataclasses, Go
  structured query structs, TypeScript parsers or operator-safe projections where applicable, and
  at least one cross-language golden fixture.
- Existing service-guide records remain backward compatible for release/read-model consumers during
  the migration, with explicit typed read-model migration/backfill/rollback tests.
- Official-web candidate composition is driven by declarative target/source role metadata rather than
  one-off page-title special cases, and invalid composition metadata fails closed.
- `service_guide_lookup` can answer at least these user intents with focused output:
  - `VPN入口在哪里`
  - `VPN客户端怎么安装`
  - `校园网认证入口在哪里`
  - `邮箱申请需要什么表`
  - `信息公开怎么申请`
  - `校园卡丢了怎么办`
- If a requested facet is absent, the runtime says the source page does not provide it instead of
  fabricating the field.
- Every answer includes usable source URLs, and field-level source refs are retained in structured
  result details.
- Planner tests prove user wording maps to the intended `guide_focus` before the tool runtime is
  called.
- Release/eval gates define deterministic answer focus thresholds: max selected section count,
  answer length budget, required tokens, forbidden unrelated tokens, source URL coverage and
  field-source coverage.
- Release gate / eval artifacts include real source-pack no-promotion replay metrics for service
  guides.
- No-promotion replay artifacts and selected-write publish artifacts are separate. Publish evidence
  may only come from an explicitly accepted isolated local target environment.
- All new behavior has focused unit tests and at least one real replay proof.

## External Best-Practice Alignment

The workstream aligns with current OpenAI guidance around:

- structured tool outputs / schema-constrained data contracts
- tracing and tool-call observability for agent workflows
- guardrails around tool execution and final responses
- eval datasets as regression gates for user-visible behavior

Reference URLs captured during planning:

- https://help.openai.com/en/articles/8555517
- https://openai.github.io/openai-agents-python/tracing/
- https://openai.github.io/openai-agents-python/guardrails/
- https://platform.openai.com/docs/guides/evaluation-getting-started
