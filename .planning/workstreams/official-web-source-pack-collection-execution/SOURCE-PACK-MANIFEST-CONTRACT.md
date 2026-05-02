---
doc_type: design
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Source Pack Manifest Contract

## Purpose

The source-pack manifest is the first-slice collection authority.

It is not a host allowlist, seed list, crawl frontier or runtime tool configuration. It is a
repo-tracked list of explicitly admitted source pages that downstream tools or serving surfaces are
expected to consume after source-truth capture and ingestion replay.

## Canonical File Path

Canonical path:

```text
configs/sources/official_web/muc_public/source-packs/tool-driven-first-slice.v1.json
```

This path keeps the pack near existing official-web source configuration without overloading
`target-source-map.json` with page-level pack fields.

## Manifest Row Shape

Each row should include:

```json
{
  "source_pack_id": "tool-driven-first-slice.v1",
  "entry_id": "owsp-it-campus-card-guide.met-1127",
  "site_id": "muc_public",
  "url": "https://met.muc.edu.cn/info/1027/1127.htm",
  "content_family": "campus_service_guide",
  "source_kind": "html_page",
  "answer_bearing": true,
  "demand_ids": ["owsp-it-campus-card-guide", "owsp-it-campus-card-contact"],
  "owner_surfaces": ["service_guide_lookup", "contact_directory_lookup"],
  "release_targets": ["campus_services/service_guide", "campus_services/contact_directory"],
  "expected_facts": ["service_process", "service_location", "phone"],
  "composition_group": null,
  "composition_role": null,
  "capture_policy": "one_time",
  "refresh_posture": "manifest_refresh_only",
  "extraction_gate": "deterministic_source_backed",
  "eval_questions": ["校园卡丢了怎么办？", "校园卡服务电话是多少？"]
}
```

## Required Fields

- `source_pack_id`
- `entry_id`
- `site_id`
- `url`
- `content_family`
- `source_kind`
- `answer_bearing`
- `demand_ids`
- `owner_surfaces`
- `release_targets`
- `expected_facts`
- `capture_policy`
- `refresh_posture`
- `extraction_gate`
- `eval_questions`

## Allowed `source_kind`

- `html_page`
- `html_table_page`
- `download_reference_page`
- `dynamic_shell_excluded`
- `file_asset_reference_only`

First slice should not require full PDF/Word/Excel parsing. A row may retain a download URL as a
material or source reference, but file byte extraction belongs to the shared file asset loader when
separately admitted.

## Allowed Projection Outcome Classes

Manifest rows may declare multiple owner surfaces and release targets. During replay, one page can
fan out to multiple projection outcome classes. For example, one campus card page can produce both
`service_guide_candidate` and `contact_directory_candidate` when both projections are source-backed.

The page-level replay status is not a manifest input. It belongs to the replay report.

- `service_guide_candidate`
- `contact_directory_candidate`
- `stable_reference_candidate`
- `regulation_reference_candidate`
- `blocked`
- `deferred`
- `inventory_only`
- `excluded`

## Validation Rules

Manifest validation must fail closed when:

- `url` is missing or not HTTPS.
- `site_id` is not `muc_public`.
- no `demand_ids` are present.
- no `owner_surfaces` are present.
- no `release_targets` are present for `answer_bearing = true`.
- `owner_surfaces` and `release_targets` are inconsistent.
- a dynamic shell page is marked answer-bearing in first slice.
- a news/recruitment/procurement/event page is admitted without a separate source-family decision.
- a row attempts to open `official_web/fresh_news` or `official_web/news_archive`.
- a row routes selected-write mutation to app-api.
- a multi-owner row cannot map each owner surface to a compatible release target.

Validation should warn, not fail, when optional expected facts are absent from source pages. The
source-faithful answer should expose only facts found in the page.

## Relationship To Existing Config

- `target-source-map.json` remains target admission and owner-surface declaration.
- `consumer-denominator.json` remains retained consumer-family denominator.
- `source-pack` manifest is page-level execution scope for the one-time pack.
- Drift checks should verify that manifest `owner_surfaces` and `release_targets` are compatible
  with existing target-source-map / consumer denominator definitions.
