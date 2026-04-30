---
phase: "9"
name: "Parser Hardening And Fail-Closed Body Semantics"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 9 Plan

## Goal

让 WeChat page parser 在真实 `mp.weixin` 页面上稳定提取正文、发布时间、
图片引用，并在验证码墙或非文章页上 fail-close。

## Scope

- 识别 verification / captcha 页面。
- 支持旧式 `#js_content` / `.rich_media_content` 页面。
- 支持现代 `window.cgiDataNew` shell：
  - `title`
  - `desc`
  - `content_noencode`
  - `ori_create_time`
  - `picture_page_info_list[].cdn_url`
- 使用 browser-profile request posture，避免 Linux UA 触发验证码墙。
- 保持 FeedWe summary 不进入正文 truth。

## Verification

- Unit tests cover canonical DOM pages, verification pages, and modern shell pages.
- Live capture verifies MUC travel notice body and media extraction from real page.
