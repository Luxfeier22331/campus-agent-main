---
doc_type: handoff
status: completed
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Execution Handoff

This document freezes the demand-side handoff from
`official-web-tool-driven-source-pack` to
`official-web-source-pack-collection-execution`.

The handoff is demand-side only. It does not implement the manifest, capture runner, ingestion
replay, selected-write release task, stable-reference release or runtime query path.

## Accepted Demand Sources

The accepted demand inputs are:

- `SOURCE-CONTENT-ASSESSMENT.md`
- `SOURCE-COLLECTION-CASES.md`
- `DOWNSTREAM-DEMAND-MATRIX.md`

Only rows and cases represented in those files can seed the first source-pack execution. Host-wide
seeds, listing expansion and broad official-web crawl are not handoff inputs.

## Accepted First-Slice Demand

| Demand ID | Owner surface | Release target | Execution posture |
|-----------|---------------|----------------|-------------------|
| `owsp-core-school-profile` | `official_web/stable_reference` | stable-reference document release | admit |
| `owsp-core-org-units` | `official_web/stable_reference` | stable-reference document release | admit |
| `owsp-admin-offices-reference` | `official_web/stable_reference` | stable-reference document release | admit |
| `owsp-library-reference` | `official_web/stable_reference` | stable-reference document release | admit as source-faithful library overview, not live service status |
| `owsp-museum-reference` | `official_web/stable_reference` | stable-reference document release | admit as source-faithful museum overview |
| `owsp-core-main-contact` | `contact_directory_lookup` | `campus_services/contact_directory` | admit only for source-explicit address / phone facts |
| `owsp-it-campus-card-guide` | `service_guide_lookup` | `campus_services/service_guide` | admit |
| `owsp-it-campus-card-contact` | `contact_directory_lookup` | `campus_services/contact_directory` | admit only for source-explicit service point facts |
| `owsp-it-vpn-guide` | `service_guide_lookup` | `campus_services/service_guide` | admit |
| `owsp-it-network-auth` | `service_guide_lookup` | `campus_services/service_guide` | admit |
| `owsp-it-password-reset` | `service_guide_lookup` | `campus_services/service_guide` | admit if source-backed URL / procedure facts exist |
| `owsp-it-email-guide` | `service_guide_lookup` | `campus_services/service_guide` | admit as offline composition group |
| `owsp-it-email-policy` | `regulations/institutional_rules` or `official_web/stable_reference` | regulation-style or stable-reference release | admit as policy/reference, not service-guide-only |
| `owsp-info-disclosure-scope` | `regulations/institutional_rules` or `official_web/stable_reference` | regulation-style or stable-reference release | admit as policy/reference |
| `owsp-info-disclosure-apply` | `service_guide_lookup` | `campus_services/service_guide` | admit as offline composition group |
| `owsp-info-disclosure-contact` | `contact_directory_lookup` | `campus_services/contact_directory` | admit only for source-explicit office facts |
| `owsp-logistics-service-contact` | `contact_directory_lookup` | `campus_services/contact_directory` | admit only for source-explicit labeled service hotlines |
| `owsp-fee-reference` | `official_web/stable_reference` | stable-reference document release | admit with table-alignment gate |

## Accepted Source Cases

The following source cases may be converted into manifest rows by the execution workstream:

| Case | Source URL | Required role |
|------|------------|---------------|
| School introduction | `https://www.muc.edu.cn/xxgk1/xxjj.htm` | stable institutional reference; optional contact fact extraction |
| Administrative office list | `https://www.muc.edu.cn/zzjg/znbm.htm` | bounded office-list stable reference |
| Teaching and research unit list | `https://www.muc.edu.cn/zzjg/jxhkydw1.htm` | organization stable reference |
| Library public reference page | `https://www.muc.edu.cn/ggfw/tsg.htm` | stable library overview reference |
| Museum public reference page | `https://www.muc.edu.cn/ggfw/mzbwg.htm` | stable museum overview reference |
| Campus card service | `https://met.muc.edu.cn/info/1027/1127.htm` | service guide plus optional contact projection |
| Campus network authentication | `https://met.muc.edu.cn/info/1008/1846.htm` | service guide with entry refs |
| VPN usage | `https://met.muc.edu.cn/info/1046/1674.htm` | service guide with entry refs; attachment retained as reference only |
| Unified identity password reset guide | `https://met.muc.edu.cn/info/1068/1830.htm` | service guide with entry refs and exception/on-site handling facts |
| Email service pages | `https://met.muc.edu.cn/info/1024/1090.htm`, `https://met.muc.edu.cn/info/1046/1932.htm`, `https://met.muc.edu.cn/xzzq/sqbg/1.htm` | offline composition for service guide; policy page also admitted as regulation/reference |
| Information disclosure implementation rules | `https://xxgk.muc.edu.cn/info/1005/1107.htm` | policy/reference source and optional composition fact source |
| Information disclosure application pages | `https://xxgk.muc.edu.cn/info/1007/1113.htm`, `https://xxgk.muc.edu.cn/info/1007/1114.htm`, `https://xxgk.muc.edu.cn/xxgk/lxfs.htm` | offline composition components |
| Logistics service contact page | `https://www.muc.edu.cn/ggfw/hqfw.htm` | labeled contact-directory source |
| Education fee disclosure table | `https://xxgk.muc.edu.cn/info/1302/1393.htm` | stable reference with table-alignment gate |

## Composition Requirements

`composition_group = information_disclosure` is accepted as the first multi-page composition group.

The execution workstream must preserve these component roles:

- `policy_source`: disclosure scope, non-disclosure categories, answer deadline and policy facts.
- `procedure_source`: how to apply and submission method facts.
- `material_source`: application form / download facts.
- `contact_source`: office phone, email, address or office facts.

Runtime tools must consume released projection records or retrieval documents. They must not stitch
these pages together at query time.

## Excluded Or Deferred Content

The first source pack excludes:

- `official_web/fresh_news` and `official_web/news_archive`.
- news, recruitment, procurement, seminar and event pages.
- latest/current-year admission and annual references without a freshness policy.
- library dynamic-shell pages, including the sampled library fee rule page, until source-truth
  replay proves clean canonical text.
- `https://www.muc.edu.cn/zzjg/xsjg.htm`, because the sampled output is shell-like/footer-heavy and
  does not currently expose a clean answer-bearing institution list.
- broad college-site expansion.
- full department phonebook collection.
- transactional actions such as submitting applications, placing calls or sending email.

Excluded rows may be retained as inventory examples only. They must not become release-ready
manifest rows by default.

## Eval Expectations

Execution must be able to test:

- tool routing for `service_guide_lookup`, `contact_directory_lookup` and stable-reference RAG.
- citation/source references for every answer-bearing row.
- fail-close behavior for excluded fresh news, dynamic-shell library pages, broad college-site
  questions and transactional actions.
- table-alignment safety for row-specific fee questions.
- offline composition for information disclosure questions before runtime consumption.
- source-faithful optional fields: missing office hours, emails or phone numbers are unavailable
  facts, not blockers when the source page does not provide them.

## Next Owner

Implementation ownership belongs to `official-web-source-pack-collection-execution` and later
ingestion-owned release lanes.

This workstream should reopen only if the accepted demand matrix, source case set, owner surface,
release target or excluded/deferred posture is explicitly changed.
