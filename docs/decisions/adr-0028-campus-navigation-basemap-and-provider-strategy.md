---
doc_type: decision
decision_id: ADR-0028
status: accepted
created: 2026-04-05
updated: 2026-04-05
---

# ADR-0028 Campus Navigation Basemap And Provider Strategy

## 状态

Accepted on 2026-04-05.

## 背景

`ADR-0027` 已经冻结了以下长期边界：

- 导航是独立 agent family
- 校园空间真相属于 repo-owned institutional knowledge 子域
- 瓦片地图只是 runtime presentation concern
- 外部地图 provider 只允许作为 adapter 参与

但仓库仍缺一条更具体的技术 posture：

- 在“学校 + 周边关键地点”这个产品范围内，应该自建到哪一层
- 高德等商业 provider 成本不可接受时，生产主链路应如何收敛
- 是否可以把 OSM Foundation 公共瓦片或公共 Nominatim 当作生产依赖
- 中国区公开地图呈现应如何处理底图、Key、配额与合规约束

如果这条策略不先冻结，后续实现很容易退化为：

- 为了省事继续把商业 provider 当成默认主真相和默认主成本中心
- 为了省钱直接依赖 OSMF 公共瓦片或公共 Nominatim 跑生产链路
- 把“自建校园导航”误扩成“第一阶段自建完整互联网地图平台”
- 让底图 provider、前端 renderer 和导航 contract 耦合在一起

## 决策

### 决策 1：自建范围固定为校园导航真相层，而不是完整地图平台

当前产品范围是校园内导航与学校周边少量关键地点，不是全城级通用地图产品。

因此 repo 需要自建的 canonical truth 固定为：

- `campus_navigation/place_catalog`
- `campus_navigation/route_graph`
- 学校周边关键地点的受控 place facts 和连通关系

这里的“周边关键地点”指低基数、受控、与校园出行直接相关的地点，例如：

- 地铁站
- 公交站
- 医院
- 常用停车点
- 校外办事点

明确不做：

- 第一阶段不自建全城 POI 平台
- 第一阶段不自建全城导航平台
- 第一阶段不自建完整互联网底图服务

### 决策 2：校园与周边关键地点路线以 repo-owned graph 为主

校园内路线正确性与关键连通关系由 repo-owned `route_graph` 决定。

直接含义：

- 校内路径规划默认走自有图谱
- 周边关键地点只接入对当前产品有价值的受控连接边
- provider route response 只能作为 coverage 外 fallback，不反向升级为 canonical campus route truth

### 决策 3：不把高德作为默认基础依赖

当商业 provider 成本与当前范围不匹配时，不应继续把它作为默认基础依赖。

直接含义：

- 高德不再作为当前长期方案里的默认主链路前提
- 如后续保留高德，只允许作为可替换 adapter 参与 geocode、POI search 或校外 fallback
- 去掉高德不会使 campus navigation capability 失效

### 决策 4：不使用 OSM Foundation 公共瓦片或公共 Nominatim 作为生产主链路

OSMF 公共服务不是当前生产链路的可接受依赖。

直接含义：

- 不使用 `tile.openstreetmap.org` 作为 production basemap dependency
- 不使用 `nominatim.openstreetmap.org` 作为 production geocode / search dependency
- 如果未来使用 OSM-derived stack，也应走自托管或受控第三方，不走 OSMF 公共公益节点

### 决策 5：中国区公开地图呈现优先采用合规底图，而不是第一阶段自建公开底图服务

对于面向用户的中国区产品 surface，第一阶段应优先使用可申请 Key、可管理配额、具备公开地图使用路径的合规底图能力。

当前推荐 posture：

- 优先评估天地图这类低成本、合规导向的底图能力
- 底图只承载浏览、定位辅助与 route overlay，不承载校园真相
- 如果后续需要切换底图 provider，不应改动导航 contract 和 agent truth model

明确不做：

- 不把“公开地图底图自建”作为第一阶段必选项
- 未经过专门合规评估前，不把自托管公开地图服务直接推向正式用户流量

### 决策 6：地图 renderer 与底图 provider 保持解耦

前端地图层只消费产品侧的通用导航结果，不拥有 provider-specific contract。

直接含义：

- route polyline、waypoint、summary、warning 由产品 contract 提供
- 前端 renderer 可以是 provider-neutral map renderer，也可以在局部适配某个底图 SDK
- renderer 与底图切换不应反向改变 `app-api`、`supervisor` 或 `navigation-agent` 的 shared contract

### 决策 7：首个前向交付 slice 固定为地点寻找，而不是路线规划

当前第一期应先交付 `place_lookup` / `place_finding`，优先回答：

- “xx 楼在哪里”
- “补卡机在哪里”
- “某个办事点 / 服务点在哪里”

第一期直接目标固定为：

- place alias resolution
- canonical place lookup
- 位置描述与到达提示的答案成形
- 必要时附带 point-level map preview 或 location card

第一期明确不做：

- route planning
- entrance selection
- accessibility routing
- multi-leg wayfinding
- chat 内 route preview / full-map route interaction

直接含义：

- `place_catalog` 的建设优先级高于 `route_graph`
- first ship 不要求完整路线搜索能力
- 前端首发可以只做地点卡片和点位展示，不要求路线交互
- 后续如果进入导航 phase，再在已落盘的 place truth 上叠加 route graph 与 route answer contract

## 结果

直接结果如下：

- 后续实施应先建设 `place_catalog` 与周边关键地点受控数据，再按需要补齐 `route_graph`
- 后续产品实现应采用 `chat-first, map-enhanced, full-map-optional`，但地图层继续保持底图弱依赖
- 后续技术选型应把“中国区底图合规”和“商业 provider 成本”视为独立约束，而不是把任一 provider 反向提升为 architecture truth
- 是否保留高德、是否引入天地图、是否未来自托管 OSM-derived tiles，都属于 adapter/runtime 取舍，不改变 `ADR-0027` 已冻结的长期边界

## Deferred Triggers

只有出现以下条件之一，才重新评估“完整自建底图/瓦片服务”：

- 公开地图流量长期超过当前合规底图与配额的可接受范围
- 必须支持稳定离线地图包
- 必须实现强定制 cartography 或私有地图样式治理
- 必须覆盖远超校园与周边关键地点的小范围受控地图

## External References

- 自然资源部办公厅、工业和信息化部办公厅《关于规范移动互联网应用程序中登载使用地图行为的通知》: `https://www.gov.cn/zhengce/zhengceku/202405/content_6950568.htm`
- 天地图应用开发许可申请说明: `https://lbs.tianditu.gov.cn/authorization/authorization.html`
- 天地图地图服务简介: `https://lbs.tianditu.gov.cn/server/MapService.html`
- OSMF Tile Usage Policy: `https://operations.osmfoundation.org/policies/tiles/`
- OSMF Nominatim Usage Policy: `https://operations.osmfoundation.org/policies/nominatim/`

## Related Docs

- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-agent-and-spatial-truth.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
