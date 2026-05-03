---
doc_type: design
status: completed
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Downstream Demand Matrix

## Purpose

This matrix freezes the first official-web source pack demand from the product side.

The matrix is content-family-first. Information disclosure is one representative composition group,
not the first-slice center of gravity.

Rows are user intents that a current or near-current product surface should answer. Source pack URLs
must be admitted only when they serve one or more rows below.

## Owner Surface Legend

- `service_guide_lookup`: read-only structured service procedure, material and entry facts.
- `contact_directory_lookup`: read-only structured phone, email, location and office-hour facts.
- `service_status_lookup`: current operational status / opening-hours facts when source currentness
  can be proven.
- `official_web/stable_reference`: stable public-web reference retrieval surface.
- `regulations/*`: formal rule or implementation detail when the official page carries regulation
  semantics.
- `future_notice_runtime`: excluded from first slice unless explicitly reopened.

## First-Slice Demand By Content Family

| Demand ID | Content family | Example user question | Owner surface | Expected facts | Runtime answer shape |
|-----------|----------------|-----------------------|---------------|----------------|----------------------|
| `owsp-core-school-profile` | `university_core_reference` | 中央民族大学是什么学校？有几个校区？ | `official_web/stable_reference` | school profile, campus count/names, source refs | concise stable reference answer with citation |
| `owsp-core-org-units` | `university_core_reference` | 中央民族大学有哪些学院或教学科研单位？ | `official_web/stable_reference` | organization unit names, source refs | list or summarized organization facts with citation |
| `owsp-core-main-contact` | `service_contact_directory` | 中央民族大学总机电话和地址是什么？ | `contact_directory_lookup` | addresses, phone/fax if source-backed | contact facts; no inferred department directory |
| `owsp-it-campus-card-guide` | `campus_service_guide` | 校园卡丢了怎么办？怎么补卡？ | `service_guide_lookup` | loss reporting, replacement, location/contact, source refs | procedure and service entry facts |
| `owsp-it-campus-card-contact` | `service_contact_directory` | 校园卡服务电话是多少？ | `contact_directory_lookup` | service hotline, service point, source refs | contact facts or source-backed unavailable |
| `owsp-it-vpn-guide` | `campus_service_guide` | 校外怎么用 VPN 访问校园网资源？ | `service_guide_lookup` | VPN entry URL, login requirements, client/direct modes, source refs | step summary plus entry refs |
| `owsp-it-network-auth` | `campus_service_guide` | 校园网怎么认证登录？ | `service_guide_lookup` | wired/wireless login flow, account/password basis, source refs | procedure with campus/audience caveats |
| `owsp-it-password-reset` | `campus_service_guide` | 统一身份认证密码怎么改？ | `service_guide_lookup` | portal entry, reset/change steps, source refs | short procedure and entry URL |
| `owsp-it-email-policy` | `institutional_policy_reference` | 民大邮箱谁可以用？邮箱后缀是什么？ | `regulations/institutional_rules` or `official_web/stable_reference` | eligibility, domain suffix, application rules, source refs | policy answer; not service-guide-only |
| `owsp-info-disclosure-scope` | `institutional_policy_reference` | 哪些学校信息可以公开？哪些不能公开？ | `regulations/institutional_rules` or `official_web/stable_reference` | active disclosure scope, non-disclosure categories, source refs | policy summary with citation |
| `owsp-info-disclosure-apply` | `campus_service_guide` | 信息公开怎么申请？申请表在哪下载？ | `service_guide_lookup` plus composition | procedure, material/download refs, responsible office, source refs | composed service guide answer |
| `owsp-info-disclosure-contact` | `service_contact_directory` | 信息公开办公室电话和邮箱是什么？ | `contact_directory_lookup` | department, phone, email, address, source refs | contact facts; missing fields fail closed |
| `owsp-fee-reference` | `public_fee_reference` | 学校学费和住宿费标准在哪里看？ | `official_web/stable_reference` or future structured fee facts | fee table title/rows, source refs, effective caveat | source-faithful reference; no unsupported calculation |

## Explicitly Excluded In First Slice

| Intent | Reason |
|--------|--------|
| 最新通知、最近新闻、今天公告 | Requires `fresh_news` / notice runtime opening, not this workstream. |
| 招聘、公示、采购结果查询 | Notice/news/procurement surfaces are not opened by this source pack. |
| 年度招生章程最新版问答 | Needs current-year/freshness policy and likely separate admission source family. |
| 图书馆动态壳规则/开放时间页面 | Dynamic-shell extraction and currentness proof are too complex for first-slice one-time collection. |
| 帮我提交申请、预约或办理 | Transactional action; supervisor terminal guardrail should handle. |
| 帮我打电话或发邮件 | Executable communication action; contact tool returns facts only. |
| 任意部门全量电话簿 | Needs a dedicated contact-directory expansion, not a first source pack. |
| 学院站全量问答 | Too broad; admit bounded college targets only when a downstream owner exists. |
| 官网全站问答 | Violates tool-driven source pack boundary. |

## Information Disclosure As One Composition Group

`composition_group = information_disclosure`

Expected component roles:

- `policy_source`: implementation rule / policy page for disclosure scope, non-disclosure scope,
  answer deadline and governance facts.
- `procedure_source`: application process page for how-to-apply facts.
- `material_source`: form download page for application form facts.
- `contact_source`: contact page or official page block for office contact facts.

Runtime tools must not compose these pages at query time. Ingestion must create source-linked
projection records or retrieval documents first.

## Source Pack Selection Rule

Phase 3 must select URLs from the content-family assessment, not from this matrix alone.

For each URL, record:

- which demand IDs it supports
- which owner surface consumes it
- whether it is answer-bearing or discovery-only
- whether it is HTML, dynamic shell, or file asset
- whether it is a standalone record or a composition component
- which release/eval gate must pass before serving
