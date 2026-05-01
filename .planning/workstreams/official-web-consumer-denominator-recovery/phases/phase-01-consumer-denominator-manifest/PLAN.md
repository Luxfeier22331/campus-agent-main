---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Consumer Denominator Manifest

## Goal

Add the repo-tracked source config that defines which official-web pages are worth retaining because
a downstream consumer can use them.

## Tasks

1. Add `configs/sources/official_web/muc_public/consumer-denominator.json`.
2. Define schema fields for consumer family, owner surface, materialization policy, page families,
   keyword/path evidence, required fields and review policy.
3. Add config loader and validator in `apps/official-web-collector` or shared official-web config
   code.
4. Add tests for valid config, unsupported family, unsupported materialization policy and missing
   required evidence.
5. Update source config README to describe denominator ownership.

## Initial Families

- `contact_directory_candidate`
- `service_guide_candidate`
- `stable_reference_candidate`
- `notice_news_candidate`

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm web:typecheck:affected
```

## Acceptance

- Denominator config validates deterministically.
- Each family has an owner and materialization policy.
- News/notice family is inventory-only.
- Contact/service families require extracted fact evidence before selected write.
