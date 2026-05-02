---
doc_type: requirements
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Requirements

## Goal

Expand official-web service-info source coverage with real, target-first pages that downstream
`campus_services/contact_directory` and `campus_services/service_guide` can consume.

## Scope

- Admit only explicit public official-web pages with a source-backed denominator field.
- Add `met.muc.edu.cn` as a support host because it owns information-technology service guides.
- Add contact-directory inventory for the information-disclosure contact page.
- Add service-guide inventory for the student campus-card service page.
- Keep optional field absence as `source_not_provided`.
- Keep form-download-only pages blocked as standalone service guides until multi-page composition is
  implemented.

## Non-Goals

- No broad crawl restart.
- No news or notice serving surface opening.
- No app-api selected-write mutation.
- No manual approval as the normal path.
- No transactional service submission or appointment execution.

## Success Criteria

- Repo-tracked target source map admits only the needed new host/source family.
- Target inventory version advances and lists the new source-backed rows.
- Collector denominator does not reject real service pages because incidental body text contains
  generic words such as `通知`.
- Target inventory reports can mark the new campus-card service ready when required evidence and
  preview lineage exist.
- Ingestion machine field review can produce dry-run-ready selected-write evidence for the new
  service guide without human approval.
