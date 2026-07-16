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
source ref 推断 place identity。

## 相关文档

- `../decisions/adr-0027-navigation.md`
- `../decisions/adr-0028-map-provider.md`
