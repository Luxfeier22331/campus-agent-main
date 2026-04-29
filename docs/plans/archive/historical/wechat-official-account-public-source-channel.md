---
doc_type: plan
status: historical
created: 2026-04-23
updated: 2026-04-23
---

# WeChat Official-Account Public Source Channel

## 文档边界

本文固定 `wechat official-account public source channel` 这条 backlog workstream。

它负责：

- 校园公众号公开内容采集的 source-channel admission
- 第三方监测 / 订阅聚合 / 授权 API 路线的 provider 选择与合规边界
- `capture -> object storage -> app-api control plane -> ingestion-worker` 的接入形态
- 面向 `notice` / public-authority 内容的 downstream consumption opening

它不负责：

- 把第三方监测平台直接当长期 canonical truth owner
- 把公众号公开内容混写进现有 `official_web` source channel
- 采集私信、群聊、登录态或其他非公开内容

## Lifecycle Contract

- 本文是 archived backlog entry；repo 级 registry state 当前对应 backlog
- 是否恢复执行只看 `.planning/WORKSTREAMS.md`
- 本文只保留固定顺序、恢复前提与排除项

## Current Baseline

当前 merged truth 与已知前提：

- 仓库当前已冻结的公开来源 source channel 是 `official_web`；公众号公开内容还不是已 admission 的 source channel
- 无运营方授权时，微信官方开发接口不能直接作为“任意公众号公开内容采集”方案
- 当前这条需求先明确延后，因为 `notice` 与 `official_web` downstream consumption 还没准备好
- 第三方方案当前只可视作 future acquisition aid；即使后续先用单号方案做 POC，也必须先镜像进 repo-owned object storage 与 control plane

## Execution Contract

这条线恢复后始终按一条单独 workstream 推进：

1. source-channel admission and provider / compliance contract
2. collector or feed-ingest path into repo-owned object storage + `app-api` ledger
3. source-truth / projection / replay contract
4. downstream consumption opening for `notice` / public-authority surfaces
5. acceptance evidence and planning closeout

固定原因：

- acquisition provider、source-truth、control-plane 与 downstream opening 共享同一条长期 truth
- 如果在 consumption surface 未准备好前提前接入，只会把“抓到了但没人稳定消费”的半成品继续堆进数据面

## Fixed Rules

- 第三方 provider 只负责 acquisition，不是长期 truth owner
- 所有文章正文、元数据与外部引用都必须先镜像进 repo-owned object storage，再进入 downstream processing
- 不把公众号采集错误建模成 `official_web` crawl policy 的扩展分支
- 恢复这条线前，不把单次手工导出、浏览器下载或 SaaS 面板截图写成 canonical ingestion path

## Forward Phases

### Phase A: Source Admission And Provider Contract

目标：

- 明确公众号公开内容是否正式 admission 为新 source channel，以及 provider/compliance 边界

### Phase B: Capture And Control-Plane Ingestion

目标：

- 把选定 provider 的输出稳定镜像进 repo-owned object storage 与 `app-api` ledger

### Phase C: Source-Truth / Projection / Replay Contract

目标：

- 冻结公众号文章的 source-truth、projection 与 replay semantics

### Phase D: Downstream Consumption Opening

目标：

- 让 `notice` / public-authority consumption 真正能稳定消费这条 source channel

### Phase E: Acceptance Evidence And Planning Closeout

目标：

- 完成真实样本验收，并把 reopened 能力与残余 deferred item 写回 planning

## Exclusions

固定不包含：

- 微信私域内容或需账号授权的 closed content
- 把第三方 SaaS 账户当 repo 的长期审计边界
- 在 consumption lane 未 admission 前直接扩到 query-serving reopen

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看 `official_web` / data-plane / source-channel 相关 architecture docs
3. 最后回到本文确认 fixed rules、恢复前提与执行顺序
