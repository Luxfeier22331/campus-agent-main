---
doc_type: design
status: completed
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Source Collection Cases

## Purpose

This document turns sampled official-web pages into concrete collection and consumption cases.

These are not the final source pack manifest rows. They are case studies used to infer the capture,
source-truth, projection and runtime consumption chain before Phase 2 defines the manifest schema.

## Common Chain

All admitted cases should follow the same boundary:

```text
source pack manifest URL
-> one-time fetch
-> capture/provider/source-truth artifacts
-> projection replay
-> typed candidate or canonical document
-> release gate
-> runtime projection or retrieval surface
-> answer with source refs
```

Runtime tools must not fetch or compose official-web pages at query time.

## Case 1: School Introduction

- URL: `https://www.muc.edu.cn/xxgk1/xxjj.htm`
- Content family: `university_core_reference`
- Observed facts:
  - school history and positioning
  - three campus names / addresses
  - switchboard phone and fax
- Primary owner:
  - `official_web/stable_reference` for institutional profile answers
- Secondary owner:
  - `contact_directory_lookup` may consume homepage/profile address and switchboard facts only if
    source-explicit contact extraction is admitted
- Collection path:
  - capture as HTML source truth
  - emit stable-reference document
  - retain footer contact facts as contact candidate only if deterministic extraction separates
    footer facts from profile text
- Runtime examples:
  - "中央民族大学是什么学校？" -> RAG stable reference answer
  - "中央民族大学有几个校区？" -> RAG stable reference answer with campus names
  - "中央民族大学总机电话是多少？" -> contact directory if promoted; otherwise RAG citation or fail-close
- Risk / gate:
  - the page contains long political/institutional narrative; chunking must preserve factual
    profile sections and avoid over-answering from generic slogans
  - footer contact facts must not create a fake full department directory

## Case 2: Teaching And Research Unit List

- URL: `https://www.muc.edu.cn/zzjg/jxhkydw1.htm`
- Content family: `university_core_reference`
- Observed facts:
  - colleges, departments, research institutes and non-independent platforms
  - links to some college / institute hosts
- Primary owner:
  - `official_web/stable_reference`
- Collection path:
  - capture as HTML source truth
  - emit stable-reference document or structured organization reference candidate
  - do not expand linked college hosts in this source pack
- Runtime examples:
  - "中央民族大学有哪些学院？" -> stable reference list answer
  - "国家语言资源监测与研究民族语言中心属于哪里？" -> stable reference answer from unit list
- Risk / gate:
  - this is a directory page but it is answer-bearing for organization questions
  - linked college pages are discovery-only unless a separate downstream owner admits them

## Case 3: Campus Card Service

- URL: `https://met.muc.edu.cn/info/1027/1127.htm`
- Content family: `campus_service_guide`
- Observed facts:
  - card introduction
  - services for receiving a new card, password change, loss reporting, spending limit change,
    replacement, transaction inquiry, un-loss, information correction
  - Haidian / Fengtai service locations and phone numbers
- Primary owner:
  - `service_guide_lookup`
- Secondary owner:
  - `contact_directory_lookup` for service point phone/location facts
- Collection path:
  - capture as HTML source truth
  - replay to `service_guide_candidate`
  - selected-write release task writes `campus_services/service_guide`
  - optional contact projection fan-out only if contact facts pass field-aware extraction
- Runtime examples:
  - "校园卡丢了怎么办？" -> service guide procedure
  - "校园卡怎么补办？" -> service guide procedure and location
  - "丰台校区校园卡服务电话是多少？" -> contact directory if promoted
- Risk / gate:
  - a single page contains multiple sub-services; projection should create either one compound
    service guide with sections or multiple service records with shared source refs
  - service locations are structured facts, not navigation route answers

## Case 4: Campus Network Authentication Guide

- URL: `https://met.muc.edu.cn/info/1008/1846.htm`
- Content family: `campus_service_guide`
- Observed facts:
  - wired and wireless access flows
  - campus-specific steps for Haidian and Fengtai
  - authentication portal `rz.muc.edu.cn`
  - account/password basis and support phone facts
