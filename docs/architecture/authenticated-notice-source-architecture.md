---
doc_type: architecture
status: active
created: 2026-04-03
updated: 2026-04-05
---

# Authenticated Notice Source Architecture

## 文档边界

本文冻结 `authenticated_notice_portal` source channel 的 repo-level supporting architecture。

它回答的是：

- 登录态内部通知采集器、对象存储、ingestion/data plane 如何分层
- 这条 source channel 与 `official_web`、restricted document rollout 分别是什么关系
- collector runtime、bootstrap importer 与后续 control-plane 各自属于谁

它不负责：

- 当前 merged truth 已经实现到哪一步
- 具体站点登录方式、抓取脚本或 Playwright 细节
- 某个下游 collection 的 chunking / retrieval / operator UI 细节

## Core Topology

第一阶段接受的接入拓扑固定为：

`external scheduler -> authenticated notice collector -> object storage + typed bootstrap artifacts -> ingestion-worker -> document/chunk/index`

关键边界：

- collector 负责登录态复用、list/detail 抓取、正文/链接/附件增强、对象上传与 typed artifact 输出
- `apps/ingestion-worker` 负责 bootstrap import、source-truth 重建、document/chunk/index 写入
- `packages/ingestion-core` 负责 source-truth contract、projection、registry 与 release 语义
- 第一阶段不要求先落 `app-api` control plane

## Source Channel Rules

- `authenticated_notice_portal` 是一级 `source_channel`，不是 `official_web` 的特殊站点
- 这条 source channel 面向“登录态、机构内部通知”这类受限知识源
- downstream serving / retrieval 继续只消费 document / chunk / registry truth
- 当前 bootstrap seam 可以消费 typed export/import artifacts，但这些 artifacts 不是长期 canonical truth

## Source Unit

这条 source channel 的 canonical source unit 固定为：

- `notice`

不是：

- public web page
- crawl frontier URL
- collector 本地 SQLite row
- 本地文件路径

原因：

- 内部通知系统的稳定资源身份首先由 notice identity 决定
- list/detail API、正文 HTML、链接观测与附件关系都应围绕同一条 notice 归并

## Contract Split

- source-channel 运行边界：本文
- source-truth schema：`docs/architecture/authenticated-notice-source-truth-contract.md`
- shared data-plane 不变量：`docs/architecture/data-plane-architecture.md`
- restricted document authorization：`docs/architecture/identity-and-authorization-architecture.md`

## Collector Runtime Ownership

collector runtime 的第一 owner 固定为 repo 内独立 `apps/*` runtime shell。

推荐落点：

- `apps/authenticated-notice-collector`

它负责：

- 登录态 bootstrap / refresh
- source-specific list/detail fetch
- notice-level normalize / enrich
- 附件对象上传
- typed artifact 输出

它不负责：

- document registry
- chunking / embedding / index release
- retrieval serving truth
- restricted authorization projection 解释

## Bootstrap Import Ownership

在 collector 正式迁入 monorepo 并直接输出 repo-native artifacts 之前，允许存在一条 bootstrap import seam：

- 读取 typed export bundle
- 读取对象存储语义下的附件对象
- 重建 canonical raw/provider/source-truth

这条 seam 的 owner 固定为：

- `packages/ingestion-core`
- `apps/ingestion-worker`

它不应反向把外部 collector 的 SQLite / JSON schema 提升成 repo 级长期 contract。

## Restricted Rollout Posture

这条 source channel 的首个下游 collection 默认按 restricted institutional document rollout 处理。

推荐首个落点：

- `campus_notices/internal_notice`

默认姿态：

- `serving_stage=offline_preparation`
- 优先独立 restricted collection
- document / chunk projection 以 `visibility_* + entitlement_*` 为主

## Future Control Plane

如果后续需要 run admission、heartbeat、operator read model 与 ingestion handoff，长期规则固定为：

- 必须新增 dedicated authenticated notice control-plane domain
- 不复用现有 `official_web` command/query surfaces
- 不把 collector control plane 混回 `apps/ingestion-worker`

这是一条前向约束，不表示当前 merged truth 已经实现该 control plane。

## Async Staged Closeout

Phase 12.2 已把 authenticated notice historical closeout 重构为 async staged pipeline，后续吞吐升级为 planning/worker split + batch-leased executor，详见：

- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`

固定规则：

- 每次 run 的 operations truth 落在 `campus_notices/operations/authenticated-notice-closeout/{run_id}/`
- run lifecycle 固定为 `planning -> planned -> running -> verifying -> verified -> promoting -> done|failed`
- planner 负责读取 frozen bundle、生成 shard/batch plan，并把每个 batch 的 frozen input slice 写入 operations prefix
- shard 负责 planning / aggregation；真正的执行单元是 leased batch
- worker / batch 可以并发写 source-truth objects 与 staged document objects
- worker 只允许读取自己 claim 到的 batch input，不得重新 eager prepare 整份 bundle
- staging state 固定落在 `ingestion_closeout.closeout_*` 表，其中 batch / worker truth 由 `closeout_batches` / `closeout_workers` 持有
- batch notice/raw/document rows 与 run/shard/batch/worker 聚合状态必须在同一事务内提交
- shard 不得直接写 canonical `campus_notices/documents/internal_notice`
- 所有 batch 完成后，只允许一个 finalizer 把 run 切到 `verifying` 并执行 metadata-driven verification
- 只有单个 promoter 可以复制 staged document artifacts、构造 final registry rows、执行 `replace_scope`
- promoter 内部允许并发 object-store native copy，但 single-writer scope mutation 语义不变
- operator status / progress 读取 operations prefix 与 staging tables，而不是通过 rerun checkpoint 获取；`show` / `watch` 必须只读聚合 progress truth，不扫描全量 staged rows

## Current Status

当前文档冻结的是前向 accepted direction。

它不表示：

- `authenticated_notice_portal` 已经进入当前 merged truth
- 当前 repo 已经存在对应 collector app、collection config 或 operator surface

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 为准。

## Forbidden Shapes

- 不把登录态内部通知伪装成 `official_web`
- 不把 collector 的 SQLite 当成 repo 级 canonical truth
- 不把 `local_path` 提升成对象存储真相
- 不直接把 export JSON 当 query-serving collection
- 不让 collector 直接写 document registry、chunk 或 index
- 不让 restricted rollout 依赖 prompt-only 软约束

## 相关稳定文档

- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`
- `docs/plans/restricted-document-rollout-and-verification.md`
