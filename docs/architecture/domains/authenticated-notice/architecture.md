---
doc_type: architecture
truth_scope: data
owner_boundary: domains/authenticated-notice
status: active
created: 2026-04-03
updated: 2026-06-26
---
# Authenticated Notice Source Architecture

## 文档边界

本文冻结 notice-oriented authenticated source channel 的 repo-level supporting
architecture。当前主语义 owner 是 `authenticated_notice_portal`，并补充记录同族的
`wechat_official_account` source-channel truth 应如何进入整体叙事。

它回答的是：

- 登录态内部通知 source channel 的 collector、source bucket、run ledger、
  ingestion/data plane 如何分层
- `apps/app-api` 在 authenticated notice processing 中已经拥有哪一层
  control-plane / operator-safe projection truth
- `authenticated_notice_portal`、`internal_notice`、`file_release_source` 与
  regulation downstream 分别是什么关系
- `wechat_official_account` 应以什么力度进入当前架构叙事

它不负责：

- 当前某条 workstream 或 phase 的 closeout 历史
- 具体登录方式、Playwright 细节、抓取脚本实现步骤
- 某个下游 collection 的 chunking、retrieval、answer synthesis 或 serving
  rollout 细节
- 把尚未开放的 source-channel path 冒充成当前默认 product surface

## Core Topology

当前接受的 notice-oriented source-channel topology 固定为：

`collector -> source bucket + run ledger -> ingestion-control -> source-truth /
document holding -> explicit downstream admission`

对 `authenticated_notice_portal`，当前 merged truth 已额外具备一条 app-owned operator-safe
projection path：

`collector / ingestion outputs -> app-api authenticated_notice_processing
projection ingest -> Operator Console list/detail query`

这表示当前架构存在四层清晰分工：

- `source channel`
  - collector runtime、capture boundary、source artifact、run ledger
- `data plane`
  - ingestion-control、ingestion-core、source-truth、document holding、projection /
    release / downstream admission；Python worker 仅作为 extraction adapter island
- `operator projection`
  - `app-api` 拥有的 authenticated notice processing operator-safe ingest 与
    list/detail query
- `runtime / serving seam`
  - notice discover/get runtime、regulation
    downstream、future serving rollout

这四层不得混写成一层“通知系统”。

## Source-Channel Family

当前 notice-oriented source-channel family 至少包含两条语义不同的来源：

- `authenticated_notice_portal`
  - 登录态内部通知源
  - 主要承接内部 notice 与 file-release family 的 source capture /
    source-truth / downstream admission
- `wechat_official_account`
  - 公开公众号通知源
  - 当前已验证真实 WeChat 页面抓取、正文与媒体同 run capture、
    source-truth schema 与 offline projection handoff

统一约束：

- 两者都属于 notice-oriented source-channel family，但不是同一条 source channel
- 两者都可以进入 source/data/control-plane truth，但不因为 capture path
  已验证，就自动变成当前默认 query-enabled surface
- `wechat_official_account` 当前只按“已验证 source/data/control-plane path”
  进入架构叙事；它不是近期已开放的 product runtime 承诺
- notice-oriented source channel 的 downstream serving 是否打开，始终由各自
  collection/runtime profile 与 product opening gate 决定，而不是由 collector
  成功与否决定

## Authenticated Notice Portal Boundary

`authenticated_notice_portal` 是一级 `source_channel`，不是 `official_web`
的特殊站点，也不是 Operator Console runtime 或 notice tool runtime 的别名。

它当前承接两个 source surface：

- `notice`
- `file_release`

固定边界：

- collector 负责登录态复用、list/detail 抓取、正文/链接/附件增强、对象上传、
  run ledger 写入与 typed handoff artifact 输出
- `apps/ingestion-control` 负责按 admitted task 读取 explicit source bucket object refs
  对应的 source artifact，重建 source-truth / holding，并在显式 downstream admission
  后进入后续 projection 或 release；`run_id` 只能作为可审计 metadata / ledger lookup key，
  不能替代 object-store input contract
- `packages/ingestion-core` 负责 source-truth contract、projection、registry 与
  release semantics
- `apps/app-api` 不拥有 source-truth、对象存储、queue mutation、lease/retry/
  dead-letter 或 data-plane executor truth
- `apps/app-api` 已拥有 authenticated notice processing 的 operator-safe
  projection ingest 与 list/detail query

因此，当前 accepted shape 不是“先做 source import，以后再考虑 app-api control plane”，而是：

- source/data plane 已经独立成立
- app-api operator projection 也已经是 merged truth
- 二者 owner 不同，职责不得互相吞并

## Notice Surface And File-Release Surface

### `notice`

对 `notice` surface，canonical source unit 仍固定为 `notice`。

不是：

- public web page
- crawl frontier URL
- collector 本地 SQLite row
- 本地文件路径

原因不变：

- 稳定资源身份首先由 notice identity 决定
- list/detail API、正文 HTML、链接观测与附件关系都应围绕同一条 notice 归并
- `notice_browser_url` / `portal_print_url` 这类浏览入口 metadata 不替代
  canonical source identity、source notice link、raw asset id 或 document id

### `file_release`

`file_release` 当前固定为 object-backed authenticated document source 的输入
surface，必须与 `notice` 分开采集、分开导出、分开 admission。

它的 source-channel holding scope 为：

- `authenticated_documents/file_release_source`

固定限制：

- 只允许具备可验证 object-store bytes 的 released source rows 进入
  `file_release_source`
