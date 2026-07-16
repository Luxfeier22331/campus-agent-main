---
doc_type: data
owner_boundary: sources/wechat-official
status: active
---
# 微信公众号数据

## 边界

FeedWe 用于发现历史文章。正式 source evidence 来自同一次 collector activity 抓取的真实微信
文章页面与媒体。该数据是离线 source truth，不是 notice read model 或在线查询 target。

## 请求

`wechat_official_account_capture_request.v1` 包含 account identity 和有界 page/article 控制。
请求存入 source bucket，再通过 `wechat_official_account.capture` 提交。

## 文章产物

每个 article version 可以包含：

- attempt 范围内的 provider response 与 request summary；
- attempt 范围内抓取的 article HTML 与 fetch metadata；
- parser extraction；
- 正式采集的 cover/inline media 及 attempt 范围内的 fetch metadata；
- `source-truth/article-manifest.json`；
- `source-truth/content-blocks.jsonl`；
- `source-truth/media-refs.jsonl`。

`wechat_official_account_article_manifest.v3` 保留稳定 account/article identity、canonical URL、
provider identity、publish time、normalized title、body state、page kind/parser version、hash、
block/media count 和 media capture outcome。content block 只包含已观察到的 title、summary 与
body text。

`wechat_official_account_media_ref.v3` 保留 source/final URL、object key、digest、type、size、
status 与 failure detail。capture timestamp 不是正式字段。

内容不变的 retry 必须生成 bytes 完全相同的 article manifest 与 media ref。raw page HTML、
FeedWe summary 和 page/media fetch metadata 写入
`runs/<run-id>/attempts/<activity-attempt>/...`。

## 采集发布

采集结束后 worker 写入：

```text
wechat_official_account/<account_slug>/runs/<run_id>/attempts/<activity_attempt>/capture-release.json
```

release 通过同桶 ref 引用 article manifest、content block 与 media ref。worker 验证这些 ref
后写入 `wechat_official_account_source_manifest.v1`，再返回一个带有界数量的
`ingestion_task_result.v1` ref。

## 存储边界

- 对象存储拥有 source artifact 与 release；
- Temporal 拥有 execution state 与 attempt；
- PostgreSQL 只保存共享 ingestion task 投影；
- app-api 没有微信公众号 collector route、token、run ledger 或 projection table。

## 下游边界

跨来源去重、notice 归一化、authorization、publication、chunking 与 online retrieval 尚无本
链路合同，不得因此修改已采集的 article evidence。

## 相关文档

- `docs/architecture/system/data-plane.md`
