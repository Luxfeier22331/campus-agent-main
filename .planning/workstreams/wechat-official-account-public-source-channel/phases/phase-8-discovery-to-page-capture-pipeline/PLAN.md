---
phase: "8"
name: "Discovery-To-Page Capture Pipeline"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 8 Plan

## Goal

把 collector 改成两段式采集：FeedWe 负责发现文章 URL，collector 再抓取真实
`mp.weixin` 页面和媒体资产并写入 source bucket。

## Scope

- 保留 FeedWe 登录、订阅和文章列表 discovery。
- 对每篇文章以 FeedWe 给出的 `article.url` 抓取真实微信页面。
- 写入 `wechat-article-fetch-metadata.json` 与 `wechat-article-page.html`。
- 在页面解析后抓取 cover / inline image，并把图片对象与 metadata 一起写入 source bucket。
- collector 不写 projection、read model、registry 或 query runtime。

## Verification

- collector tests cover real article HTML and image artifact persistence.
- live Phase 12 capture evidence proves source bucket has raw page, parser output,
  source-truth, media metadata, and media objects.
