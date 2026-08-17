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

新增第三方或来源派生 artifact 时，按需更新 `NOTICE`、`THIRD_PARTY_NOTICES.md` 或所属
provenance 文档。

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
