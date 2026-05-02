---
doc_type: assessment
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Source Content Assessment

## Purpose

This document records the content assessment that must happen before source pack URL selection.

The source pack should not start from a single topic such as information disclosure. It should start
from the actual official-web content families and then select only the pages that downstream tools
or serving surfaces can consume.

## Assessment Method

Current assessment uses targeted public official-web sampling across:

- `www.muc.edu.cn` for university core stable references.
- `xxgk.muc.edu.cn` for public disclosure, formal rules, fee/budget references and student
  administration policies.
- `met.muc.edu.cn` for information-technology services, service guides, support contacts and IT
  management rules.
- `lib.muc.edu.cn` only to assess whether library pages are simple enough for the first source
  pack. Dynamic-shell pages are excluded from first-slice collection.

This is not a broad crawl result. It is a content-family assessment used to decide what the first
one-time source pack should admit.

## Content Families

| Family | Examples observed | Downstream owner | First-slice posture |
|--------|-------------------|------------------|---------------------|
| `university_core_reference` | school introduction, organization units, brand identity pages, campus addresses | `official_web/stable_reference`; selected contact facts may feed `contact_directory_lookup` | Include a small high-value core set; avoid volatile leadership pages until refresh policy exists. |
| `campus_service_guide` | campus card services, VPN usage, campus network authentication, unified identity password reset, email service usage | `service_guide_lookup` | Include high-frequency service guides with source-backed procedure / entry / contact facts. |
| `service_contact_directory` | homepage footer, information disclosure contact, IT service hotlines, library public phone/address | `contact_directory_lookup` | Include only source-explicit contact facts; do not infer full department phonebook. |
| `institutional_policy_reference` | information disclosure implementation rules, IT system management rules, campus card management rules, email management rules, network access rules | `regulations/institutional_rules` or `official_web/stable_reference` depending on formal-rule status | Admit as candidates, but route formal rules through regulation-style lanes rather than service guide. |
| `student_policy_reference` | undergraduate status management, degree granting rules, student aid / award rules exposed on information-disclosure pages | `regulations/student_rules` or `regulations/institutional_rules` | Treat as regulation candidates; avoid duplicating existing handbook truth without version/owner reconciliation. |
| `public_fee_reference` | education fee table, budget / final-account public PDFs | `official_web/stable_reference` or future structured fee facts; PDF requires file asset loader | Start with fee table if HTML/table extraction is reliable; PDF budget packs need file-asset gate. |
| `library_service_reference` | opening hours widgets, library contact/footer, borrowing / fee rules, database service pages | future `contact_directory_lookup`, `service_status_lookup`, `service_guide_lookup` or stable reference depending on page | Exclude from first-slice collection if the page requires dynamic-shell extraction or currentness proof. |
| `admission_or_annual_reference` | annual招生章程,年度报告, current-year public reports | future current-year stable reference or news/notice runtime | Defer unless explicit current-year policy and eval exist. |
| `notice_news_event` | homepage/news announcements, seminars, recruitment, procurement notices | future notice/news runtime | Exclude from first source pack. |
| `college_site_reference` | college introductions, college contacts, college faculty pages | future expanded stable reference/contact pack | Exclude from first source pack except when a downstream owner explicitly admits a bounded target. |

## First-Slice Direction

The first source pack should be a balanced foundation, not an information-disclosure pack.

Recommended first-slice content groups:

1. `university_core_reference`
   - school introduction
   - teaching/research unit list
   - homepage footer addresses and switchboard phone
2. `campus_service_guide`
   - campus card service
   - VPN usage
   - campus network authentication
   - unified identity password reset / account access guidance if source-backed
3. `service_contact_directory`
   - information disclosure contacts
   - IT service hotlines
4. `institutional_policy_reference`
   - information disclosure implementation rules
   - IT system / email / campus card / network management rules as regulation candidates
5. `public_fee_reference`
   - education fee table as a stable reference candidate

Information disclosure remains one composition group inside this broader set. It should not define
the whole source pack.

## Deferral Rules

- Defer pages whose value depends on current-year freshness until a current-year policy exists.
- Defer pages whose only accessible content is PDF unless the shared file asset loader lane is in
  scope for that source pack.
- Defer dynamic-shell pages unless the source-truth replay can prove stable canonical text.
- Defer college-wide expansion until a specific downstream owner admits a target family.
- Exclude library dynamic-shell pages from the first source pack. They may be reopened only after a
  separate dynamic-shell source-truth proof shows clean replayable canonical text.
- Exclude news, recruitment, procurement and event pages from this workstream.

## Sample Source Evidence To Confirm In Phase 3

These are examples from sampling, not an accepted final URL manifest:

- `https://www.muc.edu.cn/xxgk1/xxjj.htm`
- `https://www.muc.edu.cn/zzjg/jxhkydw1.htm`
- `https://xxgk.muc.edu.cn/info/1005/1107.htm`
- `https://xxgk.muc.edu.cn/info/1302/1393.htm`
- `https://met.muc.edu.cn/info/1027/1127.htm`
- `https://met.muc.edu.cn/info/1046/1674.htm`
- `https://met.muc.edu.cn/info/1008/1846.htm`
- `https://met.muc.edu.cn/info/1068/1830.htm`
- `https://met.muc.edu.cn/fwzn/xsfw.htm`