- Primary owner:
  - `service_guide_lookup`
- Secondary owner:
  - `contact_directory_lookup` for network service phone if promoted
- Collection path:
  - capture HTML
  - image references are supporting visual evidence but not required if text steps are sufficient
  - emit service guide candidate with `procedure`, `entry_refs` and support contact refs
- Runtime examples:
  - "校园网怎么认证登录？" -> service guide procedure
  - "丰台校区校园网还需要注册吗？" -> service guide campus-scoped answer
  - "校园网认证网址是什么？" -> entry ref answer
- Risk / gate:
  - page also links to a PDF/manual asset; HTML can serve first slice, file asset loader can enrich
    later
  - source has images; first slice should not depend on OCR unless text is insufficient

## Case 5: VPN System Usage

- URL: `https://met.muc.edu.cn/info/1046/1674.htm`
- Content family: `campus_service_guide`
- Observed facts:
  - VPN purpose
  - direct browser access via `https://vpn.muc.edu.cn`
  - Windows / Mac / iOS client access steps
  - downloadable manual attachment
- Primary owner:
  - `service_guide_lookup`
- Collection path:
  - capture HTML source truth
  - emit service guide candidate with `procedure` and `entry_refs`
  - register downloadable manual as a file asset candidate, but do not block first-slice HTML guide
    on attachment extraction
- Runtime examples:
  - "校外怎么访问校园网资源？" -> VPN guide answer
  - "VPN 地址是什么？" -> entry ref answer
  - "Mac 怎么装 VPN 客户端？" -> service guide section answer if source text remains sufficient
- Risk / gate:
  - the page is image-heavy; if future questions require screenshot-only details, shared file /
    image extraction becomes required
  - attachment materialization must not be hardcoded into this single page

## Case 6: Information Disclosure Implementation Rules

- URL: `https://xxgk.muc.edu.cn/info/1005/1107.htm`
- Content family: `institutional_policy_reference`
- Observed facts:
  - information disclosure principles and organization
  - active disclosure scope
  - application disclosure process and answer constraints
  - non-disclosure constraints
  - supervision / assessment rules
- Primary owner:
  - `regulations/institutional_rules` if treated as formal rule text
  - otherwise `official_web/stable_reference`
- Secondary owner:
  - `service_guide_lookup` may consume derived application-related facts only through offline
    composition
- Collection path:
  - capture HTML source truth
  - classify as policy / rule reference, not service guide
  - materialize canonical document or stable reference
  - optionally extract service guide fields into the `information_disclosure` composition group
- Runtime examples:
  - "哪些信息可以公开？" -> policy / stable reference answer
  - "哪些信息不能公开？" -> policy / stable reference answer
  - "信息公开多久答复？" -> policy answer, with service guide composition only if extracted
- Risk / gate:
  - must not be flattened into the application-process service guide
  - if routed to `regulations/*`, owner-text/title/version policy must match regulation release lane

## Case 7: Information Disclosure Application Pages

- URLs:
  - `https://xxgk.muc.edu.cn/info/1007/1113.htm`
  - `https://xxgk.muc.edu.cn/info/1007/1114.htm`
  - `https://xxgk.muc.edu.cn/xxgk/lxfs.htm`
- Content family:
  - `campus_service_guide`
  - `service_contact_directory`
  - `service_material_reference`
- Primary owners:
  - `service_guide_lookup` for procedure / application form
  - `contact_directory_lookup` for public disclosure office contact
- Collection path:
  - capture each page separately
  - assign roles under `composition_group = information_disclosure`
  - release one composed service guide record with per-field source refs
  - release contact facts separately if they pass contact gate
- Runtime examples:
  - "信息公开怎么申请？" -> composed service guide answer
  - "信息公开申请表在哪下载？" -> material / entry answer
  - "信息公开办公室电话是多少？" -> contact directory answer
- Risk / gate:
  - form page should not be blocked because it lacks procedure; it is a material component
  - procedure page, form page and contact page must not be query-time stitched by runtime

