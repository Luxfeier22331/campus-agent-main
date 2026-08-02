---
doc_type: domain
owner_boundary: domains/navigation/place
status: active
---
# 校园地点

## 边界

本文定义当前校园地图地点目录。它服务 campus-web 地图读取，不是模型可见工具、路线规划器、
geocoder 或 RAG collection。

## 当前实现

- app-api 的 `apps/app-api/src/modules/campus-experience` 拥有当前浏览器 read model；
- app-api 的 `apps/app-api/assets/campus-map` 拥有随 Worker 版本发布的校园 GeoJSON 和 manifest；
- `GET /api/campus-map/manifest` 返回当前底图清单；
- `GET /api/campus-map/assets/:sha256.geojson` 返回不可变底图；
- `GET /api/campus-map/places` 返回 campus 与地点列表；
- `GET /api/campus-map/places/:placeId` 返回单个地点；
- campus-web 通过 `apps/campus-web/src/features/map/api.ts` 消费这两个接口；
- 当前没有模型可见的地点工具或 execution contract。

`configs/reference-data/campus_navigation/place_catalog/seed.v1.json` 是 synthetic reference
fixture，当前 app-api 不加载它。修改该 seed 不会改变浏览器地图；不得把它描述为已发布的
runtime catalog。

## 浏览器数据

`CampusMapPlace` 包含稳定 `id`、title、campus、category、description、tag、source ref、可选
access note 和一个 point GeoJSON feature。坐标顺序为 longitude、latitude。

若地点对应校园底图 geometry，可以通过 `mapFeatureRefs[]` 显式绑定
`{ sourceId, layer, fid }`。浏览器不得根据底图 label、最近 geometry、provider id 或自由格式
source ref 推断 place identity。每个引用必须对应 manifest 所选 GeoJSON 中真实且唯一的 feature；
带引用地点的 point 必须落在对应校区 bounds 内。校外接驳点可以没有底图引用。

## 底图交付

校园 GeoJSON 是低频、可公开再分发且需要随代码审查的产品资产，由 App API 静态资产 binding
交付。manifest 只引用以最终文件字节 SHA-256 命名的 `.geojson`；Campus Web 只读取 App API
接口，不拥有 R2 bucket、对象 key 或版本选择逻辑。

更新底图时新增摘要文件并更新 manifest，不覆盖已发布摘要。合同测试同时校验摘要、GeoJSON
结构、校区 bounds、feature identity、地点引用、地点坐标和许可证 metadata。底图 geometry 来自
OpenStreetMap，依据 ODbL 1.0 提供；页面通过 MapLibre source 展示 manifest 中的 OSM 署名。

## 相关文档

- `../decisions/adr-0027-navigation.md`
- `../decisions/adr-0028-map-provider.md`
