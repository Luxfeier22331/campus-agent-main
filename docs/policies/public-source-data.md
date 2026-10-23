---
doc_type: policy
owner_boundary: docs/policies
status: active
---
# 公开仓库数据策略

## 边界

本策略规定公开仓库可以跟踪哪些 source、fixture、config 和 data-like artifact。

是否包含学校信息不是唯一判断标准。归属项目、权利清楚、稳定且适合代码审查的数据可以进入
仓库；持续变化、受认证限制、体积较大或由运行时生成的数据应进入 database、object storage
或对应 provider system。

本策略不管理 private content pack、object-store artifact、production database 或内部运维
evidence 的具体保留周期。

## 允许进入仓库

- source code、schema、validator、migration 与公开文档；
- 不包含来源原文的 synthetic fixture、eval case 与 mini-corpus；
- 已记录所有权的 self-authored seed、示意图、坐标、GeoJSON 或 tile；
- 具有明确再分发权利、provenance、attribution 与兼容 license 的第三方或来源派生 artifact；
- 不复制受限正文的 attribution-only metadata；
- 只含 placeholder 的 `.env.example`；
- namespace-neutral Kubernetes workload base 与 placeholder deployment input。

项目自己标注或绘制的地图数据不会仅因“真实”而被排除；从 OSM、供应商、学校网站或其他来源
复制、转换的数据，必须先确认上游许可与再分发条件。attribution 本身不等于获得再分发权利。

## 禁止进入仓库

- secret、token、password、database URL、private endpoint 或 object-store key；
- 无再分发权利的 raw notice、采集 HTML、attachment、OCR output、source-derived document 或
  地图数据；
- 权利不清楚的真实评测样例、标准答案、照片、logo、模型或 tokenizer 资产；
- canonical document artifact、chunk、index、embedding、Qdrant dump 或 provider response；
- current pointer、mutable production projection、object-store manifest 等运行状态；
- 真实 cluster/machine 名、private hostname、IP/CIDR topology、environment Helm value、Argo
  Application 或 encrypted secret inventory；
- 本地生成的抓取产物、日志、调用链、任务终结文件或发布产物。

## Provenance 分类

仓库内每个非代码 fixture 或 data-like source 必须属于：

- `synthetic`：只为测试或示例创建；
- `self-authored`：由本项目创作且未复制受限上游；
- `source-derived-publicly-redistributable`：来源及再分发权利已有记录；
- `internal-only-not-for-public-repo`：公开前必须移除或替换。

新增第三方或来源派生 artifact 时，按需更新 `NOTICE`、下方[第三方来源声明](#第三方来源声明)或所属
provenance 文档。

## 第三方来源声明

除非文件或目录另有说明，本仓库使用 Apache License, Version 2.0。本节记录不自动包含在仓库
Apache-2.0 授权中的来源和署名边界。

### 依赖许可证

根目录 `LICENSE` 和 `NOTICE` 覆盖仓库自有源码、配置、测试和文档。第三方 package dependency
继续使用各自上游作者的许可证。

发布 release artifact 前，必须分别生成并评审 `pnpm`、`uv`、Cargo、Go 和 Maven dependency
license inventory。本文不是完整的机器生成依赖许可证报告。

### 来源数据与 Fixture

仓库包含用于验证 ingestion 和 rendering 行为的来源派生配置、测试、fixture 和 reference
data。这些内容保留原上游所有权和许可证；仓库 Apache-2.0 不会重新授权校园网站页面、
notice、document 或其他第三方内容。

已知类别包括：

- collector test 使用的 synthetic public website snippet 和 HTML fixture；
- ingestion test 使用的 synthetic campus notice、document、curriculum 或 regulation sample；
- map loader code 和 synthetic map fixture；
- `apps/campus-web/data/campus-map/snapshots/*.overpass.json`、
  `apps/campus-web/data/campus-map/curated/*.geojson` 和
  `apps/campus-web/assets/campus-map/assets/*.geojson` 中由 OpenStreetMap 数据派生的校园底图。

### 地图数据

`apps/campus-web/data/campus-map/snapshots/*.overpass.json`、
`apps/campus-web/data/campus-map/curated/*.geojson` 和
`apps/campus-web/assets/campus-map/assets/*.geojson` 的 geometry 来自 OpenStreetMap
contributors，依据 Open Database License 1.0 提供。该数据不在仓库 Apache-2.0 授权范围内；公开地图必须显示
`© OpenStreetMap contributors` 并链接到 <https://www.openstreetmap.org/copyright>。

项目自有 GeoJSON、tile 与坐标可以按仓库许可证保留。其他第三方或来源派生地图数据只有在再分发
权利、上游许可证与署名要求明确时才能提交；否则由所属受控存储加载，并让许可证与署名 metadata
随发布单元保存。

### 商标与品牌

Apache-2.0 不授权项目名、组织名、logo 或其他品牌标识的商标使用，但为合理说明作品来源
而进行的通常使用除外。

## 运行时内容

tool、status、docs 与产品页面通过正式 runtime 边界消费 database/read model 和 object-store
artifact，不从 git 读取持续变化的生产内容。git 可以保存代码、合同、validator、稳定
self-authored 数据与 synthetic example。

## 检查

- 涉及公开发布的变更执行 `pnpm check`；
- 修改 fixture、来源配置、公开资产或评测样例后执行所属模块测试和来源
  hygiene 检查；
- 修改 dependency lock 后执行 dependency license policy 检查；
- 私有仓库首次公开前单独扫描 git history；working-tree 检查不能证明历史记录干净。
