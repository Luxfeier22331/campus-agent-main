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

- campus-web 的 `apps/campus-web/data/campus-map` 拥有地图来源、地点目录和更新脚本；
- campus-web 的 `apps/campus-web/assets/campus-map` 随 Worker 版本发布 manifest、GeoJSON 和地点目录；
- `GET /campus-map/manifest.json` 返回当前底图和地点清单；
- manifest 中的 `/campus-map/assets/:sha256.geojson` 和 `/campus-map/places/:sha256.json` 是不可变资产；
- campus-web 通过 `apps/campus-web/src/features/map/api.ts` 先读取 manifest，再读取其地点目录；
- app-api 不再提供地图路由、地点 read model 或地图资产 binding；
- 当前没有模型可见的地点工具或 execution contract。

`configs/reference-data/campus_navigation/place_catalog/seed.v1.json` 是 synthetic reference
fixture，当前 campus-web 不加载它。修改该 seed 不会改变浏览器地图；不得把它描述为已发布的
runtime catalog。

## 浏览器数据

`CampusMapPlace` 包含稳定 `id`、title、campus、category、description、tag、source ref、可选
access note 和一个 point GeoJSON feature。坐标顺序为 longitude、latitude。

若地点对应校园底图 geometry，可以通过 `mapFeatureRefs[]` 显式绑定
`{ sourceId, layer, fid }`。浏览器不得根据底图 label、最近 geometry、provider id 或自由格式
source ref 推断 place identity。每个引用必须对应 manifest 所选 GeoJSON 中真实且唯一的 feature；
带引用地点的 point 必须落在对应校区 bounds 内。校外接驳点可以没有底图引用。

## 底图交付

校园 GeoJSON 和地点目录是低频、可公开再分发且需要随代码审查的产品资产，由 Campus Web
Cloudflare Assets 交付。`apps/campus-web/scripts/campus-map/generate.ts` 负责规范化、摘要和
合同校验。`map:snapshot:update` 访问 Overpass，并在校验响应后只替换选定的原始快照；快照是采集
参考，不会自动改写人工审阅的 curated GeoJSON、地点坐标或已发布资产。维护者完成审阅后使用
`map:normalize` 生成内容寻址资产，先放置摘要文件，最后原子替换 manifest 指针。

只有 `apps/campus-web/assets/campus-map` 中的发布资产变更才会选择 `campus-web-staging` 候选；查询和
快照变更本身不发布 Worker。App API 已不再消费地图资产，因此不会因静态地图变更被重复发布。

更新底图时新增摘要文件并更新 manifest，不覆盖已发布摘要。合同测试同时校验摘要、GeoJSON
结构、校区 bounds、feature identity、地点引用、地点坐标和许可证 metadata。底图 geometry 来自
OpenStreetMap，依据 ODbL 1.0 提供；页面通过 MapLibre source 展示 manifest 中的 OSM 署名。

## 相关文档

- `../decisions/adr-0027-navigation.md`
- `../decisions/adr-0028-map-provider.md`