## Case 8: Education Fee Disclosure Table

- URL: `https://xxgk.muc.edu.cn/info/1302/1393.htm`
- Content family: `public_fee_reference`
- Observed facts:
  - fee item
  - billing unit
  - fee standard
  - charge scope / object
  - approval authority and document number
- Primary owner:
  - first slice: `official_web/stable_reference`
  - future: structured fee facts if product admits fee lookup
- Collection path:
  - capture HTML source truth
  - preserve table-like block order
  - emit stable reference document unless a structured fee projection is admitted later
- Runtime examples:
  - "住宿费标准在哪里看？" -> stable reference answer with source and caveat
  - "艺术类本科学费是多少？" -> only answer if table extraction keeps row alignment
- Risk / gate:
  - table extraction is mandatory before answering row-specific fee questions
  - if row alignment is not deterministic, only answer "where to view" and cite source, not exact fee

## Case 9: Excluded Library Fee Rule / Dynamic Shell Page

- URL: `https://lib.muc.edu.cn/engine2/d/9285046/667831/1?p=87948&t=5267574`
- Content family: `library_service_reference`
- First-slice decision:
  - excluded from collection scope
- Observed facts:
  - title indicates library fee management rule
  - dynamic-shell output contains template placeholders in public crawl snippets
  - library footer exposes address, postal code and office phone
- Primary owner:
  - none in the first source pack
  - future `official_web/stable_reference` or `regulations/*` only after a separate dynamic-shell
    source-truth proof
- Collection path:
  - do not include in the first source pack manifest
  - record as a deferral example showing why dynamic-shell pages are excluded
  - reopen only after dynamic-shell replay can prove canonical text without unresolved placeholders
- Runtime examples:
  - "图书馆收费管理规定是什么？" -> first-slice should fail-close / unavailable
  - "图书馆办公电话是多少？" -> do not answer from this dynamic-shell page
- Risk / gate:
  - this is the strongest example for not doing broad crawl first
  - dynamic shell support must prove replayable source truth before any future serving

## Case 10: Library Opening-Hours Signal

- Example URLs:
  - `https://lib.muc.edu.cn/engine2/general/more?appId=515526&currentBranch=1&pageId=87948&typeId=5155307&websiteId=64168&wfwfid=24149`
  - `https://lib.muc.edu.cn/engine2/general/9283361/detail?engineInstanceId=699558&pageId=87948&typeId=`
- Content family: `library_service_reference`
- Observed facts:
  - snippets expose `7:00-22:00`
  - one article title indicates extended closing time for Haidian campus library
- Primary owner:
  - `service_status_lookup` only if currentness and effective window can be proven
- Collection path:
  - capture as candidate evidence only
  - do not publish current opening status until source currentness/effective window is explicit
  - if only historical notification evidence exists, route to historical/reference answer or fail-close
- Runtime examples:
  - "图书馆今天几点关门？" -> fail-close until current schedule projection exists
  - "图书馆是否有延长闭馆时间的通知？" -> future notice/news runtime, not this workstream
- Risk / gate:
  - opening-hours answers are current-state answers, not generic RAG answers
  - stale snippets must not become current service status truth

## Consumption Summary

| Chain | Cases | First-slice action |
|-------|-------|--------------------|
| HTML stable reference -> RAG | school introduction, organization units, fee table if table-safe | include after chunk/eval gate |
| HTML service guide -> structured projection | campus card, campus network, VPN | include after selected-write service guide gate |
| HTML contact facts -> structured projection | homepage/profile footer, IT service phones, disclosure contact | include after contact extraction gate |
| Policy/rule page -> regulation/stable reference | information disclosure rules | include only through rule/reference release lane |
| Multi-page composition -> service guide | information disclosure application | include after offline composition contract |
| Dynamic shell candidate -> excluded | library pages | exclude from first source pack; reopen only with separate dynamic-shell proof |
| File asset candidate -> deferred enrichment | VPN manual, network PDF, fee/budget PDFs | defer unless shared file asset loader is in scope |