- `reference_only` file_release 只能停在 capture evidence / operator gap，
  不进入 document holding
- 不进入 `campus_notices/internal_notice`
- 不把 `file_release` source surface 提升成 canonical `notice`
  source-truth 或默认 query-serving surface

旧的 `campus_notices/file_release_capture` 只能作为 historical capture /
repair 对象出现；它不是新的 cross-runtime handoff target，也不是长期
query-serving surface。

## Object-Native Handoff

collector 与 ingestion-control 之间的主链路 handoff 固定通过：

- S3-compatible source bucket
- relational run ledger
- ingestion-control task envelope 中的 object-store artifact refs

不是：

- 本地导出目录
- 共享 volume 假设
- 只靠 Operator Console projection 恢复 source-truth
- 只传 `collector-run://...` 后由 executor 隐式猜测 bundle / manifest

clean target 中，`source_truth_materialize` 的 mainline input 必须指向 source bucket
中的 bundle / manifest / source-truth artifact，使用 `input_ref.kind=object_store` 与
`s3://...` URI。`run_id`、site id 与 source surface 只用于 idempotency、audit、
operator projection 与 ledger correlation。

历史代码中曾存在的 `inline` collector-run task envelope 已作为 staged migration
residue 移除。剩余迁移完成判据是 verified collector run 通过 object-store refs 被
`apps/ingestion-control` admit / claim / execute / complete，并产出
`authenticated_notice_source_truth.v1` artifact closeout。

local bundle / manifest path 只允许作为显式 fixture/dev 输入，不是 Docker mainline 的成功形态。

## App-API Operator Projection Boundary

`apps/app-api` 当前已拥有 authenticated notice processing 的 app-owned operator-safe
projection domain。

它当前负责：

- processing projection ingest
- Operator Console-facing list/detail query
- operator-safe status/read model exposure
- caller class / admission rule 固定的 HTTP route exposure

它当前不负责：

- raw notice content 浏览器
- raw OCR payload / 附件字节暴露
- source bucket 浏览器
- collector scheduler
- queue mutation API
- ingestion executor callback / retry / lease / dead-letter truth

因此，Operator Console query/operator projection 只能被描述成 app-owned
read/control-plane seam，不能被描述成 source-truth owner、对象存储
owner 或 ingestion runtime owner。

## Internal Notice And Regulation Split

`authenticated_notice_portal` source channel 与下游 collection 之间继续保持
显式 admission split。

### `campus_notices/internal_notice`

它是 notice-derived source holding / offline preparation /
notice-consumption projection family。

当前固定语义：

- 保存 source notice、canonical markdown、attachment truth
- 承接 offline classification、authority / completeness / answerability、
  target surface 与 consumption status
- 附件与媒体处理分类使用 `multimodal_processing` / machine-processing
  术语；不恢复 legacy manual-review projection state
- notice read model 与 notice runtime 只读取 projection/read model，
  不重新拥有 source truth
- 当前 posture 仍不是默认公开 serving surface

### `authenticated_documents/file_release_source`

它承接 object-backed released original、inventory / raw-asset truth 与
document holding rows，用于 owner-specific downstream admission。Authenticated
document center 旧设想已退役，不属于当前主问答产品目标。

### regulation downstream

- regulation downstream 必须通过显式 downstream admission 打开
- 它们消费 source/data-plane truth，但不反向改写 source-channel truth
- 不得把 wrapper notices、capture evidence 或 source holding
  直接冒充成 regulation canonical surface

## WeChat Official Account Placement

`wechat_official_account` 当前已经具备：

- source-truth schema
- real `mp.weixin.qq.com` page capture boundary
- article body + inline media same-run capture truth
- collector principal / run ledger / app-api command ingress truth
- offline notice-consumption projection handoff shape

但当前默认只接受以下表述：

- 它是已验证、已冻结 schema 的 source channel
- 它属于当前 repo 的 source/data/control-plane truth
- 它尚不是默认 query-enabled surface
- 它尚不是近期已开放的 product runtime / chatbot serving 承诺

因此：

- 可以在 current architecture、data schema、source-channel family 叙事中出现
- 不应被写成“当前产品已接入 WeChat 查询”
- 不应被写成“近期即将 rollout WeChat”

## Contract Split

- source-channel runtime / boundary：本文
- authenticated notice source-truth schema：
  `docs/data/authenticated-notice-source-truth-schema.md`
- WeChat source-truth schema：
  `docs/data/wechat-official-account-source-truth-schema.md`
- authenticated notice processing app-api seam：
  `docs/contracts/app-api-authenticated-notice-processing-http.md`
- notice discover/get runtime seam：`docs/contracts/campus-notice-runtime-contract.md`
- file-release collector export contract：
  `docs/reference/authenticated-notice-file-release-export-contract.md`
- shared file asset loader：
  `docs/architecture/system/file-asset-loader-architecture.md`
- shared data-plane invariants：`docs/architecture/system/data-plane-architecture.md`
- account / operator access / memory binding：
  `docs/architecture/system/identity-and-authorization-architecture.md`

## Writing Rules

后续文档引用这一领域时，默认遵守以下口径：

- 区分 source channel、data plane、operator projection、runtime / serving seam
- `authenticated_notice_portal` 与 `wechat_official_account`
  都可被记录为 notice-oriented source family，但当前开放 posture 不同
- app-api operator projection 不等于 source/data-plane owner
- capture path 已验证不等于 product serving 已开放
