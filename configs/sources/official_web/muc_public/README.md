# muc_public 来源配置

本目录定义 `muc_public` site 的公开网页来源边界、调度与质量策略。它不直接开放任何在线查询
target。

## 配置所有权

- `site.json`、`hosts.json`、`seeds.json`：site、host 与 seed 事实；
- `crawl-policy.json`、`scheduler-policy.json`、`qc-policy.json`：crawl、调度与质量策略；
- `credentials.schema.json`：匿名公开采集所需 credential 结构；
- `projection-declarations.json`：target 准入后的 page-family action hint；
- `target-source-map.json`：target-first 准入；
- `consumer-denominator.json`、`target-inventory.json`：已准入下游消费范围；
- `source-packs/`：显式 target-first batch manifest；
- `projection-routing.json`：保留的 projection route 配置，当前值以文件为准。

具体 lane、host、budget、保留动作和 rollout 值只由对应 JSON 拥有，README 不维护副本。

## 边界

- host group 与 scheduler lane 只是 source-layer segmentation，不代表在线 target 已开放；
- listing page 默认用于 discovery，保留与投影由配置及明确 target admission 决定；
- `projection-declarations.json` 不能独立扩大 `stable_reference` 或其他 serving surface；
- `projection-routing.json` 不能独立开放 Official Web 在线查询；
- expansion batch 通过质量检查也不会自动改变 scheduler cadence 或 query-serving scope。

## 相关文档

- `docs/domains/official-web.md`
